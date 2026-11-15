// Per-channel on/total counts used by the apply report.
import test from 'node:test'
import assert from 'node:assert/strict'

import { countChannelState } from '../lib/snapshot.js'

const items = [
  { channel: 'tools', name: 'a' },
  { channel: 'tools', name: 'b' },
  { channel: 'sections', name: 's1' },
  { channel: 'skills', name: 'k1' },
]

test('all mode keeps everything on', () => {
  const counts = countChannelState(items, { channels: { tools: { mode: 'all', names: [] } } })
  assert.deepEqual(counts.tools, { on: 2, total: 2 })
})

test('except mode counts the excluded names as off', () => {
  const counts = countChannelState(items, { channels: { tools: { mode: 'except', names: ['b'] } } })
  assert.deepEqual(counts.tools, { on: 1, total: 2 })
})

test('only mode counts just the listed names', () => {
  const counts = countChannelState(items, { channels: { sections: { mode: 'only', names: ['s1'] } } })
  assert.deepEqual(counts.sections, { on: 1, total: 1 })
  assert.deepEqual(counts.skills, { on: 1, total: 1 })
})
