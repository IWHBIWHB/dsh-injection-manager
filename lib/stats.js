// History: one row per conversation this plugin has measured.
//
// The question the 统计 tab answers is "how much have my conversations been
// carrying, over time, and where did it go" — and the only source that can
// answer it without replaying every durable log is what the plugin already
// measured. So every snapshot that reaches the panel, the tool or the command
// updates a small per-session record here; the file is capped and written
// atomically, and the tab states its own coverage instead of implying it saw
// every conversation.
//
// Deliberately not done: replaying `sessionQuery.readSession()` for every
// session. That loads and validates complete logs (megabytes each), which is
// too expensive to run on a panel refresh.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from './policy.js'

const FILE_NAME = 'stats.json'
const VERSION = 1
const LIMIT = 400

export const statsFilePath = () => join(resolveDshHome(), 'injection-manager', FILE_NAME)

let cache = null
let writing = null
let dirty = false

function blank() {
  return { version: VERSION, sessions: {} }
}

async function load() {
  if (cache !== null) return cache
  try {
    const parsed = JSON.parse(await readFile(statsFilePath(), 'utf8'))
    cache = parsed !== null && typeof parsed === 'object' && parsed.sessions !== null && typeof parsed.sessions === 'object' ? parsed : blank()
  } catch {
    cache = blank()
  }
  return cache
}

/** Keep the newest LIMIT sessions, then write the file once per burst. */
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
        const entries = Object.entries(state.sessions)
        if (entries.length > LIMIT) {
          entries.sort((left, right) => (right[1].at ?? 0) - (left[1].at ?? 0))
          state.sessions = Object.fromEntries(entries.slice(0, LIMIT))
        }
        const body = JSON.stringify({ version: VERSION, sessions: state.sessions })
        const target = statsFilePath()
        await mkdir(dirname(target), { recursive: true })
        const temp = `${target}.tmp-${process.pid}`
        await writeFile(temp, body, 'utf8')
        await rename(temp, target)
      } while (dirty)
    } catch {
      /* history is a nicety; a failed write must never break a snapshot */
    } finally {
      writing = null
    }
  })()
  return writing
}

/**
 * Fold one measured snapshot into the history. Called on every snapshot build,
 * so it must stay allocation-light and never throw.
 */
export function recordSnapshot(snapshot) {
  const id = snapshot?.agent?.id
  if (typeof id !== 'string' || id.length === 0) return
  const state = cache ?? (cache = blank())
  const skills = snapshot.skillsState ?? {}
  const tools = snapshot.toolsState ?? {}
  const context = snapshot.context ?? {}
  const previous = state.sessions[id]
  const allOn = Number(snapshot.totals?.tokens) || 0
  const effective = Number(snapshot.effective?.totals?.tokens) || 0

  // Per-channel split: only snapshots built after v2.0 carry it. Old rows keep
  // whatever they had (nothing) — the trend renders that as unknown, not zero.
  const channelTokens = {}
  let channelKnown = false
  for (const channel of Array.isArray(snapshot.channels) ? snapshot.channels : []) {
    if (channel === null || typeof channel !== 'object' || typeof channel.id !== 'string') continue
    if (!Number.isFinite(Number(channel.tokens))) continue
    channelTokens[channel.id] = Number(channel.tokens)
    channelKnown = true
  }

  const compaction = context.compaction ?? {}
  state.sessions[id] = {
    id,
    at: Date.now(),
    firstAt: previous?.firstAt ?? Date.now(),
    cwd: typeof snapshot.cwd === 'string' ? snapshot.cwd : '',
    scope: typeof snapshot.agent?.scopeSource === 'string' ? snapshot.agent.scopeSource : '',
    allOn,
    effective,
    peak: Math.max(previous?.peak ?? 0, allOn),
    samples: (previous?.samples ?? 0) + 1,
    skills: Number(skills.catalogTokens) || 0,
    skillCount: Number(skills.total) || 0,
    tools: Number(tools.count) || 0,
    toolsTokens: (snapshot.channels ?? []).find((channel) => channel.id === 'tools')?.tokens ?? 0,
    window: Number(context.window) || null,
    used: Number(context.used) || null,
    occupancy: Number.isFinite(context.occupancy) ? context.occupancy : null,
    saved: Math.max(0, allOn - effective),
    policy: typeof snapshot.policy?.preset === 'string' ? snapshot.policy.preset : 'all',
    ...(channelKnown ? { channels: channelTokens } : {}),
    compactions: {
      count: Math.max(0, (Number(compaction.count) || 0) + (Number(compaction.prunes) || 0)),
      freed: Math.max(0, Number(compaction.saved) || 0),
    },
  }
  void flush()
}

