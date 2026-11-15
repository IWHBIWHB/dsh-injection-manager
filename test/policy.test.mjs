// Pure-function tests for the policy math. No harness required; run with
// `node --test test/`.
import test from 'node:test'
import assert from 'node:assert/strict'

import { defaultPolicy, isExcluded, nameMatcher, normalizePolicy } from '../lib/policy.js'
import { planBudget, policyFromPlan, previewPolicy } from '../lib/snapshot.js'

const items = [
  { channel: 'sections', name: 'harness:identity', tokens: 10, chars: 40, locked: false },
  { channel: 'sections', name: 'deployment:persona-prefix', tokens: 20, chars: 80, locked: false },
  { channel: 'sections', name: 'tools:sdk', tokens: 300, chars: 1200, locked: false },
  { channel: 'contexts', name: 'working-directory:current', tokens: 30, chars: 120, locked: true },
  { channel: 'contexts', name: 'approval:policy', tokens: 40, chars: 160, locked: false },
  { channel: 'skills', name: 'dsh-doc', tokens: 50, chars: 200, locked: false },
  { channel: 'tools', name: 'mcp__rea__analyze_function', tokens: 400, chars: 1600, locked: false },
  { channel: 'tools', name: 'read', tokens: 60, chars: 240, locked: false },
  { channel: 'instructions', name: 'AGENTS.md', tokens: 70, chars: 280, locked: true },
]

const names = {
  sections: items.filter((i) => i.channel === 'sections').map((i) => i.name),
  contexts: items.filter((i) => i.channel === 'contexts').map((i) => i.name),
  skills: items.filter((i) => i.channel === 'skills').map((i) => i.name),
  tools: items.filter((i) => i.channel === 'tools').map((i) => i.name),
}

test('nameMatcher supports exact names, globs and MCP prefixes', () => {
  const match = nameMatcher(['read', 'mcp__rea__*', 'tool_'])
  assert.equal(match('read'), true)
  assert.equal(match('write'), false)
  assert.equal(match('mcp__rea__inspect'), true)
  assert.equal(match('tool_pwsh'), true)
})

test('isExcluded implements all/only/except', () => {
  assert.equal(isExcluded({ mode: 'all', names: [] }, 'read'), false)
  assert.equal(isExcluded({ mode: 'only', names: ['read'] }, 'read'), false)
  assert.equal(isExcluded({ mode: 'only', names: ['read'] }, 'write'), true)
  assert.equal(isExcluded({ mode: 'except', names: ['read'] }, 'read'), true)
  assert.equal(isExcluded({ mode: 'except', names: ['read'] }, 'write'), false)
})

test('locked items are never excluded and never counted as savings', () => {
  const policy = defaultPolicy()
  policy.contexts = { mode: 'only', names: [] }
  policy.instructions = { mode: 'only', names: [] }
  const preview = previewPolicy(policy, items, names)
  assert.deepEqual(preview.excluded.contexts, ['approval:policy'])
  assert.ok(!preview.excluded.contexts.includes('working-directory:current'))
  // working-directory (30) stays, approval (40) goes.
  assert.equal(preview.savedTokens, 40)
})

test('custom persona text replaces the persona section instead of stacking', () => {
  const policy = defaultPolicy()
  policy.prompt.prefix = 'x'.repeat(40) // 10 estimated tokens
  const preview = previewPolicy(policy, items, names)
  // persona-prefix (20) is replaced by 10 tokens: net -10.
  assert.equal(preview.savedTokens, 10)
  assert.ok(preview.replaced.includes('deployment:persona-prefix'))
})

test('budget planner drops the largest switchable items first', () => {
  const policy = defaultPolicy()
  const plan = planBudget(policy, items, 700)
  const dropped = plan.drop.map((entry) => entry.name)
  assert.equal(dropped[0], 'mcp__rea__analyze_function')
  assert.ok(!dropped.includes('AGENTS.md'))
  assert.ok(!dropped.includes('working-directory:current'))
  assert.ok(plan.after <= 700)
})

test('an unreachable budget is reported, not faked', () => {
  const policy = defaultPolicy()
  const plan = planBudget(policy, items, 1)
  assert.equal(plan.reachable, false)
  assert.ok(plan.after > 1)
})

test('policyFromPlan round-trips into an except policy', () => {
  const policy = defaultPolicy()
  const plan = planBudget(policy, items, 700)
  const next = policyFromPlan(policy, plan)
  for (const channel of ['sections', 'contexts', 'skills', 'tools']) {
    const dropped = plan.drop.filter((entry) => entry.channel === channel).map((entry) => entry.name)
    if (dropped.length === 0) {
      assert.equal(next[channel].mode, 'all')
      continue
    }
    assert.equal(next[channel].mode, 'except')
    for (const name of dropped) assert.ok(next[channel].names.includes(name))
  }
  const preview = previewPolicy(normalizePolicy(next), items, names)
  assert.ok(preview.after <= 700)
})
