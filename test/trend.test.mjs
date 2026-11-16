// Trend merge: measured stats rows plus the bounded durable-log backfill.
//
// The stats file is the only durable input, so these tests write it directly in
// its on-disk shape and assert what the chart would receive — including the two
// honest states the UI must render differently: `source:"log"` and
// `channels:null`.
//
// Performance contract (2026-11-16): a read must never await durable-log replay.
// The backfill runs single-flight in the background with a 60s cooldown; the
// first response carries the measured rows plus `backfilling:true`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-trend-'))
process.env.DSH_HOME = home
await mkdir(join(home, 'injection-manager'), { recursive: true })

const { readStats, resetBackfillState, resetStatsCache, statsFilePath, whenBackfillIdle } = await import('../lib/stats.js')
const {
  TREND_CHANNELS,
  aggregatePoints,
  clampScope,
  pointFromRow,
  rangeCutoff,
  readTrend,
  rowChannels,
} = await import('../lib/trend.js')
const { createRoutes } = await import('../lib/routes.js')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()

const rows = {
  old: {
    id: 'old',
    at: NOW - DAY * 40,
    firstAt: NOW - DAY * 40,
    cwd: 'D:/old',
    scope: 'startup',
    allOn: 50000,
    effective: 40000,
    peak: 50000,
    samples: 2,
    saved: 10000,
    policy: 'custom',
    channels: { sections: 100, contexts: 200, skills: 300, tools: 49000, instructions: 400 },
    compactions: { count: 1, freed: 5000 },
  },
  logged: {
    id: 'logged',
    at: NOW - DAY * 3,
    firstAt: NOW - DAY * 3,
    cwd: 'D:/logged',
    scope: 'backfill',
    allOn: 80000,
    effective: 80000,
    peak: 80000,
    samples: 0,
    saved: 0,
    policy: 'unknown',
    fromLog: true,
  },
  recent: {
    id: 'recent',
    at: NOW - DAY,
    firstAt: NOW - DAY,
    cwd: 'D:/recent',
    scope: 'startup',
    allOn: 30000,
    effective: 20000,
    peak: 30000,
    samples: 1,
    saved: 10000,
    policy: 'all',
    channels: { sections: 50, contexts: 100, skills: 150, tools: 29000, instructions: 700 },
    compactions: { count: 0, freed: 0 },
  },
}

async function seed(sessions) {
  await writeFile(statsFilePath(), JSON.stringify({ version: 1, sessions }), 'utf8')
  resetStatsCache()
  resetBackfillState()
}

const pricedLog = {
  events: [
    { type: 'request/header', data: { header: { tools: [{ name: 'a', parameters: { type: 'object' } }] } } },
    { type: 'system/message', data: { message: { content: [{ type: 'text', text: 'x'.repeat(4000) }] } } },
  ],
}

