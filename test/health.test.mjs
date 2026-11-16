// Health is a pure function over a snapshot. These tests pin the fixed code
// enum, the action payload shape that POST /action accepts, and the rule that a
// missing measurement never turns into a fabricated severity.
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHealth, HEALTH_ACTION_KINDS, HEALTH_CODES } from '../lib/health.js'

function snapshot(overrides = {}) {
  return {
    generatedAt: 1763300000000,
    totals: { tokens: 83800, savableTokens: 66700, chars: 300000, count: 300 },
    items: [
      { id: 'tool:mcp__rea__a', channel: 'tools', name: 'mcp__rea__a', tokens: 60000, locked: false },
      { id: 'section:harness:identity', channel: 'sections', name: 'harness:identity', tokens: 2000, locked: false },
      { id: 'skill:alpha', channel: 'skills', name: 'alpha', tokens: 300, locked: false, truncated: true },
      { id: 'instructions:C:/AGENTS.md', channel: 'instructions', name: 'AGENTS.md', tokens: 1580, locked: true },
    ],
    groups: [
      { id: 'tools:mcp:rea', channel: 'tools', label: 'REA', count: 230, tokens: 66715, savableTokens: 66715 },
      { id: 'sections:harness', channel: 'sections', label: 'harness', count: 1, tokens: 2000, savableTokens: 2000 },
    ],
    locks: [
      { channel: 'contexts', name: 'working-directory:current', reason: 'required-context', tokens: 100 },
      { channel: 'instructions', name: 'AGENTS.md', reason: 'no-public-hook', tokens: 1580 },
    ],
    policy: { exists: false, preset: 'all', budget: { tokens: 0 }, preview: { after: 83800, savedTokens: 0 } },
    context: { window: 200000, used: 50000, occupancy: 25 },
    skillsState: { total: 3, truncated: 1, complete: true },
    ...overrides,
  }
}

const byCode = (health, code) => health.checks.find((check) => check.code === code)

test('a suite over a quarter of the turn becomes a high heavy-suite check', () => {
  const health = buildHealth(snapshot())
  const check = byCode(health, 'heavy-suite')
  assert.ok(check, 'REA at 79.6% must be flagged')
  assert.equal(check.severity, 'high')
  assert.equal(check.params.label, 'REA')
  assert.equal(check.params.tokens, 66715)
  assert.equal(check.params.share, 79.6)
  assert.equal(check.params.count, 230)
  // The payload is directly executable against POST /action (kind 'group').
  assert.equal(check.action.kind, 'switch-group')
  assert.deepEqual(check.action.payload, {
    channel: 'tools',
    group: 'tools:mcp:rea',
    key: 'mcp:rea',
    enabled: false,
    op: 'off',
  })
  const smaller = health.checks.find((entry) => entry.code === 'heavy-suite' && entry.params.label === 'harness')
  assert.equal(smaller, undefined, 'a 2k suite is below the 25% gate and the 30k floor')
})

test('budget-gap reports the gap and suggests the largest switchable suite', () => {
  const health = buildHealth(
    snapshot({
      policy: { exists: true, preset: 'custom', budget: { tokens: 40000 }, preview: { after: 83800, savedTokens: 0 } },
    }),
  )
  const check = byCode(health, 'budget-gap')
  assert.ok(check)
  assert.equal(check.severity, 'high', 'more than double the budget')
  assert.equal(check.params.current, 83800)
  assert.equal(check.params.target, 40000)
  assert.equal(check.params.gap, 43800)
  assert.equal(check.params.tokens, 43800, 'locale health.budget-gap interpolates {tokens}')
  assert.equal(check.params.suggestion.label, 'REA')
  assert.equal(check.action.kind, 'switch-group')

  const tight = buildHealth(
    snapshot({
      policy: { exists: true, preset: 'custom', budget: { tokens: 80000 }, preview: { after: 83800, savedTokens: 0 } },
    }),
  )
  assert.equal(byCode(tight, 'budget-gap').severity, 'warn')
})

