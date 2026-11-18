// Route-level tests: actions, undo, export and the same-origin guard, driven
// through the real handlers with fake request/response objects.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-routes-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const { createRoutes } = await import('../lib/routes.js')
const { flushStats } = await import('../lib/stats.js')

function makeCtx() {
  return {
    workingDirectory: { ensure: async () => home, defaultDirectory: home },
    systemPrompt: {
      assemble: async () => ({
        sections: [
          { name: 'harness:identity', order: -1000, text: 'You are an agent.' },
          { name: 'tools:sdk', order: 5000, text: 'x'.repeat(2000) },
        ],
        contexts: [{ name: 'working-directory:current', order: 100, text: 'cwd', required: true }],
      }),
    },
    skills: {
      snapshot: async () => ({
        complete: true,
        skills: [
          { name: 'alpha', description: 'first', invocation: { modelInvocable: true, userInvocable: true }, provider: 'p', source: 'user' },
        ],
      }),
    },
    tools: {
      schemas: () => [
        { name: 'mcp__demo__one', description: 'one', parameters: { type: 'object' } },
        { name: 'mcp__demo__two', description: 'two', parameters: { type: 'object' } },
        { name: 'read', description: 'read', parameters: { type: 'object' } },
      ],
    },
    agents: { get: () => undefined, currentInitiator: () => undefined, list: () => [] },
    get: () => undefined,
  }
}

function invoke(handler, { method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === '' ? [] : [Buffer.from(body, 'utf8')])
    req.method = method
    req.url = url
    req.headers = headers
    req.destroy = () => {}
    const chunks = []
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
      end(chunk) {
        if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = JSON.parse(text)
        } catch {
          json = undefined
        }
        resolve({ status: this.statusCode, headers: this.headers, text, json })
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

const sameOrigin = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

test('a suite toggle writes 2 names and undo restores the previous policy', async () => {
  const routes = createRoutes(makeCtx())

  const before = await invoke(routes.summary, { url: '/summary' })
  assert.equal(before.status, 200)
  assert.equal(before.json.undo.available, false)
  assert.equal(before.json.groups.find((group) => group.label === 'DEMO').count, 2)

  const act = await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'group', channel: 'tools', group: 'tools:mcp:demo', enabled: false }),
  })
  assert.equal(act.status, 200)
  assert.equal(act.json.policy.tools.mode, 'except')
  assert.deepEqual(act.json.policy.tools.names.sort(), ['mcp__demo__one', 'mcp__demo__two'])
  assert.equal(act.json.undo.available, true)

  const after = await invoke(routes.summary, { url: '/summary' })
  assert.ok(after.json.policy.preview.savedTokens > 0)

  const undo = await invoke(routes.action, { method: 'POST', headers: sameOrigin, body: JSON.stringify({ kind: 'undo' }) })
  assert.equal(undo.status, 200)
  assert.equal(undo.json.policy.tools.mode, 'all')

  const restored = await invoke(routes.summary, { url: '/summary' })
  assert.equal(restored.json.undo.available, false)
})

test('cross-site and non-JSON writes are rejected before touching the policy', async () => {
  const routes = createRoutes(makeCtx())
  const crossSite = await invoke(routes.action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ kind: 'reset' }),
  })
  assert.equal(crossSite.status, 403)

  const formPost = await invoke(routes.action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'kind=reset',
  })
  assert.equal(formPost.status, 403)

  const foreignOrigin = await invoke(routes.action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:42438', origin: 'https://evil.example' },
    body: JSON.stringify({ kind: 'reset' }),
  })
  assert.equal(foreignOrigin.status, 403)
})

test('JSON responses carry hardening headers', async () => {
  const routes = createRoutes(makeCtx())
  const response = await invoke(routes.summary, { url: '/summary' })
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['x-frame-options'], 'DENY')
  assert.equal(response.headers['cache-control'], 'no-store')
})

