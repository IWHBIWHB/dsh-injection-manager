// Plugin settings: normalisation and defaults. These values come from the
// plugin row config (Plugins → Configuration) and only ever affect
// presentation plus the first-run budget seed.
import test from 'node:test'
import assert from 'node:assert/strict'

import { getSettings, normalizeSettings, setSettings } from '../lib/settings.js'

const defaults = { dock: true, refreshOnFocus: true, showRawNames: true, budgetTokens: 0 }

test('missing or malformed config keeps the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), defaults)
  assert.deepEqual(normalizeSettings(null), defaults)
  assert.deepEqual(normalizeSettings('nope'), defaults)
  assert.deepEqual(normalizeSettings({ dock: 'no', budgetTokens: -5 }), defaults)
})

test('booleans and a positive budget are honoured', () => {
  const next = normalizeSettings({ dock: false, refreshOnFocus: false, showRawNames: false, budgetTokens: 24000 })
  assert.deepEqual(next, { dock: false, refreshOnFocus: false, showRawNames: false, budgetTokens: 24000 })
  assert.equal(normalizeSettings({ budgetTokens: 12.7 }).budgetTokens, 13)
})

test('settings are readable through the module singleton', () => {
  setSettings({ dock: false })
  assert.equal(getSettings().dock, false)
  setSettings(defaults)
  assert.equal(getSettings().dock, true)
})
