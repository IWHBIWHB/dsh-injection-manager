// Model-facing surface: the `context_injection` tool grows an optional
// {channel,name} mode that returns one item's text, capped at 32KB.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-tool-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const { createTool } = await import('../index.js')
const { TOOL_CONTENT_LIMIT } = await import('../lib/content.js')
const { flushStats } = await import('../lib/stats.js')
const { createRoutes } = await import('../lib/routes.js')

const ctx = {
  workingDirectory: { ensure: async () => home, defaultDirectory: home },
  systemPrompt: {
    assemble: async () => ({
      sections: [{ name: 'harness:identity', order: -1000, text: 'You are an agent.' }],
      contexts: [{ name: 'working-directory:current', order: 100, text: 'cwd', required: true }],
    }),
  },
  skills: {
    snapshot: async () => ({
      complete: true,
      skills: [
        { name: 'alpha', description: 'first skill', invocation: { modelInvocable: true, userInvocable: true }, provider: 'p', source: 'user' },
      ],
    }),
  },
  tools: {
    schemas: () => [
      { name: 'mcp__demo__one', description: 'one', parameters: { type: 'object' } },
      { name: 'mcp__demo__two', description: 'two', parameters: { type: 'object' } },
      { name: 'read', description: 'read', parameters: { type: 'object' } },
      { name: 'mcp__huge__tool', description: 'y'.repeat(40000), parameters: { type: 'object' } },
    ],
  },
  agents: { get: () => undefined, currentInitiator: () => undefined, list: () => [] },
  get: () => undefined,
}
const agent = { id: 'session-tool', session: {} }
const tool = createTool(ctx)
const run = (args) => tool.execute(args, { agent })

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

test('without arguments the tool still returns the whole snapshot', async () => {
  const result = await run({})
  assert.equal(result.ok, true)
  assert.equal(result.apiVersion, 3)
  assert.ok(Array.isArray(result.items) && result.items.length > 0)
  for (const item of result.items) assert.equal(typeof item.on, 'boolean', `${item.id} carries the policy on-flag`)
  assert.equal(typeof result.text, 'string')
  assert.match(result.text, /上下文注入管理/)
  assert.equal(result.limit, undefined)
})

test('{channel,name} returns one tool as formatted JSON with metadata', async () => {
  const result = await run({ channel: 'tools', name: 'mcp__demo__one' })
  assert.equal(result.ok, true)
  assert.equal(result.item.id, 'tool:mcp__demo__one')
  assert.equal(result.item.channel, 'tools')
  assert.equal(result.contentType, 'json')
  assert.equal(result.limit, TOOL_CONTENT_LIMIT)
  assert.equal(result.truncated, false)
  assert.equal(JSON.parse(result.content).name, 'mcp__demo__one')
  // The card renderer reads `content` directly, so the payload carries one copy.
  const rendered = tool.output.render({}, result)
  assert.equal(rendered[0].text, result.content)
})

test('{channel,name} also returns section text', async () => {
  const result = await run({ channel: 'sections', name: 'harness:identity' })
  assert.equal(result.ok, true)
  assert.equal(result.contentType, 'text')
  assert.equal(result.content, 'You are an agent.')
  assert.equal(result.note, 'assemble')
})

test('a 40k description is cut to the 32KB model budget, not dumped', async () => {
  const result = await run({ channel: 'tools', name: 'mcp__huge__tool' })
  assert.equal(result.ok, true)
  assert.equal(result.truncated, true)
  assert.ok(result.bytes <= TOOL_CONTENT_LIMIT)
  assert.ok(result.content.length < 40000 * 2)
  assert.doesNotMatch(result.content, /\uFFFD/)
})

test('bad single-item arguments fail without dumping the snapshot', async () => {
  const half = await run({ channel: 'tools' })
  assert.equal(half.ok, false)
  assert.equal(half.error, 'invalid-arguments')
  assert.match(half.message, /同时/)
  assert.equal(half.items, undefined)

  const empty = await run({ name: 'read' })
  assert.equal(empty.ok, false)

  const badChannel = await run({ channel: 'nope', name: 'read' })
  assert.equal(badChannel.ok, false)
  assert.equal(badChannel.error, 'invalid-channel')

  const missing = await run({ channel: 'tools', name: 'not_a_tool' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'not_found')
})

test('a /health action payload is directly executable by POST /action', async () => {
  const routes = createRoutes(ctx)
  const health = await invoke(routes.health, { url: '/health?session=session-tool' })
  assert.equal(health.status, 200)
  assert.equal(health.json.ok, true)
  const heavy = health.json.checks.find((check) => check.code === 'heavy-suite')
  assert.ok(heavy, 'the huge MCP suite is heavy enough to be flagged')
  assert.equal(heavy.action.kind, 'switch-group')
  const payload = heavy.action.payload
  const apply = await invoke(routes.action, {
    method: 'POST',
    url: '/action',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ kind: 'group', channel: payload.channel, group: payload.group, enabled: payload.enabled === true }),
  })
  assert.equal(apply.status, 200)
  assert.equal(apply.json.ok, true)
  assert.equal(apply.json.policy.tools.mode, 'except')
  assert.ok(apply.json.policy.tools.names.includes('mcp__huge__tool'))
})

test('/content maps success and failures to HTTP statuses', async () => {
  const routes = createRoutes(ctx)
  const ok = await invoke(routes.content, { url: '/content?channel=tools&id=tool%3Amcp__demo__one' })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.ok, true)
  assert.equal(ok.json.item.name, 'mcp__demo__one')
  assert.equal(ok.headers['x-content-type-options'], 'nosniff')
  const missing = await invoke(routes.content, { url: '/content?channel=tools&id=tool%3Anope' })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error, 'not_found')
  const bad = await invoke(routes.content, { url: '/content?channel=bogus&id=x' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error, 'invalid-channel')
})

test('cleanup', async () => {
  // Snapshot reads record stats with a fire-and-forget atomic write; wait for
  // it before removing the temp home.
  await flushStats()
  await rm(home, { recursive: true, force: true })
})
