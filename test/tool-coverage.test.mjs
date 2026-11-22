// Catalog coverage for tool owners: the shipped-source map must resolve host
// tools, and anything unmatched must degrade to a labelled "unlisted" row
// instead of silently claiming a provider.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTROL, catalogRows, sectionOwner, toolOwner } from '../lib/catalog.js'
import { HOST_TOOL_PROVIDERS } from '../lib/tool-map.js'

test('mcp server tools are attributed to the server, not to a package', () => {
  const row = toolOwner('mcp__rea__inspect_web_page')
  assert.equal(row.kind, 'mcp-tool')
  assert.match(row.owner, /MCP server "rea"/)
  assert.equal(row.control, CONTROL.plugin)
})

test('shipped host tools resolve through the generated map', () => {
  const cases = {
    list_mcp_resources: 'dsh-mcp-resources',
    read_mcp_resource: 'dsh-mcp-resources',
    load_workspace_dependencies: 'dsh-tool-workspace-dependencies',
    team_task_list: 'dsh-tool-agent-team',
    read_image: 'dsh-tool-fs',
    session_search: 'dsh-tool-session-query',
    terminal_open: 'dsh-tool-terminal',
    office_render: 'dsh-tool-office',
    plugin_market: 'dsh-plugin-market',
  }
  for (const [name, pkg] of Object.entries(cases)) {
    const row = toolOwner(name)
    assert.equal(row.owner, pkg, `${name} should resolve to ${pkg}`)
    assert.equal(row.control, CONTROL.plugin, `${name} should be plugin-controllable`)
  }
})

test('the generated map keeps every entry attributed to one package', () => {
  for (const [name, pkg] of Object.entries(HOST_TOOL_PROVIDERS)) {
    assert.equal(typeof name, 'string')
    assert.equal(typeof pkg, 'string')
    assert.ok(pkg.startsWith('dsh-') || pkg.startsWith('@'), `${name} -> ${pkg}`)
    // the map is only a fallback; hand rules must still agree where they overlap
    if (name === 'plugin_manager') assert.equal(pkg, 'dsh-plugin-manager')
  }
  assert.ok(Object.keys(HOST_TOOL_PROVIDERS).length >= 60)
})

test('unknown tools are unlisted, never a fake provider', () => {
  const row = toolOwner('definitely_not_a_real_tool_xyz')
  assert.equal(row.kind, 'unknown')
  assert.equal(row.owner, 'unlisted source')
  assert.equal(row.control, CONTROL.preview)
  assert.match(row.note.zh, /归属目录里没有这条来源/)
})

test('tool:<name> sections resolve to the package that writes them', () => {
  const cases = {
    'tool:pwsh': 'dsh-tool-pwsh',
    'tool:read': 'dsh-tool-fs',
    'tool:jobs': 'dsh-tool-jobs',
    'tool:schedule': 'dsh-tool-schedule',
    'tool:goal': 'dsh-tool-goal',
    'tool:web_search': 'dsh-tool-web',
    'tool:subagent': 'dsh-tool-subagent',
    'tool:workflow': 'dsh-tool-workflow',
  }
  for (const [name, pkg] of Object.entries(cases)) {
    const row = sectionOwner(name)
    assert.equal(row.owner, pkg, `${name} should resolve to ${pkg}`)
    assert.equal(row.control, CONTROL.plugin)
  }
  // anything the map cannot resolve keeps the generic, honest label
  assert.match(sectionOwner('tool:nope').owner, /tool package/)
})

test('the catalog rows keep their own tool entries for the client', () => {
  const rows = catalogRows()
  assert.ok(rows.sections.length >= 10)
  assert.ok(rows.contexts.length >= 6)
  assert.ok(rows.messages.length >= 15)
})
