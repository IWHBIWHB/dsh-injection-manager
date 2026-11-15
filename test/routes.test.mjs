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

test('cleanup', async () => {
  await rm(home, { recursive: true, force: true })
})