test('catalog truncation and locked items describe measurable facts', () => {
  const truncated = byCode(buildHealth(snapshot()), 'catalog-truncated')
  assert.ok(truncated)
  assert.equal(truncated.severity, 'info')
  assert.equal(truncated.params.count, 1)
  assert.equal(truncated.action.kind, 'open-content')
  assert.equal(truncated.action.payload.id, 'skill:alpha')

  // Small locked share stays silent; a real share is reported.
  assert.equal(byCode(buildHealth(snapshot()), 'locked-items'), undefined)
  const heavyLocks = buildHealth(
    snapshot({
      locks: [
        { channel: 'instructions', name: 'AGENTS.md', tokens: 20000 },
        { channel: 'contexts', name: 'working-directory:current', tokens: 20000 },
      ],
    }),
  )
  const locked = byCode(heavyLocks, 'locked-items')
  assert.ok(locked)
  assert.equal(locked.severity, 'warn', 'about half the turn cannot be switched off')
  assert.equal(locked.params.count, 2)
  assert.equal(locked.params.share, 47.7)
})

test('unknown window, no policy and empty catalog are info-level', () => {
  const unknown = byCode(buildHealth(snapshot({ context: { window: null, used: 50000 } })), 'unknown-window')
  assert.ok(unknown)
  assert.equal(unknown.severity, 'info')
  assert.equal(unknown.params.used, 50000)
  assert.equal(unknown.action, undefined)

  const noPolicy = byCode(buildHealth(snapshot()), 'no-policy')
  assert.ok(noPolicy)
  assert.equal(noPolicy.severity, 'info')
  assert.equal(noPolicy.params.savableTokens, 66700)
  assert.equal(noPolicy.action.kind, 'open-tab')
  assert.equal(noPolicy.action.payload.tab, 'settings')

  const saved = buildHealth(snapshot({ policy: { exists: true, preset: 'all', budget: { tokens: 0 }, preview: { after: 83800, savedTokens: 0 } } }))
  assert.equal(byCode(saved, 'no-policy'), undefined, 'a saved policy is not a no-policy session')

  const empty = byCode(
    buildHealth(snapshot({ skillsState: { total: 0, truncated: 0, complete: true } })),
    'empty-catalog',
  )
  assert.ok(empty)
  assert.equal(empty.severity, 'info')
  assert.equal(empty.action.kind, 'open-tab')

  const incomplete = buildHealth(snapshot({ skillsState: { total: 0, truncated: 0, complete: false } }))
  assert.equal(byCode(incomplete, 'empty-catalog'), undefined, 'an incomplete catalog is unknown, not empty')
})

test('every emitted code and action kind belongs to the fixed enum', () => {
  const health = buildHealth(snapshot())
  for (const check of health.checks) {
    assert.equal(HEALTH_CODES.includes(check.code), true, `${check.code} is in the enum`)
    if (check.action !== undefined) {
      assert.equal(HEALTH_ACTION_KINDS.includes(check.action.kind), true, `${check.action.kind} is a known action`)
      assert.equal(typeof check.action.payload, 'object')
    }
  }
  const order = { high: 0, warn: 1, info: 2 }
  const severities = health.checks.map((check) => order[check.severity])
  assert.deepEqual(severities, severities.slice().sort((left, right) => left - right), 'sorted by severity')
})

test('the summary counts the checks and carries the snapshot clock', () => {
  const health = buildHealth(snapshot())
  const counts = { high: 0, warn: 0, info: 0 }
  for (const check of health.checks) counts[check.severity] += 1
  assert.deepEqual(
    { high: health.summary.high, warn: health.summary.warn, info: health.summary.info },
    counts,
  )
  assert.equal(health.summary.checkedAt, 1763300000000)
  assert.equal(buildHealth(null).checks.length, 0)
  assert.equal(buildHealth(undefined).summary.checkedAt, null)
  // Pure: same input, same output, including ordering.
  assert.deepEqual(buildHealth(snapshot()), buildHealth(snapshot()))
})
