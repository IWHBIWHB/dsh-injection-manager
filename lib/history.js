// Undo history for policy writes.
//
// Every mutation pushes the policy as it was *before* the write, so a mistaken
// suite toggle (229 names at once) is one click away from being reverted. Kept
// in memory only: the policy file itself is the durable truth, and a restart
// simply starts with an empty history.
const LIMIT = 20
const stack = []

export function pushUndo(policy) {
  stack.push(JSON.parse(JSON.stringify(policy)))
  while (stack.length > LIMIT) stack.shift()
}

export function popUndo() {
  return stack.pop()
}

export function undoState() {
  return { available: stack.length > 0, depth: stack.length }
}

export function clearUndo() {
  stack.length = 0
}