/** Every recorded session, newest first, plus the aggregates the tab prints. */
export async function readStats() {
  const state = await load()
  const rows = Object.values(state.sessions).sort((left, right) => (right.at ?? 0) - (left.at ?? 0))
  const total = rows.length
  const sum = (pick) => rows.reduce((acc, row) => acc + (pick(row) || 0), 0)
  const average = (pick) => (total === 0 ? 0 : Math.round(sum(pick) / total))

  // One bucket per local day, so "上周比这周贵" is answerable at a glance.
  const days = new Map()
  for (const row of rows) {
    const day = new Date(row.at).toLocaleDateString('en-CA')
    const bucket = days.get(day) ?? { day, sessions: 0, allOn: 0, skills: 0, peak: 0 }
    bucket.sessions += 1
    bucket.allOn += row.allOn || 0
    bucket.skills += row.skills || 0
    bucket.peak = Math.max(bucket.peak, row.peak || 0)
    days.set(day, bucket)
  }

  return {
    rows,
    coverage: { recorded: total },
    aggregate: {
      sessions: total,
      avgAllOn: average((row) => row.allOn),
      avgEffective: average((row) => row.effective),
      avgSkills: average((row) => row.skills),
      totalSaved: sum((row) => row.saved),
      peakAllOn: rows.reduce((max, row) => Math.max(max, row.peak || 0), 0),
      heaviest: rows.slice().sort((left, right) => (right.peak || 0) - (left.peak || 0))[0] ?? null,
      maxSkill: rows.slice().sort((left, right) => (right.skills || 0) - (left.skills || 0))[0] ?? null,
    },
    days: [...days.values()].sort((left, right) => left.day.localeCompare(right.day)).slice(-30),
  }
}

/** Test hook: forget the in-memory cache (the file stays as written). */
export function resetStatsCache() {
  cache = null
}

/** Test/teardown hook: wait for a queued atomic write to land. */
export function flushStats() {
  return flush()
}

/**
 * Read one durable log and price what it was carrying.
 *
 * The durable shapes (probed against a real 18 MB log):
 *   request/header  → data.header = { config, adapterDefaults, tools }
 *   system/message  → data.message = { role, content, source, id }
 *
 * `sessionQuery.readSession()` replays and validates the complete log, so this
 * is the expensive path and it is never run on a plain `/stats` read: the route
 * calls it for a few unmeasured sessions per request under a wall-clock budget,
 * and the result is cached in stats.json under `from_log`.
 */
async function priceSession(sessionQuery, id) {
  const loaded = await sessionQuery.readSession(id)
  const events = Array.isArray(loaded?.events) ? loaded.events : Array.isArray(loaded) ? loaded : []
  if (events.length === 0) return null

  let tools = []
  let system = ''
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'request/header') {
      const header = event.data?.header ?? event.data ?? {}
      if (Array.isArray(header.tools)) tools = header.tools
    } else if (event.type === 'system/message') {
      const content = event.data?.message?.content ?? event.data?.content
      if (Array.isArray(content)) {
        const text = content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('')
        if (text.length > 0) system = text
      }
    }
  }

  let toolChars = 0
  for (const tool of tools) {
    try {
      toolChars += JSON.stringify(tool ?? {}).length
    } catch {
      /* a schema that cannot be serialised simply contributes nothing */
    }
  }
  const toolTokens = Math.round(toolChars / 4)
  const systemTokens = Math.round(system.length / 4)
  return {
    tools: tools.length,
    toolsTokens: toolTokens,
    systemTokens,
    peak: toolTokens + systemTokens,
  }
}

/**
 * Backfill a bounded number of unmeasured sessions from their durable logs.
 * Ids arrive newest-first, so the most recent conversations fill in first.
 * A row this plugin already has is never re-priced: measured rows carry the
 * per-channel split a log replay cannot recover, and a log-priced row is final.
 */
export async function backfillStats(sessionQuery, ids, { limit = 3, budgetMs = 4000 } = {}) {
  const state = await load()
  const started = Date.now()
  let added = 0
  for (const id of ids) {
    if (added >= limit || Date.now() - started > budgetMs) break
    const existing = state.sessions[id]
    if (existing !== undefined) continue
    try {
      const priced = await priceSession(sessionQuery, id)
      if (priced === null) continue
      state.sessions[id] = {
        ...(existing ?? {}),
        id,
        at: existing?.at ?? Date.now(),
        firstAt: existing?.firstAt ?? Date.now(),
        cwd: existing?.cwd ?? '',
        scope: 'backfill',
        allOn: priced.peak,
        effective: priced.peak,
        peak: priced.peak,
        samples: existing?.samples ?? 0,
        skills: 0,
        skillCount: 0,
        tools: priced.tools,
        toolsTokens: priced.toolsTokens,
        systemTokens: priced.systemTokens,
        window: existing?.window ?? null,
        used: existing?.used ?? null,
        occupancy: existing?.occupancy ?? null,
        saved: 0,
        policy: existing?.policy ?? 'unknown',
        fromLog: true,
      }
      added += 1
    } catch {
      /* one unreadable log must not stop the batch */
    }
  }
  if (added > 0) await flush()
  const remaining = Object.values(state.sessions).filter((row) => row.fromLog !== true).length
  return { added, remaining }
}

