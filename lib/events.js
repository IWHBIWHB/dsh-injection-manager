// Injection events: an append-only feed of what changed a session's first-turn
// context, so the insights tab can show a timeline instead of only totals.
//
// One JSON file under $DSH_HOME/injection-manager/events.json. Writes are
// tmp+rename (a crash keeps the previous feed), the feed is capped at 300
// events, and dedupe keys make replayed host events idempotent: a compaction
// receipt observed twice must not become two rows.
//
// Privacy boundary: events describe policy and session metadata only. The
// normalizer below flattens params to primitives and truncates every string, so
// a caller cannot accidentally persist prompt text or a skill body here.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from './policy.js'

const VERSION = 1
const FILE_NAME = 'events.json'
// Single string value ceiling inside params. Long enough for a suite label or a
// file relpath, short enough that a feed row can never carry a document.
const PARAM_TEXT_LIMIT = 200
const MAX_PARAM_ENTRIES = 24

/** The fixed kind enum. The UI owns the locale text (`ev.<kind>`). */
export const EVENT_KINDS = Object.freeze([
  'session-created',
  'policy-saved',
  'preset',
  'budget',
  'switch',
  'undo',
  'import',
  'compaction',
  'prune',
  'model-switch',
  'mode-toggle',
  'diagnostic',
])

export const EVENT_LIMIT = 300

export const eventsFilePath = () => join(resolveDshHome(), 'injection-manager', FILE_NAME)

let cache = null
let writing = null
let dirty = false

function blank() {
  return { version: VERSION, events: [] }
}

function isPlainEvent(value) {
  return value !== null && typeof value === 'object' && typeof value.kind === 'string' && typeof value.at === 'number'
}

async function load() {
  if (cache !== null) return cache
  try {
    const parsed = JSON.parse(await readFile(eventsFilePath(), 'utf8'))
    const events = Array.isArray(parsed?.events) ? parsed.events.filter(isPlainEvent) : []
    cache = { version: VERSION, events: events.slice(-EVENT_LIMIT) }
  } catch {
    cache = blank()
  }
  return cache
}

/** Keep the newest EVENT_LIMIT entries, then write once per burst. */
async function flush() {
  if (writing !== null) {
    dirty = true
    return writing
  }
  writing = (async () => {
    try {
      do {
        dirty = false
        const state = cache ?? blank()
        const events = state.events.slice(-EVENT_LIMIT)
        const body = JSON.stringify({ version: VERSION, events })
        const target = eventsFilePath()
        await mkdir(dirname(target), { recursive: true })
        const temporary = `${target}.tmp-${process.pid}`
        await writeFile(temporary, body, 'utf8')
        await rename(temporary, target)
      } while (dirty)
    } catch {
      /* the feed is a nicety; a failed write must never break a policy save */
    } finally {
      writing = null
    }
  })()
  return writing
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function clampPrimitive(value) {
  if (typeof value === 'string') return value.length > PARAM_TEXT_LIMIT ? value.slice(0, PARAM_TEXT_LIMIT) : value
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean' || value === null) return value
  return undefined
}

/**
 * Params are flat primitives only. Nested objects are dropped rather than
 * serialized: it keeps the feed row small, and it removes the easiest path by
 * which session text could end up in a durable file.
 */
function normalizeParams(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  let entries = 0
  for (const [key, value] of Object.entries(raw)) {
    if (entries >= MAX_PARAM_ENTRIES) break
    if (typeof key !== 'string' || key.length === 0) continue
    if (Array.isArray(value)) {
      const list = value.map(clampPrimitive).filter((entry) => entry !== undefined).slice(0, 20)
      if (list.length > 0) {
        out[key] = list
        entries += 1
      }
      continue
    }
    const primitive = clampPrimitive(value)
    if (primitive === undefined) continue
    out[key] = primitive
    entries += 1
  }
  return out
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/** Dedupe key for an event whose identity is its timestamp, kind and params. */
export function dedupeKeyFor(kind, params, at) {
  return `${Math.round(Number(at) || 0)}|${kind}|${hashText(stableStringify(params ?? {}))}`
}

/**
 * Append one event. Resolves `{added:true,event}` or `{added:false,...}` instead
 * of throwing: every call site is a side effect of a real mutation, and a feed
 * failure must never turn a saved policy into an error.
 */
export async function appendEvent(entry = {}) {
  try {
    const kind = typeof entry.kind === 'string' ? entry.kind : ''
    if (!EVENT_KINDS.includes(kind)) return { added: false, error: 'unknown-kind' }
    const at = Number.isFinite(entry.at) ? Math.round(entry.at) : Date.now()
    const params = normalizeParams(entry.params)
    const explicit = typeof entry.dedupeKey === 'string' && entry.dedupeKey.length > 0 ? entry.dedupeKey.slice(0, 120) : undefined
    const dedupeKey = explicit ?? dedupeKeyFor(kind, params, at)
    const state = await load()
    if (state.events.some((event) => event.dedupeKey === dedupeKey)) return { added: false, duplicate: true, dedupeKey }
    const sessionId = typeof entry.sessionId === 'string' && entry.sessionId.length > 0 ? entry.sessionId : undefined
    const tokensDelta = Number.isFinite(entry.tokensDelta) ? Math.round(entry.tokensDelta) : 0
    const event = {
      id: `evt_${hashText(`${dedupeKey}|${sessionId ?? ''}`)}`,
      at,
      kind,
      params,
      tokensDelta,
      sessionId,
      dedupeKey,
    }
    state.events.push(event)
    if (state.events.length > EVENT_LIMIT) state.events = state.events.slice(-EVENT_LIMIT)
    await flush()
    return { added: true, event }
  } catch {
    return { added: false, error: 'append-failed' }
  }
}

/** Test/module hook: wait for any queued write. */
export function flushEvents() {
  return writing ?? Promise.resolve()
}

function publicEvent(event) {
  const out = { id: event.id, at: event.at, kind: event.kind, params: event.params, tokensDelta: event.tokensDelta }
  if (typeof event.sessionId === 'string') out.sessionId = event.sessionId
  return out
}

/**
 * Read the newest `limit` events, oldest first inside the window so a timeline
 * renders top-to-bottom without the caller re-sorting. `sessionId` filters to
 * one conversation; omitting it reads the whole feed.
 */
export async function readEvents(sessionId, limit = 60) {
  const state = await load()
  // Route callers pass the query string verbatim; coerce before clamping.
  const requested = Number(limit)
  const max = Math.min(EVENT_LIMIT, Math.max(1, Number.isFinite(requested) ? Math.round(requested) : 60))
  const filtered =
    typeof sessionId === 'string' && sessionId.length > 0 ? state.events.filter((event) => event.sessionId === sessionId) : state.events.slice()
  const sorted = filtered.sort((left, right) => (left.at ?? 0) - (right.at ?? 0))
  const selected = sorted.slice(-max)
  return {
    events: selected.map(publicEvent),
    coverage: { from: selected.length > 0 ? selected[0].at : null, count: selected.length, limit: max },
  }
}

/** Test hook: forget the in-memory feed (the file stays as written). */
export function resetEventsCache() {
  cache = null
}
