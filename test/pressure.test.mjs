// Context-window occupancy: the denominator this plugin used to lack.
//
// The host owns the measurement, so these tests fake the two services it reads
// (tokenMeter pressure, sessionProjections breakdown) and assert the one place
// this plugin divides by the window. No token is estimated here.
import test from 'node:test'
import assert from 'node:assert/strict'

import { EMPTY_CONTEXT, occupancyTone, readContext, resetWindowCache } from '../lib/pressure.js'

const session = {
  id: 's1',
  requestHeader: () => ({ config: { provider: 'deepseek', model: 'deepseek-chat' } }),
}
const agent = { id: 'a1', session }

function fakeCtx({ pressure, breakdown, capacity, throws } = {}) {
  const calls = { resolveModelInfo: 0, snapshot: 0, pressure: 0 }
  return {
    calls,
    get(name) {
      if (name === 'tokenMeter') {
        if (throws === 'meter') throw new Error('no meter')
        return {
          contextPressure() {
            calls.pressure += 1
            if (throws === 'pressure') throw new Error('no projection')
            return pressure
          },
        }
      }
      if (name === 'sessionProjections') {
        return {
          snapshot() {
            calls.snapshot += 1
            return { asOfSeq: 12, values: breakdown === undefined ? {} : { contextBreakdown: breakdown } }
          },
        }
      }
      if (name === 'llm') {
        return {
          async resolveModelInfo() {
            calls.resolveModelInfo += 1
            return { context: capacity === undefined ? undefined : { contextWindow: capacity } }
          },
        }
      }
      return undefined
    },
  }
}

test('occupancy divides the next projected prompt by the reported window', async () => {
  const ctx = fakeCtx({
    pressure: { pressureTokens: 100000, projectedTokens: 120000, contextWindow: 200000 },
    breakdown: { systemTokens: 10000, toolsTokens: 80000, messageTokens: 30000 },
  })
  const context = await readContext(ctx, agent)
  assert.equal(context.window, 200000)
  assert.equal(context.pressure, 100000)
  assert.equal(context.projected, 120000)
  assert.equal(context.used, 120000, 'the next request matters, not the last one')
  assert.equal(context.occupancy, 60)
  assert.equal(context.remaining, 80000)
  assert.equal(context.source, 'tokenMeter')
  assert.deepEqual(context.breakdown, { system: 10000, tools: 80000, messages: 30000, total: 120000 })
  assert.equal(occupancyTone(context), 'ok')
})

test('a session without provider usage keeps the nulls instead of guessing', async () => {
  const ctx = fakeCtx({ pressure: { contextWindow: 128000 } })
  const context = await readContext(ctx, agent)
  assert.equal(context.window, 128000)
  assert.equal(context.pressure, null)
  assert.equal(context.used, null)
  assert.equal(context.occupancy, null)
  assert.equal(context.remaining, null)
  assert.equal(occupancyTone(context), 'unknown')
})

test('the adapter capacity is the fallback denominator and is cached per route', async () => {
  resetWindowCache()
  const ctx = fakeCtx({ pressure: { pressureTokens: 50000 }, capacity: 256000 })
  const first = await readContext(ctx, agent)
  const second = await readContext(ctx, agent)
  assert.equal(first.window, 256000)
  assert.equal(first.windowSource, 'llm')
  assert.equal(first.occupancy, 19.5)
  assert.equal(first.source, 'tokenMeter', 'the numerator still came from the meter')
  assert.equal(second.window, 256000)
  assert.equal(ctx.calls.resolveModelInfo, 1, 'capacity for one route is stable')
})

test('a slow or missing adapter leaves the window unknown rather than infinite', async () => {
  resetWindowCache()
  const ctx = {
    get: (name) => (name === 'llm' ? { resolveModelInfo: async () => { throw new Error('adapter offline') } } : undefined),
  }
  const context = await readContext(ctx, agent)
  assert.equal(context.window, null)
  assert.equal(context.occupancy, null)
})

test('no agent, a throwing meter, or no services all degrade to empty', async () => {
  resetWindowCache()
  assert.deepEqual(await readContext(fakeCtx(), undefined), { ...EMPTY_CONTEXT })
  const broken = fakeCtx({ throws: 'pressure' })
  const empty = await readContext(broken, agent)
  assert.equal(empty.window, null)
  assert.equal(empty.used, null)
  assert.equal(empty.source, 'none')
  const nothing = await readContext({ get: () => undefined }, agent)
  assert.equal(nothing.breakdown, null)
  assert.equal(nothing.occupancy, null)
})

test('tone warns before compaction territory', () => {
  assert.equal(occupancyTone({ occupancy: 12 }), 'ok')
  assert.equal(occupancyTone({ occupancy: 70 }), 'warn')
  assert.equal(occupancyTone({ occupancy: 89.9 }), 'warn')
  assert.equal(occupancyTone({ occupancy: 90 }), 'danger')
  assert.equal(occupancyTone(null), 'unknown')
})
