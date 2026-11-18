// Closed-suite tracking: when an item disappears from the assembled prompt
// because the policy excludes it, the snapshot must still remember it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-closed-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')
await mkdir(join(home, 'injection-manager'), { recursive: true })

const { buildSnapshot } = await import('../lib/snapshot.js')
const { flushStats } = await import('../lib/stats.js')

let filtered = false
const toolA = { name: 'mcp__demo__alpha', description: 'alpha tool', parameters: { type: 'object' } }
const toolB = { name: 'mcp__demo__beta', description: 'beta tool', parameters: { type: 'object' } }

const ctx = {
  workingDirectory: { ensure: async () => home, defaultDirectory: home },
  systemPrompt: {
    assemble: async () => ({
      sections: [{ name: 'harness:identity', order: -1000, text: 'You are an agent.' }],
      contexts: [{ name: 'working-directory:current', order: 100, text: 'cwd', required: true }],
    }),
  },
  skills: { snapshot: async () => ({ complete: true, skills: [] }) },
  tools: { schemas: () => (filtered ? [toolB] : [toolA, toolB]) },
  agents: { get: () => undefined, currentInitiator: () => undefined, list: () => [] },
  get: () => undefined,
}

test('a tool that vanishes from the assembly is reported as closed', async () => {
  const first = await buildSnapshot(ctx, undefined, 'test')
  assert.equal(first.closed.length, 0)

  // Now the policy excludes alpha and the host stops returning it.
  await writeFile(
    join(home, 'injection-manager', 'policy.json'),
    JSON.stringify({ version: 2, preset: 'custom', tools: { mode: 'except', names: ['mcp__demo__alpha'] } }),
  )
  filtered = true
  const second = await buildSnapshot(ctx, undefined, 'test')
  assert.equal(second.items.some((item) => item.name === 'mcp__demo__alpha'), false)
  const closed = second.closed.find((item) => item.name === 'mcp__demo__alpha')
  assert.ok(closed, 'alpha should be listed as closed')
  assert.equal(closed.channel, 'tools')
  assert.ok(closed.tokens > 0, 'size is remembered from the earlier build')
  const group = second.closedGroups.find((entry) => entry.label === 'DEMO')
  assert.ok(group, 'closed entries group by MCP server')
  assert.deepEqual(group.items.map((item) => item.name), ['mcp__demo__alpha'])
})

test('items carry the policy on-flag the panel renders', async () => {
  filtered = false
  await writeFile(
    join(home, 'injection-manager', 'policy.json'),
    JSON.stringify({
      version: 2,
      preset: 'custom',
      tools: { mode: 'except', names: ['mcp__demo__beta'] },
      // Locked items stay on even when a policy names them: they cannot be
      // switched off, so reporting false would contradict the lock reason.
      contexts: { mode: 'except', names: ['working-directory:current'] },
    }),
  )
  const snapshot = await buildSnapshot(ctx, undefined, 'test')
  const byKey = new Map(snapshot.items.map((item) => [`${item.channel}:${item.name}`, item]))
  assert.equal(byKey.get('tools:mcp__demo__alpha').on, true)
  assert.equal(byKey.get('tools:mcp__demo__beta').on, false)
  assert.equal(byKey.get('contexts:working-directory:current').on, true, 'locked contexts are always on')
  assert.equal(byKey.get('contexts:working-directory:current').locked, true)
  for (const item of snapshot.items) assert.equal(typeof item.on, 'boolean')
  // The projection and the per-item flags must agree: effective excludes beta.
  const betaTokens = byKey.get('tools:mcp__demo__beta').tokens
  assert.equal(snapshot.effective.totals.tokens, snapshot.totals.tokens - betaTokens)
  // One pair of numbers, named once, for every surface to quote.
  assert.deepEqual(snapshot.numbers, { session: snapshot.totals.tokens, next: snapshot.effective.totals.tokens })
  assert.equal(snapshot.numbers.session - snapshot.numbers.next, betaTokens)
})

test('cleanup', async () => {
  await flushStats()
  await rm(home, { recursive: true, force: true })
})
