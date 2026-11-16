// Event feed store: shape, dedupe, cap and the privacy clamp.
//
// These tests are the contract for `$DSH_HOME/injection-manager/events.json`:
// the insights tab reads it, so a broken cap or a duplicate row is a UI bug.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-events-'))
process.env.DSH_HOME = home

const {
  EVENT_KINDS,
  EVENT_LIMIT,
  appendEvent,
  dedupeKeyFor,
  eventsFilePath,
  readEvents,
  resetEventsCache,
} = await import('../lib/events.js')

/** Every test that counts rows starts from an empty feed file. */
async function resetFeed() {
  await mkdir(join(home, 'injection-manager'), { recursive: true })
  await writeFile(eventsFilePath(), JSON.stringify({ version: 1, events: [] }), 'utf8')
  resetEventsCache()
}

test('an append lands in events.json with the contract shape', async () => {
  await resetFeed()
  const result = await appendEvent({
    sessionId: 's1',
    kind: 'switch',
    params: { group: 'REA', channel: 'tools', op: 'off', count: 230, tokens: 66715 },
    tokensDelta: -66715,
  })
  assert.equal(result.added, true)
  assert.match(result.event.id, /^evt_[a-f0-9]{16}$/)
  assert.equal(result.event.tokensDelta, -66715)

  const raw = JSON.parse(await readFile(eventsFilePath(), 'utf8'))
  assert.equal(raw.version, 1)
  assert.equal(raw.events.length, 1)
  assert.deepEqual(raw.events[0].params, { group: 'REA', channel: 'tools', op: 'off', count: 230, tokens: 66715 })

  const feed = await readEvents('s1', 60)
  assert.equal(feed.events.length, 1)
  assert.equal(feed.events[0].kind, 'switch')
  assert.equal(feed.events[0].sessionId, 's1')
  assert.equal(feed.coverage.count, 1)
  assert.equal(typeof feed.coverage.from, 'number')
})

test('an explicit dedupe key makes a replayed event idempotent', async () => {
  await resetFeed()
  const first = await appendEvent({ sessionId: 's2', kind: 'compaction', dedupeKey: 'compaction:c1', tokensDelta: -4000 })
  const second = await appendEvent({ sessionId: 's2', kind: 'compaction', dedupeKey: 'compaction:c1', tokensDelta: -4000 })
  assert.equal(first.added, true)
  assert.equal(second.added, false)
  assert.equal(second.duplicate, true)
  assert.equal((await readEvents('s2', 10)).events.length, 1)
})

test('the default dedupe key folds timestamp, kind and params', async () => {
  await resetFeed()
  assert.equal(dedupeKeyFor('switch', { channel: 'tools' }, 1000), dedupeKeyFor('switch', { channel: 'tools' }, 1000))
  assert.notEqual(dedupeKeyFor('switch', { channel: 'tools' }, 1000), dedupeKeyFor('switch', { channel: 'tools' }, 1001))
  assert.notEqual(dedupeKeyFor('switch', { channel: 'tools' }, 1000), dedupeKeyFor('switch', { channel: 'skills' }, 1000))
  const once = await appendEvent({ sessionId: 's3', kind: 'policy-saved', at: 1000, params: { a: 1 } })
  const twice = await appendEvent({ sessionId: 's3', kind: 'policy-saved', at: 1000, params: { a: 1 } })
  assert.equal(once.added, true)
  assert.equal(twice.added, false)
})

test('the feed is capped at 300 and keeps the newest rows', async () => {
  await resetFeed()
  const total = EVENT_LIMIT + 5
  for (let index = 0; index < total; index += 1) {
    await appendEvent({ sessionId: 'cap', kind: 'diagnostic', params: { index }, dedupeKey: `cap:${index}` })
  }
  const raw = JSON.parse(await readFile(eventsFilePath(), 'utf8'))
  assert.equal(raw.events.length, EVENT_LIMIT)
  assert.equal(raw.events[0].params.index, 5, 'the five oldest events were rotated out')
  assert.equal(raw.events[raw.events.length - 1].params.index, total - 1)
})

test('readEvents filters by session, sorts oldest first and honours the limit', async () => {
  await resetFeed()
  for (let index = 0; index < 5; index += 1) {
    await appendEvent({ sessionId: 'a', kind: 'switch', at: 2000 + index, params: { index }, dedupeKey: `a:${index}` })
    await appendEvent({ sessionId: 'b', kind: 'switch', at: 2000 + index, params: { index }, dedupeKey: `b:${index}` })
  }
  const all = await readEvents('a', 3)
  assert.equal(all.events.length, 3)
  assert.deepEqual(all.events.map((event) => event.params.index), [2, 3, 4], 'newest 3, ascending inside the window')
  assert.equal(all.coverage.limit, 3)
  assert.equal(all.coverage.from, all.events[0].at)
  const fromQueryString = await readEvents('a', '2')
  assert.equal(fromQueryString.events.length, 2, 'route query values arrive as strings')
  const unfiltered = await readEvents(undefined, 60)
  assert.equal(unfiltered.events.length, 10)
})

test('unknown kinds are dropped instead of poisoning the enum', async () => {
  await resetFeed()
  const result = await appendEvent({ kind: 'not-a-kind', params: {} })
  assert.equal(result.added, false)
  assert.equal((await readEvents(undefined, 10)).events.length, 0)
  assert.equal(EVENT_KINDS.includes('not-a-kind'), false)
})

test('params are flat primitives, clamped to 200 characters', async () => {
  await resetFeed()
  const long = 'x'.repeat(500)
  await appendEvent({
    sessionId: 's4',
    kind: 'diagnostic',
    params: {
      detail: long,
      nested: { prompt: 'secret prompt text' },
      list: ['ok', 2, { leak: true }],
      flag: true,
      count: 7,
    },
  })
  const event = (await readEvents('s4', 5)).events[0]
  assert.equal(event.params.detail.length, 200)
  assert.equal(event.params.nested, undefined, 'nested objects are dropped, not serialized')
  assert.deepEqual(event.params.list, ['ok', 2])
  assert.equal(event.params.flag, true)
  assert.equal(event.params.count, 7)
})

test('a fresh process reads what the previous one wrote', async () => {
  await resetFeed()
  await appendEvent({ sessionId: 's5', kind: 'switch', params: { index: 1 } })
  resetEventsCache()
  const feed = await readEvents('s5', 10)
  assert.equal(feed.events.length, 1)
  assert.equal(feed.events[0].kind, 'switch')
})

test('cleanup', async () => {
  await rm(home, { recursive: true, force: true })
})
