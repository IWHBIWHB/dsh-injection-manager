// Plugin settings: normalisation, defaults and the volatile shape.
//
// Presentation only — decisions live in policy.json. The host declares these
// fields volatile so a toggle applies without a restart, which means a value can
// arrive either as a plain boolean (a default, or an older host) or as a stable
// reference read with `.get()`. Both shapes must resolve to the same setting.
import test from 'node:test'
import assert from 'node:assert/strict'

import { getSettings, normalizeSettings, readField, setSettings } from '../lib/settings.js'

const defaults = { dock: true, refreshOnFocus: true, showRawNames: true, ledger: true }
const volatile = (value) => ({ get: () => value })

test('missing or malformed config keeps the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), defaults)
  assert.deepEqual(normalizeSettings(null), defaults)
  assert.deepEqual(normalizeSettings('nope'), defaults)
  assert.deepEqual(normalizeSettings({ dock: 'no' }), defaults)
})

test('booleans are honoured and unknown keys are dropped', () => {
  const next = normalizeSettings({ dock: false, refreshOnFocus: false, showRawNames: false, budgetTokens: 24000 })
  assert.deepEqual(next, { dock: false, refreshOnFocus: false, showRawNames: false, ledger: true })
})

test('volatile references are unwrapped so a card toggle is live', () => {
  const next = normalizeSettings({ dock: volatile(false), refreshOnFocus: volatile(true), showRawNames: volatile(false) })
  assert.deepEqual(next, { dock: false, refreshOnFocus: true, showRawNames: false, ledger: true })
})

test('readField accepts plain values, volatile references and junk', () => {
  assert.equal(readField(true, false), true)
  assert.equal(readField(volatile(false), true), false)
  assert.equal(readField(undefined, true), true)
  assert.equal(readField({}, true), true)
  assert.equal(readField({ get: () => { throw new Error('gone') } }, true), true)
})

test('settings are readable through the module singleton', () => {
  setSettings({ dock: false })
  assert.equal(getSettings().dock, false)
  assert.equal(getSettings().refreshOnFocus, true)
  setSettings(defaults)
  assert.equal(getSettings().dock, true)
})

test('getSettings re-reads a volatile reference instead of a cached copy', () => {
  let live = true
  setSettings({ dock: { get: () => live }, refreshOnFocus: defaults.refreshOnFocus, showRawNames: defaults.showRawNames })
  assert.equal(getSettings().dock, true)
  live = false
  assert.equal(getSettings().dock, false, 'the value must be read live, not cached at setSettings time')
  setSettings(defaults)
})
