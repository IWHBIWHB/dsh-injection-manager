// Cross-session trend: first-turn injection over time.
//
// Two honest sources are merged here and nowhere else:
//   - stats.json rows written by this plugin's own snapshots (`measured`);
//   - bounded durable-log backfill (`log`), priced by lib/stats.js.
// The backfill is requested in the background and never awaited by a read: on a
// 671-session corpus a synchronous 6s pass made every poll take 7s. The first
// response carries the measured rows (plus `backfilling:true`); later polls see
// the rows the background pass added.
// Older rows and log-priced rows have no channel split. They report
// `channels: null` rather than a fabricated zero: a striped "unknown" bar in the
// UI is correct, a zero bar would be a claim nobody measured.
import { backfillState, readStats, requestBackfill } from './stats.js'

export const TREND_RANGES = Object.freeze(['all', '30d', '7d'])
export const TREND_CHANNELS = Object.freeze(['sections', 'contexts', 'skills', 'tools', 'instructions'])
export const TREND_LIMIT = 120
export const TREND_LIMIT_MAX = 500

const DAY_MS = 24 * 60 * 60 * 1000

const num = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function rangeCutoff(range, now = Date.now()) {
  if (range === '30d') return now - 30 * DAY_MS
  if (range === '7d') return now - 7 * DAY_MS
  return 0
}

/** Per-channel split for one row, or null when this row predates the split. */
export function rowChannels(row) {
  const raw = row?.channels
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  let known = false
  for (const channel of TREND_CHANNELS) {
    const value = raw[channel]
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
      out[channel] = Number(value)
      known = true
    } else {
      out[channel] = null
    }
  }
  return known ? out : null
}

function rowCompactions(row) {
  const raw = row?.compactions
  if (raw === null || typeof raw !== 'object') return { count: 0, freed: 0 }
  return { count: num(raw.count), freed: num(raw.freed) }
}

/** `scope` is a free string in the revised contract; keep it bounded. */
const SCOPE_LIMIT = 64

export function clampScope(value) {
  const text = typeof value === 'string' ? value : ''
  return text.length > SCOPE_LIMIT ? text.slice(0, SCOPE_LIMIT) : text
}

/** One stats row → one chart point. Missing fields stay missing, not zero. */
export function pointFromRow(row) {
  const at = num(row?.at)
  const firstAt = num(row?.firstAt) || at
  const point = {
    sessionId: String(row?.id ?? ''),
    at,
    firstAt,
    cwd: typeof row?.cwd === 'string' ? row.cwd : '',
    // Contract revision (2026-11-16): a free string, typically
    // startup|clear|route.session|backfill; unknown values pass through raw.
    scope: clampScope(row?.scope),
    total: num(row?.allOn),
    effective: num(row?.effective),
    saved: num(row?.saved),
    channels: rowChannels(row),
    source: row?.fromLog === true ? 'log' : 'measured',
    samples: num(row?.samples),
    compactions: rowCompactions(row),
    // Contract revision: "unknown" is a legitimate value for v1 rows and log
    // rows; the UI renders it as a dash instead of guessing.
    policy: typeof row?.policy === 'string' && row.policy.length > 0 ? row.policy : 'unknown',
  }
  if (typeof row?.title === 'string' && row.title.length > 0) point.title = row.title
  return point
}

/**
 * Aggregate over the rows in range (before the `limit` cut, so the summary is
 * the whole range's summary rather than "the last 120 sessions only").
 */
export function aggregatePoints(points) {
  const sessions = points.length
  const measured = points.filter((point) => point.source === 'measured').length
  const totals = points.map((point) => point.total).filter((value) => value > 0)
  const sum = (pick) => points.reduce((acc, point) => acc + num(pick(point)), 0)
  const channelSum = {}
  const channelCount = {}
  for (const channel of TREND_CHANNELS) {
    channelSum[channel] = 0
    channelCount[channel] = 0
  }
  for (const point of points) {
    if (point.channels === null) continue
    for (const channel of TREND_CHANNELS) {
      const value = point.channels[channel]
      if (value === null) continue
      channelSum[channel] += value
      channelCount[channel] += 1
    }
  }
  const avgChannels = {}
  for (const channel of TREND_CHANNELS) {
    avgChannels[channel] = channelCount[channel] === 0 ? null : Math.round(channelSum[channel] / channelCount[channel])
  }
  return {
    sessions,
    measured,
    avgTotal: totals.length === 0 ? 0 : Math.round(totals.reduce((acc, value) => acc + value, 0) / totals.length),
    maxTotal: totals.reduce((max, value) => Math.max(max, value), 0),
    totalSaved: sum((point) => point.saved),
    avgChannels,
  }
}

function clampLimit(limit) {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed) || parsed <= 0) return TREND_LIMIT
  return Math.min(TREND_LIMIT_MAX, Math.max(1, Math.round(parsed)))
}

/**
 * Read the trend from what stats.json already has. The durable-log backfill is
 * requested in the background (single-flight, 60s cooldown, ≤8 logs / 6s);
 * this function never waits for it, which is what keeps /trend p95 well under
 * the 800ms route budget on a 671-session corpus. The next poll sees the rows
 * the background pass added.
 */
export async function readTrend(range = 'all', limit = TREND_LIMIT, ctx) {
  const safeRange = TREND_RANGES.includes(range) ? range : 'all'
  const safeLimit = clampLimit(limit)

  const request = requestBackfill(ctx)
  const state = backfillState()
  const stats = await readStats()
  const cutoff = rangeCutoff(safeRange)
  const inRange = stats.rows
    .filter((row) => (num(row.firstAt) || num(row.at)) >= cutoff)
    .sort((left, right) => (num(left.firstAt) || num(left.at)) - (num(right.firstAt) || num(right.at)))
  const points = inRange.slice(-safeLimit).map(pointFromRow)

  return {
    range: safeRange,
    generatedAt: Date.now(),
    points,
    // Aggregate covers the whole range (before the limit cut), so the summary
    // never changes just because the chart page changed.
    aggregate: aggregatePoints(inRange.map(pointFromRow)),
    coverage: { recorded: inRange.length, known: state.known },
    // UI hint: a bounded backfill pass is in flight (or was just started); the
    // measured rows already returned are complete, the rest arrives on poll.
    backfilling: request.started || request.running || state.running,
  }
}
