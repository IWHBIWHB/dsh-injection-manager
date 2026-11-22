// Third-party plugin tools are not in the shipped-source catalog: their names
// come from packages installed in the same profile. Rather than guessing with a
// hardcoded list, read the profile's node_modules once and match a tool name
// against installed package name stems (agentero_list_papers -> agentero-dsh).
// The result is explicitly labelled as inference in the ledger evidence.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_NAMES = new Set(['.bin', '.pnpm', '.ignored', '@types', 'typescript', 'react', 'react-dom'])

let cached = null

function packageStems(pkg) {
  const base = pkg.includes('/') ? pkg.slice(pkg.lastIndexOf('/') + 1) : pkg
  const stems = new Set([base])
  const stripped = base.replace(/^dsh-/, '').replace(/-dsh$/, '').replace(/-dsh-.*$/, '')
  if (stripped.length >= 3) stems.add(stripped)
  if (base.includes('-')) {
    const first = base.split('-')[0]
    if (first.length >= 3) stems.add(first)
  }
  return [...stems]
}

function buildIndex() {
  const index = new Map()
  let nodeModules = ''
  try {
    // <profile>/node_modules/dsh-injection-manager/lib/plugin-tools.js
    const lib = dirname(fileURLToPath(import.meta.url))
    nodeModules = dirname(dirname(lib))
  } catch {
    return index
  }
  const add = (pkg) => {
    for (const stem of packageStems(pkg)) {
      const key = stem.toLowerCase()
      if (!index.has(key)) index.set(key, pkg)
    }
  }
  try {
    for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name.startsWith('@')) {
        try {
          for (const inner of readdirSync(join(nodeModules, entry.name), { withFileTypes: true })) {
            if (inner.isDirectory() || inner.isSymbolicLink()) add(`${entry.name}/${inner.name}`)
          }
        } catch {
          // unreadable scope: no inference from it
        }
        continue
      }
      if (SKIP_NAMES.has(entry.name)) continue
      add(entry.name)
    }
  } catch {
    return index
  }
  return index
}

/**
 * Best-effort owner for a tool name that neither the catalog nor an `mcp__`
 * prefix explains: the longest installed package stem that prefixes the tool
 * name (before the first `_` segment). Returns null when nothing matches.
 */
export function installedPluginForTool(name) {
  const value = String(name ?? '')
  if (value.length === 0) return null
  if (cached === null) cached = buildIndex()
  const head = value.split('_')[0].toLowerCase()
  if (head.length < 3) return null
  return cached.get(head) ?? null
}
