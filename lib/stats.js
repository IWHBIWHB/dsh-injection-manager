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
 */
export async function backfillStats(sessionQuery, ids, { limit = 3, budgetMs = 4000 } = {}) {
  const state = await load()
  const started = Date.now()
  let added = 0
  for (const id of ids) {
    if (added >= limit || Date.now() - started > budgetMs) break
    const existing = state.sessions[id]
    if (existing !== undefined && existing.fromLog === true) continue
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
