// Presets are computations over the live registry, not hard-coded name lists:
// a tool or section that this profile does not have is simply absent from the
// result instead of producing a policy entry that would throw at apply time.
import { defaultPolicy } from './policy.js'

const MINIMAL_SECTIONS = ['harness:identity', 'deployment:persona-prefix']
const MINIMAL_TOOLS = [
  'read',
  'write',
  'edit',
  'apply_patch',
  'glob',
  'grep',
  'pwsh',
  'bash',
  'todo_write',
  'ask_user_question',
  'present',
]

const keepExisting = (names, wanted) => {
  const set = new Set(names)
  return wanted.filter((name) => set.has(name))
}

/**
 * `all` keeps every channel open; `minimal` keeps the identity, the deployment
 * persona and the file/terminal tools, and drops guidance sections, runtime
 * snapshots, the skill catalog and every other tool schema.
 */
export function presetPolicy(name, channelNames) {
  const policy = defaultPolicy()
  policy.preset = name
  if (name === 'minimal') {
    policy.sections = { mode: 'only', names: keepExisting(channelNames.sections ?? [], MINIMAL_SECTIONS) }
    policy.contexts = { mode: 'only', names: [] }
    policy.skills = { mode: 'only', names: [] }
    policy.tools = { mode: 'only', names: keepExisting(channelNames.tools ?? [], MINIMAL_TOOLS) }
    return policy
  }
  policy.preset = 'all'
  return policy
}

export const PRESET_NAMES = ['all', 'minimal']
