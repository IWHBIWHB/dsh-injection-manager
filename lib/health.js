// Health: deterministic, read-only findings over one snapshot.
//
// Pure on purpose. The panel, the `/health` route and `/inject health` must all
// derive the same checks from the same snapshot; anything that needs an extra
// disk read or a second assemble belongs in the snapshot, not here. The only
// clock value used is `snapshot.generatedAt`, so two calls on one snapshot are
// byte-identical.
//
// Two codes from the contract are deliberately never emitted:
//   - `duplicate-skill`: the skill registry resolves duplicate names to one
//     winner before `snapshot()` returns, so losing provider candidates are not
//     observable through the public API. Inventing them would be a lie.
//   - `tool-name-collision`: `ctx.tools.schemas()` returns the resolved tool
//     set; a duplicate name cannot reach it.
// The enum stays complete so a future host build with a visible catalog can add
// them without changing the UI contract.
import { percent } from './measure.js'

export const HEALTH_CODES = Object.freeze([
  'heavy-suite',
  'duplicate-skill',
  'tool-name-collision',
  'catalog-truncated',
  'locked-items',
  'unknown-window',
  'no-policy',
  'empty-catalog',
])

export const HEALTH_ACTION_KINDS = Object.freeze(['switch-group', 'open-content', 'open-tab'])

const SEVERITY_ORDER = { high: 0, warn: 1, info: 2 }
// A suite is worth flagging once it is a quarter of the first turn, or once it
// is large in absolute terms even in a big prompt.
const HEAVY_SHARE = 25
const HEAVY_TOKENS = 30000
const HEAVY_MAX_CHECKS = 3
// Locked items (instruction files, required contexts) only matter as a share;
// a handful of percent is normal and should not produce a permanent warning.
const LOCKED_SHARE = 10
const LOCKED_WARN_SHARE = 30

const num = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function suiteParts(items, label) {
  const wanted = String(label ?? '').toLowerCase()
  if (wanted.length === 0) return []
  const parts = []
  for (const item of items) {
    const itemLabel = String(item?.groupLabel ?? item?.group ?? '').toLowerCase()
    if (itemLabel !== wanted) continue
    const channel = String(item?.channel ?? '')
    const group = String(item?.group ?? '')
    if (group.length === 0) continue
    if (parts.some((part) => part.channel === channel && part.group === group)) continue
    parts.push({ channel, group })
  }
  return parts
}

function groupAction(group, items) {
  const channel = String(group?.channel ?? '')
  const groupId = String(group?.id ?? '')
  const key = groupId.startsWith(`${channel}:`) ? groupId.slice(channel.length + 1) : groupId
  // The payload is directly executable against POST /action. `parts` names every
  // channel the suite owns, so the panel's one click closes all of "REA" (its
  // MCP tools plus its prompt section) instead of only the first channel.
  const parts = suiteParts(items, group?.label ?? groupId)
  return {
    kind: 'switch-group',
    payload: {
      channel,
      group: groupId,
      key,
      enabled: false,
      op: 'off',
      ...(parts.length === 0 ? {} : { parts }),
    },
  }
}

// Effective size of one measured group: what the saved policy leaves in the
// next request. A snapshot from before the on/off counters existed falls back
// to the all-on numbers, which is exactly what those hosts meant.
function effectiveGroup(group) {
  return {
    tokens: num(group?.onTokens ?? group?.tokens),
    count: num(group?.onCount ?? group?.count),
    savable: num(group?.onSavableTokens ?? group?.savableTokens),
  }
}

/**
 * Build the complete health report for one snapshot.
 * @returns {{summary:{high:number,warn:number,info:number,checkedAt:number|null},checks:Array<object>}}
 */
