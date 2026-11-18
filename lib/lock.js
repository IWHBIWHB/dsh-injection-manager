// One policy file, one writer at a time.
//
// Every mutation is a read-modify-write of `policy.json` (read the current rule,
// flip one name, save). Two requests that overlap would each read the same
// "before" and the second write would silently drop the first switch — observed
// as "I closed two suites and only one stayed closed", and, when two writes
// landed in the same millisecond, as a truncated policy file that reads back as
// "everything on" (which re-enables the suites the user just closed).
//
// The queue is per process, which is the granularity this plugin can control: a
// second DSH process sharing the same DSH_HOME is out of scope, and the atomic
// rename still means that case loses a whole write instead of corrupting a file.
let chain = Promise.resolve()

/**
 * Run `task` after every previously queued task has settled. Rejections do not
 * stall the queue, and each caller still gets its own result or error.
 */
export function withPolicyLock(task) {
  const run = chain.then(task, task)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Test hook: the current queue tail, so a test can wait for a quiet point. */
export function policyLockIdle() {
  return chain
}
