// The policy file is the only durable state this plugin owns, so two properties
// matter more than any feature: a concurrent write must not corrupt it, and a
// corrupt file must not silently become "everything on".
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-policy-write-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')
await mkdir(join(home, 'injection-manager'), { recursive: true })

const { defaultPolicy, normalizePolicy, policyFilePath, readPolicy, writePolicy } = await import('../lib/policy.js')
const { withPolicyLock } = await import('../lib/lock.js')

const path = policyFilePath()

test('twenty overlapping saves leave one valid file, not a truncated one', async () => {
  const saves = Array.from({ length: 20 }, (_, index) =>
    writePolicy({
      ...defaultPolicy(),
      preset: 'custom',
      tools: { mode: 'except', names: [`tool-${index}`] },
    }),
  )
  await Promise.all(saves)
  const text = await readFile(path, 'utf8')
  const parsed = JSON.parse(text)
  assert.equal(parsed.version, 2)
  assert.equal(parsed.tools.mode, 'except')
  assert.equal(parsed.tools.names.length, 1)
  // The previous good copy exists and is parseable too.
  const backup = JSON.parse(await readFile(`${path}.bak`, 'utf8'))
  assert.equal(backup.version, 2)
})

test('a corrupt policy file recovers the saved switches from the backup', async () => {
  await writePolicy({ ...defaultPolicy(), preset: 'custom', tools: { mode: 'except', names: ['mcp__rea__alpha'] } })
  // Second save moves the first good file into .bak.
  await writePolicy({ ...defaultPolicy(), preset: 'custom', tools: { mode: 'except', names: ['mcp__rea__alpha', 'mcp__rea__beta'] } })
  await writeFile(path, '{"version":2,"tools":{"mode":"except","names":["mcp__rea__', 'utf8')
  const state = await readPolicy()
  assert.equal(state.exists, true)
  assert.equal(state.recovered, true, 'the read reports that it used the backup')
  assert.match(state.error, /recovered from \.bak/)
  assert.equal(state.policy.tools.mode, 'except')
  assert.ok(state.policy.tools.names.includes('mcp__rea__alpha'), 'the backup keeps the earlier switch')
})

test('the queue keeps two read-modify-write switches from dropping one', async () => {
  await writePolicy(defaultPolicy())
  const flip = (name) =>
    withPolicyLock(async () => {
      const state = await readPolicy()
      const next = normalizePolicy(state.policy)
      next.preset = 'custom'
      next.tools = { mode: 'except', names: [...new Set(next.tools.names.concat(name))] }
      await writePolicy(next)
    })
  // Without the queue both reads see the same empty list and the second write
  // wins with one name — the exact "I closed two suites, only one stayed closed".
  await Promise.all([flip('alpha'), flip('beta'), flip('gamma')])
  const final = await readPolicy()
  assert.deepEqual(final.policy.tools.names.slice().sort(), ['alpha', 'beta', 'gamma'])
})

test('cleanup', async () => {
  await rm(home, { recursive: true, force: true })
})