export function buildHealth(snapshot) {
  const checks = []
  if (snapshot === null || typeof snapshot !== 'object') {
    return { summary: { high: 0, warn: 0, info: 0, checkedAt: null }, checks }
  }

  const totals = snapshot.totals ?? {}
  const effectiveTotals = snapshot.effective?.totals
  // Shares are read against what the next request actually carries. The raw
  // totals count everything that was measured, including what the policy
  // already switched off, and using them made the health strip keep warning
  // about a suite the user had just closed.
  const total = Math.max(0, num(effectiveTotals?.tokens ?? totals.tokens))
  const items = Array.isArray(snapshot.items) ? snapshot.items : []
  const groups = Array.isArray(snapshot.groups) ? snapshot.groups : []
  const policy = snapshot.policy ?? {}
  const context = snapshot.context ?? {}
  const skills = snapshot.skillsState ?? {}

  // heavy-suite: one suite carrying a quarter of the next first turn, or 30k
  // token that is still on. A suite already switched off has nothing left to
  // flag — its remaining tokens are zero and it drops out before the gate.
  const heavy = groups
    .map((group) => ({ group, ...effectiveGroup(group) }))
    .filter((entry) => entry.savable > 0)
    .map((entry) => ({ ...entry, share: percent(entry.tokens, Math.max(1, total)) }))
    .filter((entry) => entry.share >= HEAVY_SHARE || entry.tokens >= HEAVY_TOKENS)
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, HEAVY_MAX_CHECKS)
  for (const entry of heavy) {
    const group = entry.group
    checks.push({
      code: 'heavy-suite',
      severity: entry.share >= 50 || entry.tokens >= 60000 ? 'high' : 'warn',
      params: {
        label: String(group.label ?? group.id ?? ''),
        tokens: entry.tokens,
        share: entry.share,
        count: entry.count,
        channel: String(group.channel ?? ''),
      },
      action: groupAction(group, items),
    })
  }

  // catalog-truncated: the skill catalog cuts descriptions at 500 characters.
  const truncatedCount = num(skills.truncated)
  if (truncatedCount > 0) {
    const sample = items.find((item) => item?.channel === 'skills' && item?.truncated === true)
    checks.push({
      code: 'catalog-truncated',
      severity: 'info',
      params: { count: truncatedCount, limit: 500 },
      ...(sample === undefined
        ? {}
        : { action: { kind: 'open-content', payload: { channel: 'skills', id: String(sample.id ?? '') } } }),
    })
  }

  // locked-items: what cannot be switched off at all.
  const locks = Array.isArray(snapshot.locks) ? snapshot.locks : []
  const lockedTokens = locks.reduce((sum, lock) => sum + num(lock?.tokens), 0)
  const lockedShare = percent(lockedTokens, Math.max(1, total))
  if (locks.length > 0 && lockedShare >= LOCKED_SHARE) {
    checks.push({
      code: 'locked-items',
      severity: lockedShare >= LOCKED_WARN_SHARE ? 'warn' : 'info',
      params: { count: locks.length, tokens: lockedTokens, share: lockedShare },
      action: { kind: 'open-tab', payload: { tab: 'manage' } },
    })
  }

  // unknown-window: without a denominator, occupancy percentages are unknowable.
  if (context.window === null || context.window === undefined) {
    checks.push({
      code: 'unknown-window',
      severity: 'info',
      params: { used: context.used === null || context.used === undefined ? null : num(context.used) },
    })
  }

  // no-policy: this workspace still has everything on and never saved a policy.
  const savable = num(totals.savableTokens)
  if (policy.exists !== true && policy.preset === 'all' && savable > 0) {
    checks.push({
      code: 'no-policy',
      severity: 'info',
      params: { savableTokens: savable, manageable: items.filter((item) => item?.locked !== true).length },
      action: { kind: 'open-tab', payload: { tab: 'settings' } },
    })
  }

  // empty-catalog: a complete skill catalog with zero entries.
  if (num(skills.total) === 0 && skills.complete === true) {
    checks.push({
      code: 'empty-catalog',
      severity: 'info',
      params: { complete: true },
      action: { kind: 'open-tab', payload: { tab: 'settings' } },
    })
  }

  checks.sort(
    (left, right) =>
      (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9) ||
      num(right.params?.tokens) - num(left.params?.tokens) ||
      String(left.code).localeCompare(String(right.code)),
  )

  const summary = { high: 0, warn: 0, info: 0, checkedAt: num(snapshot.generatedAt) || null }
  for (const check of checks) summary[check.severity] += 1
  return { summary, checks }
}
