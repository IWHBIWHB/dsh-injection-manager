// Plugin-wide settings from the plugin row's `config` (Plugins → Configuration).
//
// They are deliberately small: anything that belongs to a *decision* lives in
// policy.json with the rest of the switches; only presentation and one seeding
// default live here, because those are per-installation taste.
let current = {
  dock: true,
  refreshOnFocus: true,
  showRawNames: true,
  budgetTokens: 0,
}

export function normalizeSettings(raw) {
  const next = { ...current }
  if (raw === null || typeof raw !== 'object') return next
  if (typeof raw.dock === 'boolean') next.dock = raw.dock
  if (typeof raw.refreshOnFocus === 'boolean') next.refreshOnFocus = raw.refreshOnFocus
  if (typeof raw.showRawNames === 'boolean') next.showRawNames = raw.showRawNames
  const budget = Number(raw.budgetTokens)
  if (Number.isFinite(budget) && budget > 0) next.budgetTokens = Math.round(budget)
  else next.budgetTokens = 0
  return next
}

export function setSettings(raw) {
  current = normalizeSettings(raw)
  return current
}

export function getSettings() {
  return current
}
