// Policy actions shared by the HTTP surface and the slash command.
//
// `undo` lives here so both entry points pop the same history stack and write
// through the same atomic path; duplicating it would let the two drift.
import { popUndo, pushUndo } from './history.js'
import { normalizePolicy } from './policy.js'
import { savePolicy } from './apply.js'

export async function undoLastPolicy() {
  const previous = popUndo()
  if (previous === undefined) throw new Error('nothing-to-undo')
  const restored = normalizePolicy(previous.policy)
  await savePolicy(restored)
  return restored
}

export { pushUndo }
