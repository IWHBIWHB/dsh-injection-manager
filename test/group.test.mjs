// Clustering tests: the naming heuristics are the whole point of "one switch
// for the REA suite", so they are pinned here.
import test from 'node:test'
import assert from 'node:assert/strict'

import { assignGroups, summarizeGroups } from '../lib/group.js'

const tool = (name) => ({ channel: 'tools', name, tokens: 10, chars: 40, locked: false })
const section = (name) => ({ channel: 'sections', name, tokens: 5, chars: 20, locked: false })
const skill = (name, provider) => ({ channel: 'skills', name, tokens: 3, chars: 12, locked: false, provider })
const context = (name) => ({ channel: 'contexts', name, tokens: 2, chars: 8, locked: false })

test('an MCP server namespace is one suite, including its sections', () => {
  const items = assignGroups([
    tool('mcp__rea__inspect_analysis_view'),
    tool('mcp__rea__analyze_function'),
    tool('mcp__other__do_thing'),
    section('mcp:rea'),
    section('tool:mcp__rea__analyze_function'),
  ])
  const rea = items.filter((item) => item.groupLabel === 'REA')
  assert.equal(rea.length, 4)
  assert.equal(new Set(rea.map((item) => item.group)).size, 2) // tools:… and sections:…
  assert.ok(items.every((item) => item.channel === 'sections' || item.channel === 'tools'))
})

test('repeated non-generic segments become families, singletons fall back to core', () => {
  const items = assignGroups([
    tool('agentero_list_papers'),
    tool('agentero_read_note'),
    tool('read'),
    tool('write'),
    tool('present'),
  ])
  const byName = Object.fromEntries(items.map((item) => [item.name, item.groupLabel]))
  assert.equal(byName['agentero_list_papers'], 'agentero')
  assert.equal(byName['agentero_read_note'], 'agentero')
  assert.equal(byName.read, 'core')
  assert.equal(byName.write, 'core')
  assert.equal(byName.present, 'core')
})

test('generic verbs never become their own group', () => {
  const items = assignGroups([tool('list_agents'), tool('list_mcp_resources'), tool('get_goal'), tool('create_goal')])
  assert.ok(items.every((item) => item.groupLabel === 'core'))
})

test('skills group by provider, contexts by namespace', () => {
  const items = assignGroups([
    skill('dsh-doc', 'dsh-agent-preset'),
    skill('tdd', 'dsh-agent-preset'),
    skill('custom', 'my-plugin'),
    context('approval:policy'),
    context('tool:subagent:depth'),
  ])
  const byName = Object.fromEntries(items.map((item) => [item.name, item.groupLabel]))
  assert.equal(byName['dsh-doc'], 'dsh-agent-preset')
  assert.equal(byName.custom, 'my-plugin')
  assert.equal(byName['approval:policy'], 'approval')
  assert.equal(byName['tool:subagent:depth'], 'tool:subagent')
})

test('summaries sort by size and exclude locked tokens from savings', () => {
  const items = assignGroups([
    { channel: 'instructions', name: 'AGENTS.md', tokens: 100, chars: 400, locked: true },
    tool('mcp__rea__a'),
    tool('mcp__rea__b'),
  ])
  const groups = summarizeGroups(items)
  assert.equal(groups[0].label, 'rules')
  assert.equal(groups[0].savableTokens, 0)
  const rea = groups.find((group) => group.label === 'REA')
  assert.equal(rea.count, 2)
  assert.equal(rea.tokens, 20)
  assert.equal(rea.savableTokens, 20)
})

test('summaries keep the measured size and the policy-effective size apart', () => {
  const items = assignGroups([
    { channel: 'tools', name: 'mcp__rea__a', tokens: 100, chars: 400, locked: false, on: false },
    { channel: 'tools', name: 'mcp__rea__b', tokens: 10, chars: 40, locked: false, on: true },
  ])
  const rea = summarizeGroups(items).find((group) => group.label === 'REA')
  assert.equal(rea.count, 2)
  assert.equal(rea.tokens, 110)
  assert.equal(rea.offCount, 1)
  assert.equal(rea.offTokens, 100)
  assert.equal(rea.onCount, 1)
  assert.equal(rea.onTokens, 10)
  assert.equal(rea.onSavableTokens, 10)
})
