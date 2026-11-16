// Compaction receipts: what the harness already threw away for this session.
//
// The session log records `compaction/summary` (a summarizing compaction, with
// the heuristic price of everything it shadowed) and `compaction/prune`
// (a model-free prune of the same shape). Both carry `shadowedTokenCount`, so
// "how much did compaction save me" is a fact in the log rather than something
// this plugin has to infer from a shrinking total.
//
// The events are read from `session/event` as they commit. That listener only
// sees events from the moment this plugin is loaded, so the count is labelled
// as such instead of pretending to be the whole session — the alternative is
// replaying the durable log, which the session API explicitly deprecates for
// production callers.
const bySession = new Map()
const LIMIT = 200

const EMPTY = { count: 0, prunes: 0, failures: 0, saved: 0, lastAt: null, lastSaved: 0, lastKind: null }

function blank() {
  return { count: 0, prunes: 0, failures: 0, saved: 0, lastAt: null, lastSaved: 0, lastKind: null }
}

function remember(sessionId) {
  let state = bySession.get(sessionId)
  if (state === undefined) {
    state = blank()
    bySession.set(sessionId, state)
    if (bySession.size > LIMIT) {
      const oldest = bySession.keys().next()
      if (!oldest.done) bySession.delete(oldest.value)
    }
  }
  return state
}

/** Fold one committed session event into the per-session receipt. */
export function recordEvent(sessionId, event) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const type = event === undefined || event === null ? undefined : event.type
  if (type !== 'compaction/summary' && type !== 'compaction/prune' && type !== 'compaction/end') return

  const state = remember(sessionId)
  const data = event.data ?? {}
  if (type === 'compaction/summary') {
    const saved = Math.max(0, Math.round(Number(data.shadowedTokenCount) || 0))
    state.count += 1
    state.saved += saved
    state.lastAt = Date.now()
    state.lastSaved = saved
    state.lastKind = 'summary'
    return
  }
  if (type === 'compaction/prune') {
    const saved = Math.max(0, Math.round(Number(data.shadowedTokenCount) || 0))
    state.prunes += 1
    state.saved += saved
    state.lastAt = Date.now()
    state.lastSaved = saved
    state.lastKind = 'prune'
    return
  }
  if (typeof data.error === 'string' && data.error.length > 0) state.failures += 1
}

/** Subscribe the recorder to the host's committed-event feed. */
export function watchCompaction(ctx) {
  return ctx.on('session/event', (session, event) => {
    const id = session === undefined || session === null ? undefined : session.id
    if (typeof id !== 'string') return
    recordEvent(id, event)
  })
}

/** The receipt for one agent's session, or the empty receipt. */
export function compactionOf(agent) {
  const id = agent === undefined || agent === null ? undefined : agent?.session?.id
  const state = typeof id === 'string' ? bySession.get(id) : undefined
  if (state === undefined) return { ...EMPTY }
  return { ...state }
}

/** Test hook: drop every remembered receipt. */
export function resetCompaction() {
  bySession.clear()
}
