// Policy actions shared by the HTTP surface and the slash command.
//
// `undo` lives here so both entry points pop the same history stack and write
// through the same atomic path; duplicating it would let the two drift.
import { popUndo, pushUndo, restoreAt } from './history.js'
import { normalizePolicy } from './policy.js'
import { savePolicy } from './apply.js'

/**
 * `meta` is forwarded to savePolicy so the event feed records an undo as an
 * undo (with its session) instead of a generic policy write.
 */
export async function undoLastPolicy(meta = {}) {
  const previous = popUndo()
  if (previous === undefined) throw new Error('nothing-to-undo')
  const restored = normalizePolicy(previous.policy)
  await savePolicy(restored, { ...meta, kind: typeof meta.kind === 'string' ? meta.kind : 'undo' })
  return restored
}

export async function restorePolicyAt(index, meta = {}) {
  const entry = restoreAt(index)
  if (entry === undefined) throw new Error('nothing-to-restore')
  const restored = normalizePolicy(entry.policy)
  await savePolicy(restored, {
    ...meta,
    kind: typeof meta.kind === 'string' ? meta.kind : 'undo',
    params: { index, ...(meta.params !== null && typeof meta.params === 'object' ? meta.params : {}) },
  })
  return restored
}

export { pushUndo }
