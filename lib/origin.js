// Which side of the line an injected item sits on: DeepSeek's own harness, or a
// plugin / MCP server somebody installed.
//
// The host does not answer this. `ToolSchema` is {name, description, parameters}
// and a prompt section is {name, text} — neither carries an owner. The only
// honest classification is a maintained list, so this file is data, not logic:
// when a new official family appears, add its name or prefix here; when a plugin
// shows up on the wrong side, add its prefix to THIRD_PARTY_PREFIXES.
//
// Defaults are deliberately asymmetric:
//   - tools and skills: unknown means third party. A user looking for "what did I
//     install that costs 6k" must not have a plugin hidden under "official".
//   - sections and contexts: unknown means third party too, because the harness
//     names every section it owns with a namespace (`harness:`, `tools:`…) and a
//     bare name like `dsh-context` is a plugin's.
export const OFFICIAL_TOOL_NAMES = new Set([
  // Core file / shell / planning tools.
  'read',
  'read_image',
  'write',
  'edit',
  'glob',
  'grep',
  'pwsh',
  'todo_write',
  'present',
  'ask_user_question',
  'skill',
  'working_directory',
  // Jobs, schedules, agents, goals, and the harness' own registry.
  'job_list',
  'job_output',
  'job_kill',
  'schedule_create',
  'schedule_edit',
  'schedule_list',
  'schedule_view',
  'subagent',
  'subagent_fork',
  'send_message',
  'list_agents',
  'wait_agent',
  'create_goal',
  'get_goal',
  'update_goal',
  'create_worktree',
  'plugin_manager',
  'workflow',
  // Web and MCP resource access.
  'web_search',
  'web_fetch',
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
])

// Tool families (the leading segment `group.js` clusters by). `core` is the
// catch-all for single-word tools; every family below is registered by the host.
export const OFFICIAL_TOOL_FAMILIES = new Set([
  'core',
  'tool-guidance',
  'subagent',
  'workflow',
  'job',
  'goal',
  'schedule',
  'task',
  'team',
  'web',
  'ask',
  'plugin',
  'skill',
  'present',
  'todo',
])

// Prompt sections the harness assembles itself. A plugin section is bare or uses
// its own namespace, so the prefix list doubles as the plugin test.
export const OFFICIAL_SECTION_PREFIXES = [
  'harness:',
  'deployment:',
  'tools:',
  'plan:',
  'team:',
  'context:',
  'ui:',
  'app:',
  'session:',
  'runtime:',
  'tool:',
  'subagent:',
]

// Sections without a namespace that the host still owns.
export const OFFICIAL_SECTION_NAMES = new Set(['mcp-resource-servers', 'tool-guidance'])

export const OFFICIAL_CONTEXT_PREFIXES = [
  'working-directory:',
  'sandbox:',
  'approval:',
  'subagent:',
  'harness:',
  'app:',
  'plan:',
  'team:',
  'session:',
  'runtime:',
  'tool:',
  'context:',
]

// Obvious third-party markers, checked before anything else.
const THIRD_PARTY_PREFIXES = ['mcp__', 'mcp:', 'plugin:', 'plugin.', 'ext:']

const startsWithAny = (name, prefixes) => prefixes.some((prefix) => name.startsWith(prefix))

/**
 * 'builtin' (DeepSeek 官方) or 'plugin' (其他插件与 MCP).
 *
 * `item.groupLabel` is available because grouping runs before this: a plugin tool
 * is recognisable by the family it ended up in even when the tool name alone is
 * ambiguous.
 */
export function itemOrigin(item) {
  const name = String(item?.name ?? '')
  const channel = item?.channel
  if (channel === 'instructions') return 'builtin'
  if (channel === 'skills') return item?.provider !== undefined || item?.source === 'user' ? 'plugin' : 'builtin'
  if (startsWithAny(name, THIRD_PARTY_PREFIXES)) return 'plugin'
  if (channel === 'tools') {
    if (OFFICIAL_TOOL_NAMES.has(name)) return 'builtin'
    const family = String(item?.groupLabel ?? name.split('_')[0]).toLowerCase()
    return OFFICIAL_TOOL_FAMILIES.has(family) ? 'builtin' : 'plugin'
  }
  if (channel === 'contexts') return startsWithAny(name, OFFICIAL_CONTEXT_PREFIXES) ? 'builtin' : 'plugin'
  if (channel === 'sections') {
    if (OFFICIAL_SECTION_NAMES.has(name)) return 'builtin'
    return startsWithAny(name, OFFICIAL_SECTION_PREFIXES) ? 'builtin' : 'plugin'
  }
  return 'builtin'
}
