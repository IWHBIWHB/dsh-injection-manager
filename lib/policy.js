// Policy: the only state this plugin owns.
//
// One JSON file under $DSH_HOME/injection-manager/policy.json. Nothing else is
// written: the plugin never edits AGENTS.md, SKILL.md or any workspace file.
// Every switch is expressed as a registration that a new session's agent
// context applies and that disappears with that agent, so turning a switch off
// is always reversible and never touches the user's source files.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'

export const POLICY_VERSION = 2
const DIRECTORY_NAME = 'injection-manager'
const FILE_NAME = 'policy.json'
// The previous good file sits next to the live one; `readPolicy` recovers from it
// when a write was interrupted and the JSON no longer parses.
const BACKUP_SUFFIX = '.bak'
// Unique temp-file suffix; bumped on every write (see `writePolicy`).
let tempCounter = 0
// Earlier names of this plugin kept their policy here; importing one once makes
// each rename lossless instead of asking the user to redo every switch.
const LEGACY_DIRECTORY_NAMES = ['context-injection', 'context-preflight']

export const CHANNELS = Object.freeze(['sections', 'contexts', 'skills', 'tools'])
export const MODES = Object.freeze(['all', 'only', 'except'])

export function defaultPolicy() {
  return {
    version: POLICY_VERSION,
    preset: 'all',
    sections: { mode: 'all', names: [] },
    contexts: { mode: 'all', names: [] },
    skills: { mode: 'all', names: [] },
    tools: { mode: 'all', names: [] },
    prompt: { prefix: '', suffix: '' },
    updatedAt: null,
  }
}

export function resolveDshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim().length > 0) return resolvePath(configured)
  return join(homedir(), '.dsh')
}

export const policyFilePath = () => join(resolveDshHome(), DIRECTORY_NAME, FILE_NAME)
const legacyPolicyPaths = () => LEGACY_DIRECTORY_NAMES.map((name) => join(resolveDshHome(), name, FILE_NAME))

function normalizeNames(raw) {
  if (!Array.isArray(raw)) return []
  const names = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length === 0 || names.includes(trimmed)) continue
    names.push(trimmed)
  }
  return names
}

function normalizeChannel(raw, channel) {
  const fallback = { mode: 'all', names: [] }
  if (raw === null || typeof raw !== 'object') return fallback
  if (MODES.includes(raw.mode)) fallback.mode = raw.mode
  fallback.names = normalizeNames(raw.names)
  if (fallback.mode === 'all') fallback.names = []
  return fallback
}

export function normalizePolicy(raw) {
  const policy = defaultPolicy()
  if (raw === null || typeof raw !== 'object') return policy
  if (typeof raw.preset === 'string' && raw.preset.length > 0) policy.preset = raw.preset
  for (const channel of CHANNELS) policy[channel] = normalizeChannel(raw[channel], channel)
  // "exclude nothing" is the same as "keep everything"; normalise it so the
  // panel does not show a custom mode after switching a whole suite back on.
  for (const channel of CHANNELS) {
    if (policy[channel].mode === 'except' && policy[channel].names.length === 0) policy[channel].mode = 'all'
  }
  if (raw.prompt !== null && typeof raw.prompt === 'object') {
    policy.prompt.prefix = typeof raw.prompt.prefix === 'string' ? raw.prompt.prefix : ''
    policy.prompt.suffix = typeof raw.prompt.suffix === 'string' ? raw.prompt.suffix : ''
  }
  if (typeof raw.updatedAt === 'string') policy.updatedAt = raw.updatedAt
  return policy
}

/**
 * Read the policy. A missing file, unparsable JSON and a failed read all fall
 * back to "everything on" so a broken policy can never silently hide half of
 * the prompt; the error travels back to the panel instead.
 */
export async function readPolicy() {
  const path = policyFilePath()
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return { policy: defaultPolicy(), path, exists: false, error: `read failed: ${error?.code ?? error}` }
    }
    return readLegacyPolicy(path)
  }
  try {
    return { policy: normalizePolicy(JSON.parse(text)), path, exists: true }
  } catch (error) {
    // A corrupt file is the dangerous case: falling back to "everything on"
    // quietly re-enables every suite the user had closed, and the panel would
    // then show a policy nobody asked for. `writePolicy` keeps the previous good
    // file beside the live one; recover from it before falling back.
    const recovered = await readBackup(path)
    const detail = `invalid JSON: ${error?.message ?? error}`
    if (recovered !== undefined) {
      return { policy: recovered, path, exists: true, error: `${detail}; recovered from ${BACKUP_SUFFIX}`, recovered: true }
    }
    return { policy: defaultPolicy(), path, exists: true, error: detail }
  }
}


