// Snapshot renderings: the model-facing card and the plain-text report. Both
// must agree with the panel, so these tests pin the parts a user would quote in
// a bug report (totals, suite list, policy line, limitation notes).
import test from 'node:test'
import assert from 'node:assert/strict'

import { renderCard, renderText } from '../lib/text.js'

const snapshot = {
  generatedAt: 0,
  cwd: 'D:/work',
  channels: [
    { id: 'sections', count: 2, chars: 100, tokens: 30, savableTokens: 30, manageable: true },
    { id: 'contexts', count: 1, chars: 10, tokens: 5, savableTokens: 5, manageable: true },
    { id: 'skills', count: 1, chars: 20, tokens: 8, savableTokens: 8, manageable: true },
    { id: 'tools', count: 2, chars: 200, tokens: 60, savableTokens: 60, manageable: true },
    { id: 'instructions', count: 1, chars: 80, tokens: 25, savableTokens: 0, manageable: false },
  ],
  items: [
    { channel: 'sections', name: 'harness:identity', tokens: 10, chars: 40, locked: false },
    { channel: 'sections', name: 'tools:sdk', tokens: 20, chars: 60, locked: false },
    { channel: 'contexts', name: 'approval:policy', tokens: 5, chars: 10, locked: false },
    { channel: 'skills', name: 'dsh-doc', tokens: 8, chars: 20, locked: false },
    { channel: 'tools', name: 'mcp__rea__analyze_function', tokens: 50, chars: 160, locked: false },
    { channel: 'tools', name: 'read', tokens: 10, chars: 40, locked: false },
    { channel: 'instructions', name: 'AGENTS.md', tokens: 25, chars: 80, locked: true, lockReason: 'no-public-hook' },
  ],
  groups: [
    { id: 'tools:mcp:rea', channel: 'tools', label: 'REA', count: 1, tokens: 50, savableTokens: 50 },
    { id: 'tools:core', channel: 'tools', label: 'core', count: 1, tokens: 10, savableTokens: 10 },
  ],
  locks: [{ channel: 'instructions', name: 'AGENTS.md', reason: 'no-public-hook', tokens: 25 }],
  instructions: {
    budgetBytes: 65536,
    loadedCount: 1,
    files: [
      { display: 'AGENTS.md', status: 'loaded', bytes: 300 },
      { display: '~/.dsh/AGENTS.md', status: 'missing', bytes: 0 },
    ],
    warnings: [],
  },
  totals: { chars: 410, tokens: 128, savableTokens: 103, savablePercent: 80.5, anchor: null, delta: null },
  policy: {
    preset: 'custom',
    sections: { mode: 'all', names: [] },
    contexts: { mode: 'all', names: [] },
    skills: { mode: 'all', names: [] },
    tools: { mode: 'except', names: ['mcp__rea__analyze_function'] },
    prompt: { prefix: '', suffix: '' },
    budget: { tokens: 0 },
    path: 'C:/Users/x/.dsh/injection-manager/policy.json',
    exists: true,
    error: null,
    appliedToThisAgent: false,
    lastApplication: null,
    preview: { before: 128, after: 78, savedTokens: 50, savedPercent: 39.1, excluded: {}, addedTokens: 0, replaced: [] },
  },
}

test('the tool card names suites and the policy projection', () => {
  const card = renderCard(snapshot)
  assert.match(card, /REA/)
  assert.match(card, /首轮 128 token/)
  assert.match(card, /排除 mcp__rea__analyze_function/)
  assert.match(card, /新会话首轮 ≈ 78 token/)
  assert.match(card, /token 为估算/)
})

test('the text report marks missing instruction files and read-only entries', () => {
  const text = renderText(snapshot)
  assert.match(text, /\[缺失\] ~\/\.dsh\/AGENTS\.md/)
  assert.match(text, /\[加载\] AGENTS\.md/)
  assert.match(text, /工作区规则（DSH 直接注入，本插件只读）/)
  assert.match(text, /策略文件：C:\/Users\/x\/\.dsh\/injection-manager\/policy\.json/)
})

test('an anchored session is reported separately from the injection total', () => {
  const text = renderText({ ...snapshot, totals: { ...snapshot.totals, anchor: { tokens: 900, source: 'contextPressure' } } })
  assert.match(text, /本会话已占用 900 token/)
  assert.match(text, /不可直接比较/)
})

test('the window line names the denominator, the split and the compaction receipt', () => {
  const withContext = {
    ...snapshot,
    context: {
      window: 200000,
      pressure: 100000,
      projected: 120000,
      used: 120000,
      occupancy: 60,
      remaining: 80000,
      breakdown: { system: 10000, tools: 80000, messages: 30000, total: 120000 },
      compaction: { count: 2, prunes: 1, failures: 0, saved: 47000, lastAt: 1, lastSaved: 2000, lastKind: 'summary' },
    },
  }
  const text = renderText(withContext)
  assert.match(text, /上下文窗口：120,000 \/ 200,000 token（已用 60%，剩余 80,000）/)
  assert.match(text, /系统 10,000 · 工具 80,000 · 消息 30,000/)
  assert.match(text, /摘要 2 次 · 剪枝 1 次 · 省下 47,000 token/)
  const card = renderCard(withContext)
  assert.match(card, /\*\*上下文窗口\*\* 120,000 \/ 200,000 token/)
})

test('without a measured window neither rendering invents one', () => {
  for (const render of [renderText, renderCard]) {
    assert.doesNotMatch(render(snapshot), /上下文窗口/)
  }
})

test('the card tells a model what it can do, and that it cannot flip switches', () => {
  const card = renderCard(snapshot)
  assert.match(card, /\*\*能做什么\*\*/)
  assert.match(card, /只读，没有写入口/)
  assert.match(card, /REA/)
  assert.match(card, /没有\*\*受当前策略影响/, 'an unapplied session is called out')
})

test('an applied session does not carry the "not applied" advice', () => {
  const applied = { ...snapshot, policy: { ...snapshot.policy, appliedToThisAgent: true } }
  assert.doesNotMatch(renderCard(applied), /没有\*\*受当前策略影响/)
})

test('near the window limit the advice names the biggest suite to close', () => {
  const crowded = {
    ...snapshot,
    context: { window: 200000, used: 180000, occupancy: 90, remaining: 20000, compaction: { count: 0, prunes: 0, saved: 0, failures: 0 } },
  }
  assert.match(renderCard(crowded), /窗口已用 90%/)
  assert.match(renderCard(crowded), /REA，−50/)
})
