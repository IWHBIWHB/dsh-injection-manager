// How full the context window is, read from the host instead of guessed.
//
// The harness already measures every request: `ctx.tokenMeter` folds the
// durable log into a provider-reported pressure number plus the capacity of the
// route that will answer, and the `contextBreakdown` projection splits the
// surviving surface into system / tools / messages. This plugin owned a
// numerator before (an "anchor" of what the session already costs) and no
// denominator, which is why every question about a number ended in "compare it
// with something else". This module supplies the denominator.
//
// Nothing here estimates a token. Every field is either the host's own number
// or null; the panel prints "—" rather than inventing a fallback.
import { percent } from './measure.js'

export const EMPTY_CONTEXT = {
  window: null,
  windowSource: null,
  pressure: null,
  projected: null,
  used: null,
  occupancy: null,
  remaining: null,
  breakdown: null,
  source: 'none',
}

const positive = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null)

// Adapter capacity is an async call into the provider registration; the answer
// for one route never changes within a process, so one small cache is enough.
const windowCache = new Map()
const WINDOW_CACHE_LIMIT = 32

function breakdownOf(values) {
  const raw = values === undefined || values === null ? undefined : values.contextBreakdown
  if (raw === undefined || raw === null) return null
  const system = Math.max(0, Math.round(Number(raw.systemTokens) || 0))
  const tools = Math.max(0, Math.round(Number(raw.toolsTokens) || 0))
  const messages = Math.max(0, Math.round(Number(raw.messageTokens) || 0))
  const total = system + tools + messages
  if (total <= 0) return null
  return { system, tools, messages, total }
}

/** The route the session will actually call, when one is already recorded. */
function routeOf(session) {
  try {
    const header = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
    const config = header === undefined || header === null ? undefined : header.config
    if (config === undefined || config === null) return null
    const provider = typeof config.provider === 'string' ? config.provider : ''
    const model = typeof config.model === 'string' ? config.model : ''
    if (provider === '' || model === '') return null
    return { provider, model }
  } catch {
    return null
  }
}

async function capacityOf(ctx, session, signal) {
  const route = routeOf(session)
  if (route === null) return null
  const key = `${route.provider}/${route.model}`
  if (windowCache.has(key)) return windowCache.get(key)
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null || typeof llm.resolveModelInfo !== 'function') return null
  let window = null
  try {
    const options = signal === undefined ? [route.provider, route.model] : [route.provider, route.model, signal]
    const info = await llm.resolveModelInfo(...options)
    window = positive(info?.context?.contextWindow)
  } catch {
    return null
  }
  windowCache.set(key, window)
  if (windowCache.size > WINDOW_CACHE_LIMIT) {
    const oldest = windowCache.keys().next()
    if (!oldest.done) windowCache.delete(oldest.value)
  }
  return window
}

/**
 * One synchronous read of the host's context measurement.
 *
 * `used` is what the NEXT request is expected to carry: the last provider
 * sample moved by whatever entered or left the surface since. `occupancy` is
 * the only place this plugin divides by the window, so the panel, the tool card
 * and the dock chip cannot disagree about the percentage.
 */
export async function readContext(ctx, agent, signal) {
  const session = agent?.session
  if (session === undefined || session === null) return { ...EMPTY_CONTEXT }

  const result = { ...EMPTY_CONTEXT, windowSource: null }
  const meter = ctx.get('tokenMeter')
  if (meter !== undefined && meter !== null && typeof meter.contextPressure === 'function') {
    try {
      const pressure = meter.contextPressure(session) ?? {}
      result.window = positive(pressure.contextWindow)
      if (result.window !== null) result.windowSource = 'projection'
      result.pressure = positive(pressure.pressureTokens)
      result.projected = positive(pressure.projectedTokens)
      result.used = result.projected ?? result.pressure
      if (result.window !== null || result.used !== null) result.source = 'tokenMeter'
    } catch {
      /* a host without the projection keeps the nulls */
    }
  }

  const projections = ctx.get('sessionProjections')
  if (projections !== undefined && projections !== null && typeof projections.snapshot === 'function') {
    try {
      const cut = projections.snapshot(session)
      result.breakdown = breakdownOf(cut === null || cut === undefined ? undefined : cut.values)
    } catch {
      /* composition is optional; the totals still stand */
    }
  }

  if (result.window === null) {
    result.window = await capacityOf(ctx, session, signal)
    if (result.window !== null) result.windowSource = 'llm'
  }

  if (result.window !== null && result.used !== null) {
    result.occupancy = percent(result.used, result.window)
    result.remaining = Math.max(0, result.window - result.used)
  }

  return result
}

/** Threshold buckets the panel colours: comfortable, tight, about to compact. */
export function occupancyTone(context) {
  const value = context === undefined || context === null ? null : context.occupancy
  if (!Number.isFinite(value)) return 'unknown'
  if (value >= 90) return 'danger'
  if (value >= 70) return 'warn'
  return 'ok'
}

/** Test hook: the adapter-capacity cache is per process, not per session. */
export function resetWindowCache() {
  windowCache.clear()
}
