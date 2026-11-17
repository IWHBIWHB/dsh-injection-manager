// Plugin settings: normalisation and defaults. These values come from the
// plugin row config (Plugins → Configuration) and only ever affect
// presentation only — decisions live in policy.json.
import test from 'node:test'
import assert from 'node:assert/strict'

import { getSettings, normalizeSettings, setSettings } from '../lib/settings.js'

const defaults = { dock: true, refreshOnFocus: true, showRawNames: true }

test('missing or malformed config keeps the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), defaults)
  assert.deepEqual(normalizeSettings(null), defaults)
  assert.deepEqual(normalizeSettings('nope'), defaults)
  assert.deepEqual(normalizeSettings({ dock: 'no' }), defaults)
})

test('booleans are honoured and unknown keys are dropped', () => {
  const next = normalizeSettings({ dock: false, refreshOnFocus: false, showRawNames: false, budgetTokens: 24000 })
  assert.deepEqual(next, { dock: false, refreshOnFocus: false, showRawNames: false })
})

test('settings are readable through the module singleton', () => {
  setSettings({ dock: false })
  assert.equal(getSettings().dock, false)
  setSettings(defaults)
  assert.equal(getSettings().dock, true)
})