// ---------------------------------------------------------------- background backfill
//
// A read route must not wait for durable-log replay: at ~671 unmeasured
// sessions a single 6s backfill pass made /trend take 7s per poll. The read
// path therefore answers from stats.json immediately and asks for one bounded
// pass in the background. Single-flight (one pass per process), 60s cooldown,
// ≤8 logs / 6s per pass, failures silent — the next poll retries naturally.
const BACKFILL_COOLDOWN_MS = 60_000
const BACKFILL_BATCH = 8
const BACKFILL_BUDGET_MS = 6000
// The corpus index is only used to order the fill and to report `known`; a few
// thousand entries is cheap to keep in memory.
const SESSION_INDEX_LIMIT = 4000
const SESSION_INDEX_TTL_MS = 60_000

let sessionIndex = { at: 0, known: null, sessions: [] }
let backfillRun = null
let backfillLastAt = 0
let backfillLastResult = null
let backfillLastError = null

/** Test hook: forget the index, the cooldown and any completed pass. */
export function resetBackfillState() {
  sessionIndex = { at: 0, known: null, sessions: [] }
  backfillRun = null
  backfillLastAt = 0
  backfillLastResult = null
  backfillLastError = null
}

/**
 * What the route should report about the background fill:
 * `running` is true while a pass is in flight, `last` is the latest completed
 * pass, `known` is the corpus size (null until the index has been listed once).
 */
export function backfillState() {
  return {
    running: backfillRun !== null,
    lastAt: backfillLastAt,
    indexAt: sessionIndex.at,
    known: sessionIndex.known,
    sessions: sessionIndex.sessions,
    last: backfillLastResult,
    error: backfillLastError,
  }
}

function sessionQueryOf(ctx) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get('sessionQuery') : undefined
  } catch {
    return undefined
  }
}

async function refreshSessionIndex(sessionQuery) {
  if (sessionQuery === undefined || sessionQuery === null || typeof sessionQuery.listSessions !== 'function') return sessionIndex
  try {
    const listed = await sessionQuery.listSessions()
    if (!Array.isArray(listed)) return sessionIndex
    const sessions = listed
      .map((entry) => {
        const header = entry?.header ?? entry ?? {}
        return {
          id: typeof header.id === 'string' ? header.id : '',
          at: Number(header.createdAt) || 0,
          cwd: typeof header.cwd === 'string' ? header.cwd : '',
          live: entry?.live === true,
          subagent: typeof header.parentSession === 'string' && header.parentSession.length > 0,
        }
      })
      .filter((entry) => entry.id.length > 0)
      .sort((left, right) => right.at - left.at)
    sessionIndex = { at: Date.now(), known: listed.length, sessions: sessions.slice(0, SESSION_INDEX_LIMIT) }
  } catch {
    /* an unreadable session index leaves `known` unknown */
  }
  return sessionIndex
}

/**
 * Fire-and-forget: start one bounded backfill pass if allowed.
 * Returns immediately; never throws and never awaits log replay. The internal
 * promise is exposed only through `whenBackfillIdle()` for tests.
 */
export function requestBackfill(ctx) {
  if (backfillRun !== null) return { started: false, running: true }
  if (Date.now() - backfillLastAt < BACKFILL_COOLDOWN_MS) return { started: false, running: false }
  const sessionQuery = sessionQueryOf(ctx)
  if (sessionQuery === undefined || sessionQuery === null || typeof sessionQuery.readSession !== 'function') {
    return { started: false, running: false }
  }
  backfillLastAt = Date.now()
  backfillRun = (async () => {
    try {
      const fresh = sessionIndex.known !== null && Date.now() - sessionIndex.at < SESSION_INDEX_TTL_MS
      const index = fresh ? sessionIndex : await refreshSessionIndex(sessionQuery)
      const ids = index.sessions.map((entry) => entry.id)
      const result =
        ids.length === 0
          ? { added: 0, remaining: Object.values((await load()).sessions).filter((row) => row.fromLog !== true).length }
          : await backfillStats(sessionQuery, ids, { limit: BACKFILL_BATCH, budgetMs: BACKFILL_BUDGET_MS })
      backfillLastResult = { at: Date.now(), added: result.added, remaining: result.remaining, known: index.known }
      backfillLastError = null
    } catch (error) {
      backfillLastError = String(error?.message ?? error)
    } finally {
      backfillRun = null
    }
  })()
  return { started: true, running: true }
}

/** Test hook: await an in-flight pass (including its session-index refresh). */
export function whenBackfillIdle() {
  return backfillRun ?? Promise.resolve()
}
