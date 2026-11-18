// Which side of the line an item sits on. The rule is a maintained list, so the
// test pins the real names observed on a working profile — when the list rots,
// this is where it shows.
import test from 'node:test'
import assert from 'node:assert/strict'

import { itemOrigin } from '../lib/origin.js'
import { summarizeGroups } from '../lib/group.js'

const official = [
  { channel: 'sections', name: 'harness:identity' },
  { channel: 'sections', name: 'harness:source' },
  { channel: 'sections', name: 'deployment:persona-prefix' },
  { channel: 'sections', name: 'tools:sdk' },
  { channel: 'sections', name: 'plan:policy' },
  { channel: 'sections', name: 'team:policy' },
  { channel: 'sections', name: 'context:file-reference' },
  { channel: 'sections', name: 'app:web-surface' },
  { channel: 'sections', name: 'ui:deliverable-file-references' },
  { channel: 'sections', name: 'mcp-resource-servers' },
  { channel: 'contexts', name: 'working-directory:current' },
  { channel: 'contexts', name: 'sandbox:policy' },
  { channel: 'contexts', name: 'approval:policy' },
  { channel: 'contexts', name: 'subagent:identity' },
  { channel: 'contexts', name: 'tool:subagent' },
  { channel: 'tools', name: 'read' },
  { channel: 'tools', name: 'pwsh' },
  { channel: 'tools', name: 'todo_write' },
  { channel: 'tools', name: 'send_message', groupLabel: 'core' },
  { channel: 'tools', name: 'schedule_create', groupLabel: 'schedule' },
  { channel: 'tools', name: 'job_output', groupLabel: 'job' },
  { channel: 'tools', name: 'subagent_fork', groupLabel: 'subagent' },
  { channel: 'tools', name: 'web_search', groupLabel: 'web' },
  { channel: 'tools', name: 'plugin_manager', groupLabel: 'plugin' },
  { channel: 'skills', name: 'dsh-doc' },
  { channel: 'instructions', name: 'AGENTS.md' },
]

const thirdParty = [
  // Observed on the reference profile: a plugin prompt section with a bare name.
  { channel: 'sections', name: 'dsh-context' },
  // An MCP server's prompt section.
  { channel: 'sections', name: 'mcp:rea' },
  // MCP tool namespace.
  { channel: 'tools', name: 'mcp__rea__analyze_function', groupLabel: 'REA' },
  // A plugin's tool family, with no MCP prefix in sight.
  { channel: 'tools', name: 'agentero_import_paper', groupLabel: 'agentero' },
  { channel: 'tools', name: 'agentero_discover_arxiv', groupLabel: 'agentero' },
  { channel: 'tools', name: 'dsh_office_export', groupLabel: 'dsh-office' },
  // Provider-backed skill.
  { channel: 'skills', name: 'dsh-office', provider: 'dsh-office', source: 'preset' },
  // A bare section nobody listed yet must not be called official by accident.
  { channel: 'sections', name: 'some-new-plugin' },
  { channel: 'contexts', name: 'mnemon:memory' },
]

test('official names stay on the DeepSeek side', () => {
  for (const item of official) assert.equal(itemOrigin(item), 'builtin', `${item.channel}:${item.name}`)
})

test('a plugin is never hidden inside the official bucket', () => {
  for (const item of thirdParty) assert.equal(itemOrigin(item), 'plugin', `${item.channel}:${item.name}`)
})

test('a suite is official only when most of its items are', () => {
  const row = (name, origin, tokens = 10) => ({
    channel: 'tools',
    name,
    tokens,
    chars: tokens * 4,
    origin,
    group: 'tools:agentero',
    groupLabel: 'agentero',
    locked: false,
  })
  const thirdMajority = summarizeGroups([row('a', 'plugin'), row('b', 'plugin'), row('c', 'builtin')])
  assert.equal(thirdMajority[0].origin, 'plugin')
  const officialMajority = summarizeGroups([row('a', 'plugin'), row('b', 'builtin'), row('c', 'builtin')])
  assert.equal(officialMajority[0].origin, 'builtin')
})
