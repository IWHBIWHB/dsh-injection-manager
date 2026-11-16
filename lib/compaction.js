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
import { appendEvent } from './events.js'

const bySession = new Map()
const LIMIT = 200

const EMPTY = { count: 0, prunes: 0, failures: 0, saved: 0, lastAt: null, lastSaved: 0, lastKind: null }

function blank() {
  return { count: 0, prunes: 0, failures: 0, saved: 0, lastAt: null, lastSaved: 0, lastKind: null }
}

/**
 * Dedupe key for a replay-safe compaction event. The host commits an event once,
 * but a listener can be re-attached or a process can see the same committed
 * event twice; a stable id keeps the feed from growing duplicate rows. The
 * session id is part of the key because compaction ids are only scoped to one
 * session.
 */
function compactionKey(sessionId, kind, data) {
  const id = data?.compactionId ?? data?.seq ?? data?.id
  if (typeof id === 'string' || typeof id === 'number') return `compaction:${sessionId}:${kind}:${String(id)}`
  return undefined
}

function logCompaction(sessionId, kind, data, saved) {
  // Fire-and-forget: the receipt above is the durable number; the feed row is
  // presentation, and the session event loop must not wait on a file write.
  void appendEvent({
    sessionId,
    kind,
    params: {
      op: kind === 'prune' ? 'prune' : 'summary',
      saved,
      compactionId: typeof data?.compactionId === 'string' ? data.compactionId : undefined,
    },
    tokensDelta: -saved,
    dedupeKey: compactionKey(sessionId, kind, data),
  })
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
    logCompaction(sessionId, 'compaction', data, saved)
    return
  }
  if (type === 'compaction/prune') {
    const saved = Math.max(0, Math.round(Number(data.shadowedTokenCount) || 0))
    state.prunes += 1
    state.saved += saved
    state.lastAt = Date.now()
    state.lastSaved = saved
    state.lastKind = 'prune'
    logCompaction(sessionId, 'prune', data, saved)
    return
  }
  if (typeof data.error === 'string' && data.error.length > 0) {
    state.failures += 1
    void appendEvent({
      sessionId,
      kind: 'diagnostic',
      params: { phase: 'compaction', error: data.error, compactionId: typeof data.compactionId === 'string' ? data.compactionId : undefined },
      dedupeKey: compactionKey(sessionId, 'failure', data),
    })
  }
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