test('a polled summary ships only the dictionary the panel asked for', async () => {
  const routes = createRoutes(makeCtx())
  const all = await invoke(routes.summary, { url: '/summary' })
  assert.equal(Object.keys(all.json.locale).length, 8, 'no language hint keeps the full set for /locale consumers')
  const zh = await invoke(routes.summary, { url: '/summary?lang=zh' })
  assert.deepEqual(Object.keys(zh.json.locale).sort(), ['en', 'zh'])
  assert.ok(zh.json.locale.zh.nextTurn.length > 0)
  const unknown = await invoke(routes.summary, { url: '/summary?lang=xx' })
  assert.equal(Object.keys(unknown.json.locale).length, 8, 'an unknown language is not a filter')
  // Same snapshot either way: the language only selects bytes.
  assert.equal(zh.json.totals.tokens, all.json.totals.tokens)
})

test('export serves a downloadable JSON manifest of the same snapshot', async () => {
  const routes = createRoutes(makeCtx())
  const response = await invoke(routes.export, { url: '/export?format=json' })
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /application\/json/)
  assert.match(response.headers['content-disposition'], /attachment; filename="injection-manifest-.*\.json"/)
  assert.equal(response.json.groups.length > 0, true)
  const counted = response.json.channels.reduce((sum, channel) => sum + channel.count, 0)
  assert.equal(response.json.items.length, counted)

  const markdown = await invoke(routes.export, { url: '/export?format=md' })
  assert.match(markdown.headers['content-type'], /text\/markdown/)
  assert.match(markdown.text, /上下文注入管理/)
})

test('an unknown action kind fails loudly instead of writing', async () => {
  const routes = createRoutes(makeCtx())
  const response = await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'nope' }),
  })
  assert.equal(response.status, 500)
  assert.match(response.json.message, /unknown action kind/)
})

test('import accepts a bare policy and an exported manifest, then undo reverts it', async () => {
  const routes = createRoutes(makeCtx())
  const bare = await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'import', policy: { tools: { mode: 'except', names: ['mcp__demo__one'] } } }),
  })
  assert.equal(bare.status, 200)
  assert.equal(bare.json.policy.tools.mode, 'except')
  assert.deepEqual(bare.json.policy.tools.names, ['mcp__demo__one'])

  const manifest = await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'import', policy: { policy: { tools: { mode: 'only', names: ['read'] } } } }),
  })
  assert.equal(manifest.status, 200)
  assert.equal(manifest.json.policy.tools.mode, 'only')

  const undo = await invoke(routes.action, { method: 'POST', headers: sameOrigin, body: JSON.stringify({ kind: 'undo' }) })
  assert.equal(undo.json.policy.tools.mode, 'except')

  const invalid = await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'import', policy: [] }),
  })
  assert.equal(invalid.status, 500)
  assert.match(invalid.json.message, /invalid-policy/)
})

test('a bulk suite action toggles several channel groups at once', async () => {
  const routes = createRoutes(makeCtx())
  await invoke(routes.action, { method: 'POST', headers: sameOrigin, body: JSON.stringify({ kind: 'reset' }) })
  await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'group', channel: 'tools', group: 'tools:mcp:demo', enabled: false }),
  })
  const off = await invoke(routes.summary, { url: '/summary' })
  assert.equal(off.json.policy.tools.mode, 'except')

  const on = await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({
      kind: 'groups',
      enabled: true,
      groups: [
        { channel: 'tools', group: 'tools:mcp:demo' },
        { channel: 'tools', group: 'tools:mcp:demo' },
      ],
    }),
  })
  assert.equal(on.status, 200)
  assert.equal(on.json.policy.tools.mode, 'all')
  assert.deepEqual(on.json.policy.tools.names, [])
})

test('restore jumps back to an earlier step and clears the rest of the history', async () => {
  const { clearUndo } = await import('../lib/history.js')
  const routes = createRoutes(makeCtx())
  await invoke(routes.action, { method: 'POST', headers: sameOrigin, body: JSON.stringify({ kind: 'reset' }) })
  clearUndo()
  await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'group', channel: 'tools', group: 'tools:mcp:demo', enabled: false, label: 'first' }),
  })
  await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'item', channel: 'tools', name: 'read', enabled: false, label: 'second' }),
  })
  const summary = await invoke(routes.summary, { url: '/summary' })
  assert.deepEqual(
    summary.json.undo.entries.map((entry) => entry.label),
    ['first', 'second'],
  )

  const restored = await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'restore', index: 0 }),
  })
  assert.equal(restored.status, 200)
  assert.equal(restored.json.policy.tools.mode, 'all')
  assert.deepEqual(restored.json.policy.tools.names, [])

  const after = await invoke(routes.summary, { url: '/summary' })
  assert.equal(after.json.undo.available, false)
})

