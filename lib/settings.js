// Presentation settings from the plugin row's `config` (Plugins → Configuration).
//
// The three fields are declared `.volatile()` on the host: flipping a switch in
// the settings card updates the live value without restarting the plugin. A
// volatile field arrives as a stable reference read with `.get()`; defaults stay
// plain data. Every read therefore goes through `readField`, and `getSettings()`
// re-reads the reference — the composer chip must react to the card immediately,
// not after the next page load.
let current = {
  dock: true,
  refreshOnFocus: true,
  showRawNames: true,
}

const DEFAULTS = { ...current }
let configRef = null

/** One field, either a plain value or a volatile reference. */
export function readField(field, fallback) {
  if (field === undefined || field === null) return fallback
  try {
    const value = typeof field.get === 'function' ? field.get() : field
    return typeof value === typeof fallback ? value : fallback
  } catch {
    return fallback
  }
}

export function normalizeSettings(raw) {
  const next = { ...DEFAULTS }
  if (raw === null || typeof raw !== 'object') return next
  next.dock = readField(raw.dock, DEFAULTS.dock)
  next.refreshOnFocus = readField(raw.refreshOnFocus, DEFAULTS.refreshOnFocus)
  next.showRawNames = readField(raw.showRawNames, DEFAULTS.showRawNames)
  return next
}

export function setSettings(raw) {
  configRef = raw
  current = normalizeSettings(raw)
  return current
}

export function getSettings() {
  // Re-read on every access so volatile fields are live; without a stored
  // reference (unit tests, a host that passed nothing) fall back to the copy.
  return configRef === null ? { ...current } : normalizeSettings(configRef)
}
