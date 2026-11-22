// Host/Origin trust fence: every HTTP route asks the host's connection service
// for a rejection before its own logic runs.
//
// Two layers are covered: the helpers in lib/routes.js, and the real
// registration path in index.js (apply() with a fake webServer), so a future
// refactor cannot silently drop the fence from a route.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ROUTES,
  connectionOf,
  fenceRequest,
  makeFencedHandler,
} from '../lib/routes.js'
import { apply } from '../index.js'

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    ended: false,
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body) {
      this.ended = true
      this.body = body
    },
  }
}

const req = () => ({ url: '/plugins/dsh-injection-manager/ping', method: 'GET', headers: { host: '127.0.0.1:49801' } })

test('connectionOf reads ctx.get first and falls back to the property', () => {
  const service = { requestRejection: () => undefined }
  assert.equal(connectionOf({ get: (name) => (name === 'connection' ? service : undefined) }), service)
  assert.equal(connectionOf({ get: () => undefined, connection: service }), service)
  assert.equal(connectionOf({ get: () => { throw new Error('not ready') }, connection: service }), service)
  assert.equal(connectionOf({ get: () => undefined }), undefined)
  assert.equal(connectionOf({}), undefined)
})

test('without the service the fence lets the request through', () => {
  const res = makeRes()
  assert.equal(fenceRequest({ get: () => undefined }, req(), res), false)
  assert.equal(res.ended, false)
  assert.equal(res.statusCode, 200)
})

test('a service without requestRejection also lets the request through', () => {
  const res = makeRes()
  assert.equal(fenceRequest({ get: () => ({}) }, req(), res), false)
  assert.equal(res.ended, false)
})

test('an undefined rejection means the request may proceed', () => {
  const res = makeRes()
  const ctx = { get: () => ({ requestRejection: () => undefined }) }
  assert.equal(fenceRequest(ctx, req(), res), false)
  assert.equal(res.ended, false)
})

for (const status of [401, 403]) {
  test(`a ${status} rejection answers before any route logic runs`, () => {
    const res = makeRes()
    let calls = 0
    const ctx = { get: () => ({ requestRejection: () => { calls += 1; return status } }) }
    assert.equal(fenceRequest(ctx, req(), res), true)
    assert.equal(calls, 1)
    assert.equal(res.statusCode, status)
    assert.equal(res.ended, true)
    assert.equal(res.body, undefined, 'a rejection carries no data')
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['x-frame-options'], 'DENY')
    assert.equal(res.headers['referrer-policy'], 'no-referrer')
  })
}

test('a throwing requestRejection is swallowed and the request proceeds', () => {
  const res = makeRes()
  const ctx = { get: () => ({ requestRejection: () => { throw new Error('connection not ready') } }) }
  assert.equal(fenceRequest(ctx, req(), res), false, 'the fence must never break the panel')
  assert.equal(res.ended, false)
  assert.equal(res.statusCode, 200)
})

test('unexpected rejection values are ignored (only 401/403 reject)', () => {
  const res = makeRes()
  const ctx = { get: () => ({ requestRejection: () => 500 }) }
  assert.equal(fenceRequest(ctx, req(), res), false)
  assert.equal(res.ended, false)
})

test('makeFencedHandler skips the handler on rejection and passes through otherwise', async () => {
  let runs = 0
  const handler = async () => {
    runs += 1
    return 'handled'
  }

  const rejectCtx = { get: () => ({ requestRejection: () => 403 }) }
  const rejectedRes = makeRes()
  assert.equal(await makeFencedHandler(rejectCtx, handler)(req(), rejectedRes), undefined)
  assert.equal(runs, 0)
  assert.equal(rejectedRes.statusCode, 403)

  const allowCtx = { get: () => ({ requestRejection: () => undefined }) }
  const allowedRes = makeRes()
  assert.equal(await makeFencedHandler(allowCtx, handler)(req(), allowedRes), 'handled')
  assert.equal(runs, 1)

  const legacyCtx = { get: () => undefined }
  assert.equal(await makeFencedHandler(legacyCtx, handler)(req(), makeRes()), 'handled')
  assert.equal(runs, 2)
})

test('apply() registers exactly the documented routes and every one is fenced', async () => {
  const registered = []
  let rejections = 0
  const connection = {
    requestRejection() {
      rejections += 1
      return 403
    },
  }
  const ctx = {
    tools: { register() {} },
    commands: { register() {} },
    webServer: {
      register(route) {
        registered.push(route)
        return () => {}
      },
    },
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on() {
      return () => {}
    },
    get: (name) => (name === 'connection' ? connection : undefined),
  }
  apply(ctx, {})

  assert.equal(registered.length, Object.keys(ROUTES).length)
  assert.equal(registered.length, 18, 'all routes, including the legacy ones, go through the fence')
  for (const route of registered) {
    assert.equal(route.kind, 'exact')
    const res = makeRes()
    await route.handler(req(), res)
    assert.equal(res.statusCode, 403)
    assert.equal(res.ended, true)
    assert.equal(res.body, undefined)
  }
  assert.equal(rejections, registered.length)
})

test('apply() with a permissive host still serves routes (no service / undefined rejection)', async () => {
  for (const ctxGet of [() => undefined, () => ({ requestRejection: () => undefined })]) {
    const registered = []
    const ctx = {
      tools: { register() {} },
      commands: { register() {} },
      webServer: {
        register(route) {
          registered.push(route)
          return () => {}
        },
      },
      effect(fn) {
        const disposer = fn()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      on() {
        return () => {}
      },
      get: ctxGet,
    }
    apply(ctx, {})
    const ping = registered.find((route) => route.path === ROUTES.ping)
    assert.ok(ping, 'ping route registered')
    const res = makeRes()
    await ping.handler(req(), res)
    assert.equal(res.ended, true)
    assert.notEqual(res.statusCode, 401)
    assert.notEqual(res.statusCode, 403)
  }
})