test('cleanup', async () => {
  await flushStats()
  await rm(home, { recursive: true, force: true })
})

test('replaying a switch that changes nothing adds no undo step and no event', async () => {
  const routes = createRoutes(makeCtx())
  const { clearUndo } = await import('../lib/history.js')
  await invoke(routes.action, { method: 'POST', headers: sameOrigin, body: JSON.stringify({ kind: 'reset' }) })
  clearUndo()
  const body = JSON.stringify({ kind: 'groups', groups: [{ channel: 'tools', group: 'tools:mcp:demo' }], enabled: false })
  const first = await invoke(routes.action, { method: 'POST', headers: sameOrigin, body })
  assert.equal(first.status, 200)
  assert.equal(first.json.changed, true)
  assert.equal(first.json.undo.depth, 1)
  const eventsBefore = await invoke(routes.events, { url: '/events' })
  // The panel can replay the same click (double click, or a stale health row).
  // It must read as a no-op instead of stacking another "已关闭" undo entry.
  const second = await invoke(routes.action, { method: 'POST', headers: sameOrigin, body })
  assert.equal(second.status, 200)
  assert.equal(second.json.changed, false)
  assert.equal(second.json.undo.depth, 1, 'no duplicate undo step')
  const eventsAfter = await invoke(routes.events, { url: '/events' })
  assert.equal(eventsAfter.json.events.length, eventsBefore.json.events.length, 'no duplicate event row')
})

test('closing a suite removes its health warning even while the live prompt still has it', async () => {
  // The user's bug: the panel's counters went effective after a switch, but the
  // health strip kept reading the all-on snapshot and kept asking to close the
  // very suite that was already off. Reproduce the real shape here: the frozen
  // live assembly still contains the tools, the policy marks them off.
  const { buildSnapshot } = await import('../lib/routes.js')
  const { buildHealth } = await import('../lib/health.js')
  const big = makeCtx()
  big.tools.schemas = () => [
    { name: 'mcp__demo__one', description: 'x'.repeat(160000), parameters: { type: 'object' } },
    { name: 'mcp__demo__two', description: 'y'.repeat(160000), parameters: { type: 'object' } },
  ]
  const routes = createRoutes(makeCtx())
  await invoke(routes.action, { method: 'POST', headers: sameOrigin, body: JSON.stringify({ kind: 'reset' }) })

  const open = await buildSnapshot(big, undefined, 'test', undefined)
  const openHealth = buildHealth(open)
  const demoOpen = openHealth.checks.find((check) => check.code === 'heavy-suite' && check.params.label === 'DEMO')
  assert.ok(demoOpen, 'the all-on snapshot flags the DEMO suite')
  assert.equal(demoOpen.action.kind, 'switch-group')

  await invoke(routes.action, {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ kind: 'groups', groups: [{ channel: 'tools', group: 'tools:mcp:demo' }], enabled: false }),
  })
  const closed = await buildSnapshot(big, undefined, 'test', undefined)
  // The frozen live prompt still carries both tools; only the policy says off.
  const demoItems = closed.items.filter((item) => item.group === 'tools:mcp:demo')
  assert.equal(demoItems.length, 2)
  assert.ok(demoItems.every((item) => item.on === false))
  const demoGroup = closed.groups.find((group) => group.id === 'tools:mcp:demo')
  assert.equal(demoGroup.onTokens, 0)
  assert.equal(demoGroup.tokens > 0, true)
  const closedHealth = buildHealth(closed)
  assert.equal(
    closedHealth.checks.some((check) => check.code === 'heavy-suite' && check.params.label === 'DEMO'),
    false,
    'the closed suite no longer warns',
  )
})
