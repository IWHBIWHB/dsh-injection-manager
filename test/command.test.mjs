// Slash-command tests: /inject budget, apply, undo run against the same policy
// file and the same snapshot pipeline as the panel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-command-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const { createCommand } = await import('../index.js')
const { flushStats } = await import('../lib/stats.js')

const ctx = {
  workingDirectory: { ensure: async () => home, defaultDirectory: home },
  systemPrompt: {
    assemble: async () => ({
      sections: [{ name: 'harness:identity', order: -1000, text: 'You are an agent.' }],
      contexts: [{ name: 'working-directory:current', order: 100, text: 'cwd', required: true }],
    }),
  },
  skills: {
    snapshot: async () => ({
      complete: true,
      skills: [{ name: 'alpha', description: 'first', invocation: { modelInvocable: true, userInvocable: true }, provider: 'p', source: 'user' }],
    }),
  },
  tools: {
    schemas: () => [
      { name: 'mcp__demo__one', description: 'one', parameters: { type: 'object' } },
      { name: 'mcp__demo__two', description: 'two', parameters: { type: 'object' } },
      { name: 'read', description: 'read', parameters: { type: 'object' } },
    ],
  },
  agents: { get: () => undefined, currentInitiator: () => undefined, list: () => [] },
  get: () => undefined,
}

const command = createCommand(ctx)
const agent = { id: 'session-command', session: {} }
const run = (rawInput) => command.handler({ agent, rawInput })
const policyFile = join(home, 'injection-manager', 'policy.json')
const readPolicyFile = async () => JSON.parse(await readFile(policyFile, 'utf8'))

test('minimal switches the policy and reports the new projection', async () => {
  const result = await run('minimal')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /已切换预设：minimal/)
  const policy = await readPolicyFile()
  assert.equal(policy.preset, 'minimal')
  assert.equal(policy.tools.mode, 'only')
  assert.ok(policy.tools.names.length > 0)
})

test('all switches every channel back on', async () => {
  const result = await run('all')
  assert.equal(result.kind, 'success')
  const policy = await readPolicyFile()
  assert.equal(policy.preset, 'all')
  assert.equal(policy.tools.mode, 'all')
})

test('undo restores the policy before the last write', async () => {
  await run('minimal')
  const result = await run('undo')
  assert.equal(result.kind, 'success')
  const policy = await readPolicyFile()
  assert.equal(policy.preset, 'all')
  assert.equal(policy.tools.mode, 'all')
})

test('unknown subcommands list the available ones', async () => {
  const result = await run('nonsense')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /\/inject minimal/)
  assert.match(result.text, /\/inject undo/)
})

test('cleanup', async () => {
  // Snapshot reads record stats with an atomic write that lands just after the
  // response; waiting for it keeps the temp directory removable.
  await flushStats()
  await rm(home, { recursive: true, force: true })
})