function invoke(handler, { method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === '' ? [] : [Buffer.from(body, 'utf8')])
    req.method = method
    req.url = url
    req.headers = headers
    req.destroy = () => {}
    const chunks = []
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
      end(chunk) {
        if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = JSON.parse(text)
        } catch {
          json = undefined
        }
        resolve({ status: this.statusCode, headers: this.headers, text, json })
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

test('a measured row maps to a point with a channel split', async () => {
  await seed(rows)
  const stats = await readStats()
  assert.equal(stats.rows.length, 3)
  const point = pointFromRow(rows.old)
  assert.equal(point.sessionId, 'old')
  assert.equal(point.total, 50000)
  assert.equal(point.effective, 40000)
  assert.equal(point.saved, 10000)
  assert.equal(point.source, 'measured')
  assert.equal(point.samples, 2)
  assert.deepEqual(point.compactions, { count: 1, freed: 5000 })
  assert.deepEqual(point.channels, { sections: 100, contexts: 200, skills: 300, tools: 49000, instructions: 400 })
})

test('rows without a channel split stay null instead of becoming zeros', async () => {
  await seed(rows)
  const point = pointFromRow(rows.logged)
  assert.equal(point.channels, null)
  assert.equal(point.source, 'log')
  assert.deepEqual(point.compactions, { count: 0, freed: 0 })
  assert.equal(rowChannels({ channels: {} }), null)
  assert.equal(rowChannels({ channels: { tools: 12 } }).instructions, null)
})

test('scope and policy follow the revised contract (free string / unknown allowed)', () => {
  // v1 rows recorded the measurement trigger; unknown values pass through raw.
  const legacy = pointFromRow({ id: 's', at: 1, scope: 'route.session', policy: 'unknown' })
  assert.equal(legacy.scope, 'route.session')
  assert.equal(legacy.policy, 'unknown')
  assert.equal(pointFromRow({ id: 's', at: 1 }).scope, '')
  assert.equal(pointFromRow({ id: 's', at: 1 }).policy, 'unknown')
  const long = 'x'.repeat(100)
  assert.equal(clampScope(long).length, 64)
  assert.equal(pointFromRow({ id: 's', at: 1, scope: long }).scope.length, 64)
})

test('readTrend sorts by firstAt, filters by range and applies the limit', async () => {
  await seed(rows)
  const all = await readTrend('all', 120)
  assert.deepEqual(all.points.map((point) => point.sessionId), ['old', 'logged', 'recent'])
  assert.equal(all.range, 'all')
  assert.equal(typeof all.generatedAt, 'number')
  assert.equal(all.backfilling, false, 'no sessionQuery means no background work')

  const week = await readTrend('7d', 120)
  assert.deepEqual(week.points.map((point) => point.sessionId), ['logged', 'recent'])
  assert.equal(week.coverage.recorded, 2)
  assert.equal(week.coverage.known, null)

  const limited = await readTrend('all', 2)
  assert.deepEqual(limited.points.map((point) => point.sessionId), ['logged', 'recent'])
  assert.equal(limited.aggregate.sessions, 3, 'aggregate describes the whole range, not the page')

  const unknown = await readTrend('nonsense', 120)
  assert.equal(unknown.range, 'all')
})

test('aggregates exclude unknown channels rather than counting them as zero', async () => {
  await seed(rows)
  const trend = await readTrend('all', 120)
  assert.deepEqual(trend.aggregate, {
    sessions: 3,
    measured: 2,
    avgTotal: Math.round((50000 + 80000 + 30000) / 3),
    maxTotal: 80000,
    totalSaved: 20000,
    avgChannels: {
      sections: Math.round((100 + 50) / 2),
      contexts: Math.round((200 + 100) / 2),
      skills: Math.round((300 + 150) / 2),
      tools: Math.round((49000 + 29000) / 2),
      instructions: Math.round((400 + 700) / 2),
    },
  })
  assert.deepEqual(TREND_CHANNELS, ['sections', 'contexts', 'skills', 'tools', 'instructions'])
})

test('cutoffs and the aggregate helper are pure functions', () => {
  assert.equal(rangeCutoff('all', NOW), 0)
  assert.equal(rangeCutoff('30d', NOW), NOW - 30 * DAY)
  assert.equal(rangeCutoff('7d', NOW), NOW - 7 * DAY)
  assert.equal(aggregatePoints([]).sessions, 0)
  assert.deepEqual(aggregatePoints([]).avgChannels, {
    sections: null,
    contexts: null,
    skills: null,
    tools: null,
    instructions: null,
  })
})

test('the read path returns measured rows without waiting for the backfill', async () => {
  await seed({})
  let releaseList
  const listGate = new Promise((resolve) => {
    releaseList = resolve
  })
  let reads = 0
  const sessionQuery = {
    async listSessions() {
      await listGate
      return [
        { header: { id: 'log-new', createdAt: NOW - 1000 } },
        { header: { id: 'log-old', createdAt: NOW - 200000 } },
      ]
    },
    async readSession(id) {
      reads += 1
      return id === 'log-new' ? pricedLog : { events: [] }
    },
  }
  const ctx = { get: (name) => (name === 'sessionQuery' ? sessionQuery : undefined) }

  const probe = Date.now()
  const first = await readTrend('all', 120, ctx)
  const elapsed = Date.now() - probe
  assert.ok(elapsed < 500, `first /trend read took ${elapsed}ms; it must not await durable-log replay`)
  assert.equal(first.backfilling, true)
  assert.equal(first.points.length, 0, 'the response only carries already-measured rows')
  assert.equal(first.coverage.known, null, 'the corpus index lists in the background too')

  releaseList()
  await whenBackfillIdle()

  const second = await readTrend('all', 120, ctx)
  assert.equal(second.coverage.known, 2)
  assert.equal(second.coverage.recorded, 1)
  assert.equal(second.points.length, 1)
  assert.equal(second.points[0].source, 'log')
  assert.equal(second.points[0].channels, null)
  assert.equal(reads, 2, 'the newest unmeasured session is replayed; the empty one is skipped')
  assert.equal(second.backfilling, false, 'the pass finished and the cooldown holds the next one')
})

test('/stats answers from memory and moves the slow replay to the background', async () => {
  await seed(rows)
  let releaseList
  const listGate = new Promise((resolve) => {
    releaseList = resolve
  })
  const sessionQuery = {
    async listSessions() {
      await listGate
      return [
        { header: { id: 'recent', createdAt: NOW - DAY } },
        { header: { id: 'old', createdAt: NOW - DAY * 40 } },
      ]
    },
    async readSession() {
      return { events: [] }
    },
  }
  const ctx = { get: (name) => (name === 'sessionQuery' ? sessionQuery : undefined) }
  const routes = createRoutes(ctx)

  const probe = Date.now()
  const first = await invoke(routes.stats, { url: '/stats' })
  const elapsed = Date.now() - probe
  assert.equal(first.status, 200)
  assert.ok(elapsed < 500, `/stats took ${elapsed}ms; it must not await the backfill`)
  assert.equal(first.json.backfilling, true)
  assert.equal(first.json.coverage.known, null)
  assert.deepEqual(first.json.sessions, [], 'the session index is filled by the background pass')
  assert.equal(first.json.rows.length, 3, 'already-measured rows are served immediately')

  releaseList()
  await whenBackfillIdle()

  const second = await invoke(routes.stats, { url: '/stats' })
  assert.equal(second.json.backfilling, false)
  assert.equal(second.json.coverage.known, 2)
  assert.deepEqual(second.json.sessions.map((session) => session.id), ['recent', 'old'])
  assert.equal(second.json.backfill.added, 0, 'the seeded sessions were already measured or empty logs')
})

test('cleanup', async () => {
  await flushStatsAndRemove()
})

async function flushStatsAndRemove() {
  await whenBackfillIdle()
  await rm(home, { recursive: true, force: true })
}
