// The batch `names` action used to keep mode `all` while listing excluded names,
// so normalization dropped them and the switch silently did nothing. These tests
// pin the transition rules: off from `all` becomes `except`, on from `except`
// goes back to `all`, and the snapshot reflects the stored policy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-action-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const { createRoutes } = await import('../lib/routes.js')

const agent = { id: 'session-action', session: {} }
const ctx = {
  workingDirectory: { ensure: async () => home, defaultDirectory: home },
  systemPrompt: {
    assemble: async () => ({
      sections: [
        { name: 'harness:identity', order: -1000, text: 'You are an agent.' },
        { name: 'tool:jobs', order: 1600, text: 'jobs guidance' },
        { name: 'tool:read', order: 1100, text: 'read guidance' },
      ],
      contexts: [{ name: 'working-directory:current', order: 100, text: home, required: true }],
      variables: {},
    }),
  },
  skills: { snapshot: async () => ({ complete: true, skills: [] }) },
  tools: { schemas: () => [{ name: 'job_list', description: 'list jobs', parameters: { type: 'object' } }, { name: 'read', description: 'read', parameters: { type: 'object' } }] },
  agents: { get: () => agent, currentInitiator: () => agent, list: () => [agent] },
  get: () => undefined,
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

const writeHeaders = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
const post = (routes, payload) => invoke(routes.action, { method: 'POST', url: '/action', headers: writeHeaders, body: JSON.stringify(payload) })

test('switching names off from the default all mode becomes an exclusion', async () => {
  const routes = createRoutes(ctx)
  const off = await post(routes, { kind: 'names', channel: 'sections', names: ['tool:jobs'], enabled: false })
  assert.equal(off.status, 200)
  assert.equal(off.json.ok, true)
  assert.equal(off.json.changed, true)
  assert.equal(off.json.policy.sections.mode, 'except')
  assert.deepEqual(off.json.policy.sections.names, ['tool:jobs'])

  const summary = await invoke(routes.summary, { url: '/summary?session=session-action' })
  assert.equal(summary.status, 200)
  const jobs = summary.json.items.find((item) => item.name === 'tool:jobs')
  assert.equal(jobs.on, false)
  assert.ok(summary.json.policy.preview.excluded.sections.includes('tool:jobs'))

  const on = await post(routes, { kind: 'names', channel: 'sections', names: ['tool:jobs'], enabled: true })
  assert.equal(on.status, 200)
  assert.equal(on.json.policy.sections.mode, 'all')
  assert.deepEqual(on.json.policy.sections.names, [])
})

test('a tool name batch off also records a real restriction', async () => {
  const routes = createRoutes(ctx)
  const off = await post(routes, { kind: 'names', channel: 'tools', names: ['job_list'], enabled: false })
  assert.equal(off.status, 200)
  assert.equal(off.json.changed, true)
  assert.equal(off.json.policy.tools.mode, 'except')
  assert.deepEqual(off.json.policy.tools.names, ['job_list'])
  const on = await post(routes, { kind: 'names', channel: 'tools', names: ['job_list'], enabled: true })
  assert.equal(on.json.policy.tools.mode, 'all')
})

test('cleanup', async () => {
  // Windows can still hold the temp policy file for a few ms after the last
  // write; retry instead of failing the suite on a timing flake.
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 })
})
