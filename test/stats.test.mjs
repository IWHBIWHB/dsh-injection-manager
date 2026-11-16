// Unit tests for the history store: the file is the only durable state the
// statistics tab has, so its shape and caps matter more than its formatting.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-stats-'))
process.env.DSH_HOME = home

const { recordSnapshot, readStats, resetStatsCache, backfillStats, statsFilePath } = await import('../lib/stats.js')

const snapshot = (id, tokens) => ({
  agent: { id, scopeSource: 'test' },
  cwd: 'D:/work',
  totals: { tokens },
  effective: { totals: { tokens: tokens - 100 } },
  channels: [
    { id: 'skills', tokens: 300 },
    { id: 'tools', tokens: 700 },
  ],
  skillsState: { catalogTokens: 300, total: 4 },
  toolsState: { count: 12 },
  context: { window: 1000, used: tokens, occupancy: 10.5 },
  policy: { preset: 'custom' },
})

test('a snapshot becomes one row and a repeat updates instead of duplicating', async () => {
  resetStatsCache()
  recordSnapshot(snapshot('s1', 1000))
  recordSnapshot(snapshot('s1', 1200))
  const stats = await readStats()
  assert.equal(stats.rows.length, 1)
  assert.equal(stats.rows[0].samples, 2)
  assert.equal(stats.rows[0].peak, 1200, 'peak keeps the largest measured first turn')
  assert.equal(stats.rows[0].saved, 100, 'saved is the latest all-on minus effective delta')
})

test('aggregates and day buckets describe the recorded rows', async () => {
  resetStatsCache()
  recordSnapshot(snapshot('s2', 2000))
  const stats = await readStats()
  assert.equal(stats.aggregate.sessions, stats.rows.length)
  assert.ok(stats.aggregate.avgAllOn > 0)
  assert.equal(stats.days.length >= 1, true)
  assert.equal(stats.coverage.recorded, stats.rows.length)
})

test('a snapshot without an agent id is ignored', async () => {
  resetStatsCache()
  const before = (await readStats()).rows.length
  recordSnapshot({ totals: { tokens: 1 } })
  recordSnapshot({ agent: {}, totals: { tokens: 1 } })
  assert.equal((await readStats()).rows.length, before)
})

test('the file is JSON with a version and the rows it reported', async () => {
  resetStatsCache()
  recordSnapshot(snapshot('s3', 500))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const raw = JSON.parse(await readFile(statsFilePath(), 'utf8'))
  assert.equal(raw.version, 1)
  assert.equal(typeof raw.sessions, 'object')
})

test('backfill prices durable logs and never re-reads a priced session', async () => {
  resetStatsCache()
  const log = {
    events: [
      { type: 'request/header', data: { header: { tools: [{ name: 'a', parameters: { type: 'object' } }] } } },
      { type: 'system/message', data: { message: { content: [{ type: 'text', text: 'x'.repeat(400) }] } } },
    ],
  }
  let reads = 0
  const sessionQuery = {
    async readSession(id) {
      reads += 1
      return id === 'log-1' ? log : { events: [] }
    },
  }
  const first = await backfillStats(sessionQuery, ['log-1'], { limit: 5, budgetMs: 5000 })
  assert.equal(first.added, 1)
  const second = await backfillStats(sessionQuery, ['log-1'], { limit: 5, budgetMs: 5000 })
  assert.equal(second.added, 0, 'a priced session is cached')
  assert.equal(reads, 1)
  const stats = await readStats()
  const row = stats.rows.find((entry) => entry.id === 'log-1')
  assert.equal(row.fromLog, true)
  assert.equal(row.tools, 1)
  assert.ok(row.peak > 0)
})

test('a failing log does not abort the batch', async () => {
  resetStatsCache()
  const sessionQuery = {
    async readSession(id) {
      if (id === 'bad') throw new Error('corrupt')
      return { events: [{ type: 'request/header', data: { header: { tools: [] } } }] }
    },
  }
  const result = await backfillStats(sessionQuery, ['bad', 'good'], { limit: 5, budgetMs: 5000 })
  assert.equal(result.added, 1)
})
