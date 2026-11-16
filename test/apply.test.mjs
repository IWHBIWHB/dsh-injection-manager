// Integration test for the applier: a fake context exposes just the services
// the plugin uses, so the whole path from policy.json to the four injection
// channels is exercised without a running harness.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-test-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const { applyPolicyForAgent } = await import('../lib/apply.js')
const { appliedAgents } = await import('../lib/snapshot.js')
const { flushStats } = await import('../lib/stats.js')

await mkdir(join(home, 'injection-manager'), { recursive: true })
await writeFile(
  join(home, 'injection-manager', 'policy.json'),
  JSON.stringify({
    version: 2,
    preset: 'custom',
    sections: { mode: 'except', names: ['tools:sdk'] },
    contexts: { mode: 'except', names: ['approval:policy'] },
    skills: { mode: 'except', names: ['secret-skill'] },
    tools: { mode: 'except', names: ['heavy_tool'] },
    prompt: { prefix: 'Be brief.', suffix: '' },
    budget: { tokens: 0 },
  }),
)

function makeHarness() {
  const registrations = []
  const restrictions = []
  const listeners = []
  const scoped = {
    skills: {
      register(definition) {
        registrations.push(definition)
        return () => {}
      },
    },
    tools: {
      restrict(filter) {
        restrictions.push(filter)
        return () => {}
      },
    },
  }
  const ctx = {
    workingDirectory: { ensure: async () => home, defaultDirectory: home },
    systemPrompt: {
      assemble: async () => ({
        sections: [
          { name: 'harness:identity', order: -1000, text: 'You are an agent.' },
          { name: 'deployment:persona-prefix', order: 0, text: 'Old persona.' },
          { name: 'tools:sdk', order: 5000, text: 'x'.repeat(4000) },
        ],
        contexts: [
          { name: 'working-directory:current', order: 100, text: 'cwd is here', required: true },
          { name: 'approval:policy', order: 115, text: 'approval rules' },
        ],
      }),
    },
    skills: {
      snapshot: async () => ({
        complete: true,
        skills: [
          { name: 'secret-skill', description: 'hidden soon', invocation: { modelInvocable: true, userInvocable: true }, provider: 'p', source: 'user' },
          { name: 'kept-skill', description: 'stays', invocation: { modelInvocable: true, userInvocable: true }, provider: 'p', source: 'user' },
        ],
      }),
    },
    tools: {
      schemas: () => [
        { name: 'heavy_tool', description: 'big', parameters: { type: 'object' } },
        { name: 'light_tool', description: 'small', parameters: { type: 'object' } },
      ],
    },
    get: () => undefined,
  }
  const agent = {
    id: 'session-test',
    session: {},
    ctx: {
      inject(_deps, callback) {
        callback(scoped)
        return () => {}
      },
      on(event, listener) {
        listeners.push({ event, listener })
        return () => {}
      },
    },
  }
  return { ctx, agent, registrations, restrictions, listeners }
}

test('a policy reaches all four channels for a new session', async () => {
  const { ctx, agent, registrations, restrictions, listeners } = makeHarness()
  await applyPolicyForAgent(ctx, agent, 'startup')

  assert.equal(appliedAgents.has(agent), true)

  // Prompt sections and runtime contexts go through the scoped waterfall.
  const assemble = listeners.find((entry) => entry.event === 'system-prompt/assemble')
  assert.ok(assemble, 'assemble listener registered')
  const filtered = await assemble.listener(
    {},
    {},
    async () => ({
      sections: [
        { name: 'harness:identity', order: -1000, text: 'You are an agent.' },
        { name: 'deployment:persona-prefix', order: 0, text: 'Old persona.' },
        { name: 'tools:sdk', order: 5000, text: 'x'.repeat(4000) },
      ],
      contexts: [
        { name: 'working-directory:current', order: 100, text: 'cwd is here', required: true },
        { name: 'approval:policy', order: 115, text: 'approval rules' },
      ],
    }),
  )
  assert.deepEqual(filtered.sections.map((s) => s.name), ['harness:identity', 'deployment:persona-prefix'])
  assert.equal(filtered.sections[1].text, 'Be brief.')
  assert.equal(filtered.sections[1].interpolate, false)
  assert.deepEqual(filtered.contexts.map((c) => c.name), ['working-directory:current'])

  // Skills are shadowed by a non-invocable same-name registration.
  assert.deepEqual(registrations.map((entry) => entry.name), ['secret-skill'])
  assert.equal(registrations[0].invocation.modelInvocable, false)

  // Tools are denied by exact name.
  assert.deepEqual(restrictions, [{ deny: ['heavy_tool'] }])
})

test('a session that already has the policy is not registered twice', async () => {
  const { ctx, agent, listeners } = makeHarness()
  await applyPolicyForAgent(ctx, agent, 'startup')
  const first = listeners.length
  await applyPolicyForAgent(ctx, agent, 'startup')
  assert.equal(listeners.length, first)
})

test('resume and compact sessions are left alone', async () => {
  const { ctx, agent, listeners } = makeHarness()
  await applyPolicyForAgent(ctx, agent, 'resume')
  assert.equal(listeners.length, 0)
  assert.equal(appliedAgents.has(agent), false)
})

test('cleanup', async () => {
  await flushStats()
  await rm(home, { recursive: true, force: true })
})
