// Undo history for policy writes.
//
// Every mutation pushes the policy as it was *before* the write together with a
// short human label, so the panel can say what "undo" will revert instead of a
// bare button. Kept in memory only: the policy file itself is the durable truth,
// and a restart starts with an empty history.
const LIMIT = 20
const stack = []

export function pushUndo(policy, label) {
  stack.push({
    policy: JSON.parse(JSON.stringify(policy)),
    label: typeof label === 'string' && label.trim().length > 0 ? label.trim().slice(0, 120) : 'change',
    at: Date.now(),
  })
  while (stack.length > LIMIT) stack.shift()
}

export function popUndo() {
  return stack.pop()
}

export function undoState() {
  const last = stack.length > 0 ? stack[stack.length - 1] : undefined
  return {
    available: stack.length > 0,
    depth: stack.length,
    last: last === undefined ? null : last.label,
    lastAt: last === undefined ? null : last.at,
  }
}

export function clearUndo() {
  stack.length = 0
}
