// The public diagnostic report must keep compatibility facts and drop paths,
// session ids and module URLs: it is designed to be pasted into a public issue.
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDiagnosticsReport } from '../lib/diagnostics.js'

const payload = {
  id: 'dsh-injection-manager',
  at: 1795000000000,
  apiVersion: 2,
  packageDir: 'C:\\Users\\someone\\.dsh\\profiles\\desktop\\node_modules\\dsh-injection-manager',
  policyPath: 'C:\\Users\\someone\\.dsh\\injection-manager\\policy.json',
  appliedAgents: 1,
  host: { version: '0.2.2-rc.5', source: 'D:\\DSH', tested: '0.2.2', supported: true },
  lastApplication: {
    at: 1794999999999,
    report: {
      source: 'startup',
      counts: {
        sections: { on: 24, total: 24 },
        contexts: { on: 8, total: 6 },
        skills: { on: 30, total: 38 },
        tools: { on: 41, total: 41 },
        instructions: { on: 1, total: 1 },
      },
      projectedTokens: 16222,
      savedTokens: 0,
    },
  },
  rewrite: { count: 317, last: null },
  clientBoot: { at: 1795000000000, stage: 'slots-registered', error: null },
  clientRegistrations: {
    at: 1795000000000,
    slots: [
      { key: 'sidebar', ok: true },
      { key: 'main', ok: true },
      { key: 'sidebar-tab', ok: false },
    ],
    errors: [],
  },
  clientModule: null,
}

test('the report keeps version, host and registration facts', () => {
  const report = buildDiagnosticsReport(payload)
  assert.match(report, /pluginVersion: \d+\.\d+\.\d+/)
  assert.match(report, /hostVersion: 0\.2\.2-rc\.5/)
  assert.match(report, /hostSupported: true/)
  assert.match(report, /clientBootStage: slots-registered/)
  assert.match(report, /3 slots, 1 failed \(sidebar-tab\)/)
  assert.match(report, /rewriteCount: 317/)
  assert.match(report, /policyChannels: sections 24\/24, contexts 8\/6, skills 30\/38, tools 41\/41, instructions 1\/1/)
})

test('the report never carries machine paths or module URLs', () => {
  const report = buildDiagnosticsReport(payload)
  assert.equal(report.includes('Users'), false)
  assert.equal(report.includes('D:\\\\DSH'), false)
  assert.equal(report.includes('profiles'), false)
  assert.equal(report.includes('policy.json'), false)
})

test('a malformed payload still yields a usable report', () => {
  const report = buildDiagnosticsReport(null)
  assert.match(report, /dsh-injection-manager diagnostics/)
  assert.match(report, /hostVersion: \(unknown\)|hostVersion: unknown/)
  assert.match(report, /clientBootStage: unknown/)
})
