// Sanitized diagnostic report for a bug report.
//
// `/diag` answers "what is this process doing right now" and therefore carries
// absolute paths and internal identifiers. A report pasted into a public issue
// must not: this module keeps the version/compatibility/registration facts an
// author needs and drops every path, session id and module URL.
import { readFileSync } from 'node:fs'

function pluginVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function line(label, value) {
  if (value === undefined || value === null || value === '') return `${label}: (unknown)`
  return `${label}: ${value}`
}

/**
 * Build a plain-text report from the `/diag` payload. Pure: the payload is not
 * mutated, and no path-like string is copied out.
 */
export function buildDiagnosticsReport(payload) {
  const source = payload !== null && typeof payload === 'object' ? payload : {}
  const host = source.host !== null && typeof source.host === 'object' ? source.host : {}
  const boot = source.clientBoot !== null && typeof source.clientBoot === 'object' ? source.clientBoot : {}
  const registrations = source.clientRegistrations !== null && typeof source.clientRegistrations === 'object' ? source.clientRegistrations : {}
  const rewrite = source.rewrite !== null && typeof source.rewrite === 'object' ? source.rewrite : {}
  const last = source.lastApplication !== null && typeof source.lastApplication === 'object' ? source.lastApplication : {}
  const report = last.report !== null && typeof last.report === 'object' ? last.report : {}
  const counts = report.counts !== null && typeof report.counts === 'object' ? report.counts : {}

  const slots = Array.isArray(registrations.slots) ? registrations.slots : []
  const failedSlots = slots.filter((entry) => entry !== null && entry !== undefined && entry.ok === false).map((entry) => entry.key)
  const channels = ['sections', 'contexts', 'skills', 'tools', 'instructions']
    .map((channel) => {
      const row = counts[channel]
      if (row === null || row === undefined || typeof row !== 'object') return null
      return `${channel} ${row.on ?? '?'}/${row.total ?? '?'}`
    })
    .filter((entry) => entry !== null)

  return [
    'dsh-injection-manager diagnostics',
    line('generatedAt', new Date(Number(source.at) || Date.now()).toISOString()),
    line('pluginVersion', pluginVersion()),
    line('hostVersion', host.version ?? 'unknown'),
    line('hostSupported', host.supported === null || host.supported === undefined ? 'unknown' : String(host.supported)),
    line('hostTested', host.tested ?? 'unknown'),
    line('apiVersion', source.apiVersion ?? '2'),
    line('clientBootStage', boot.stage ?? 'unknown'),
    line('clientBootError', boot.error === undefined || boot.error === null ? 'none' : String(boot.error).slice(0, 200)),
    line('clientRegistrations', `${slots.length} slots, ${failedSlots.length} failed${failedSlots.length > 0 ? ` (${failedSlots.join(', ')})` : ''}`),
    line('rewriteCount', rewrite.count ?? 'unknown'),
    line('appliedAgents', source.appliedAgents ?? 'unknown'),
    line('lastApplication', last.at === undefined ? 'none' : new Date(Number(last.at)).toISOString()),
    line('lastApplicationSource', report.source ?? 'none'),
    line('lastApplicationSkipped', report.skipped === undefined ? 'none' : String(report.skipped).slice(0, 200)),
    line('policyChannels', channels.length === 0 ? 'unknown' : channels.join(', ')),
    line('projectedTokens', report.projectedTokens ?? 'unknown'),
    line('savedTokens', report.savedTokens ?? 'unknown'),
  ].join('\n')
}