async function readBackup(path) {
  try {
    const text = await readFile(path + BACKUP_SUFFIX, 'utf8')
    return normalizePolicy(JSON.parse(text))
  } catch {
    return undefined
  }
}

async function readLegacyPolicy(path) {
  for (const candidate of legacyPolicyPaths()) {
    try {
      const text = await readFile(candidate, 'utf8')
      const migrated = normalizePolicy(JSON.parse(text))
      migrated.migratedFrom = candidate
      return { policy: migrated, path, exists: false, legacy: true }
    } catch {
      /* try the next historical location */
    }
  }
  return { policy: defaultPolicy(), path, exists: false }
}

// Writes are serialised even for callers that do not hold the mutation queue:
// on Windows a rename over a file that a concurrent reader/writer still has open
// fails with EPERM, and two renames racing can publish a half-written file.
let writeChain = Promise.resolve()

/**
 * Atomic write: same-directory temp file plus rename, so a crash keeps the old
 * policy. Queued behind any in-flight write; callers inside `withPolicyLock`
 * also hold the read-modify-write queue, this one only protects the file itself.
 */
export function writePolicy(raw) {
  const task = writeChain.then(
    () => commitPolicy(raw),
    () => commitPolicy(raw),
  )
  writeChain = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

async function commitPolicy(raw) {
  const policy = normalizePolicy(raw)
  policy.updatedAt = new Date().toISOString()
  const path = policyFilePath()
  await mkdir(dirname(path), { recursive: true })
  // `pid + Date.now()` collides when two writes land in the same millisecond: the
  // two temp files get the same name, one rename wins and the other either
  // overwrites mid-flight or publishes a half-written file. A counter plus
  // randomness makes the name unique even inside one millisecond.
  tempCounter += 1
  const temporary = `${path}.tmp-${process.pid}-${tempCounter}-${Math.random().toString(36).slice(2, 8)}`
  const text = `${JSON.stringify(policy, null, 2)}\n`
  // Keep the previous good file for `readPolicy`'s corruption recovery. Copied
  // before the rename, so a crash leaves either the old pair or the new pair.
  try {
    await writeFile(path + BACKUP_SUFFIX, await readFile(path, 'utf8'))
  } catch {
    /* first write, or an unreadable previous file: nothing to keep */
  }
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
  return { policy, path }
}


// ---------------------------------------------------------------- matching

/** Exact name, `prefix*`, or a trailing `_`/`__` treated as a prefix (MCP groups). */
export function nameMatcher(entries) {
  const exact = new Set()
  const prefixes = []
  for (const entry of normalizeNames(entries)) {
    if (entry === '*') prefixes.push('')
    else if (entry.endsWith('*')) prefixes.push(entry.slice(0, -1))
    else if (entry.endsWith('_')) prefixes.push(entry)
    else exact.add(entry)
  }
  return (name) => exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix))
}

/**
 * Is this item excluded from the next injection?
 * `all` keeps everything, `only` keeps the listed names, `except` drops them.
 */
export function isExcluded(channelPolicy, name) {
  if (channelPolicy.mode === 'all') return false
  const matches = nameMatcher(channelPolicy.names)(name)
  return channelPolicy.mode === 'only' ? !matches : matches
}

/** Expand `only`/`except` entries against the names that actually exist right now. */
export function selectExcluded(channelPolicy, names) {
  if (channelPolicy.mode === 'all') return []
  return names.filter((name) => isExcluded(channelPolicy, name))
}

export function selectIncluded(channelPolicy, names) {
  if (channelPolicy.mode === 'all') return [...names]
  return names.filter((name) => !isExcluded(channelPolicy, name))
}

/** Serialisable view for the panel; keeps the UI from re-deriving semantics. */
export function describeChannel(channelPolicy, names) {
  const excluded = selectExcluded(channelPolicy, names)
  return {
    mode: channelPolicy.mode,
    names: channelPolicy.names,
    excluded,
    included: names.length - excluded.length,
    total: names.length,
  }
}
