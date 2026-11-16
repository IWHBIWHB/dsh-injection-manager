// Compaction receipts come from the durable log's own numbers, so the tests pin
// the two event shapes the harness documents and the arithmetic of a receipt.
import test from 'node:test'
import assert from 'node:assert/strict'

import { compactionOf, recordEvent, resetCompaction, watchCompaction } from '../lib/compaction.js'

const summary = (tokens) => ({ type: 'compaction/summary', data: { shadowedTokenCount: tokens, compactionId: 'c1' } })
const prune = (tokens) => ({ type: 'compaction/prune', data: { shadowedTokenCount: tokens } })

test('summaries and prunes both add to what compaction freed', () => {
  resetCompaction()
  recordEvent('s1', summary(40000))
  recordEvent('s1', prune(5000))
  recordEvent('s1', summary(2000))
  const receipt = compactionOf({ session: { id: 's1' } })
  assert.equal(receipt.count, 2)
  assert.equal(receipt.prunes, 1)
  assert.equal(receipt.saved, 47000)
  assert.equal(receipt.lastKind, 'summary')
  assert.equal(receipt.lastSaved, 2000)
})

test('a failed compaction is counted separately from a saving one', () => {
  resetCompaction()
  recordEvent('s2', { type: 'compaction/end', data: { error: 'summary request failed' } })
  recordEvent('s2', { type: 'compaction/end', data: {} })
  const receipt = compactionOf({ session: { id: 's2' } })
  assert.equal(receipt.failures, 1)
  assert.equal(receipt.count, 0)
  assert.equal(receipt.saved, 0)
})

test('unrelated events and anonymous sessions change nothing', () => {
  resetCompaction()
  recordEvent('s3', { type: 'assistant/message', data: {} })
  recordEvent('', summary(1000))
  recordEvent(undefined, summary(1000))
  assert.deepEqual(compactionOf({ session: { id: 's3' } }), {
    count: 0,
    prunes: 0,
    failures: 0,
    saved: 0,
    lastAt: null,
    lastSaved: 0,
    lastKind: null,
  })
})

test('an unknown session reads as an empty receipt and the reader is a copy', () => {
  resetCompaction()
  recordEvent('s4', summary(100))
  const first = compactionOf({ session: { id: 's4' } })
  first.saved = 999
  assert.equal(compactionOf({ session: { id: 's4' } }).saved, 100)
  assert.equal(compactionOf(undefined).count, 0)
})

test('the watcher forwards committed session events by session id', () => {
  resetCompaction()
  let listener = null
  const ctx = { on: (name, handler) => { assert.equal(name, 'session/event'); listener = handler; return () => {} } }
  watchCompaction(ctx)
  listener({ id: 's5' }, summary(700))
  assert.equal(compactionOf({ session: { id: 's5' } }).saved, 700)
  listener(undefined, summary(1))
  assert.equal(compactionOf({ session: { id: 's5' } }).saved, 700)
})
