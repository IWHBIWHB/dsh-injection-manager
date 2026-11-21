// Host identity and compatibility.
//
// The plugin targets the DSH 0.2.2 surface (scoped assemble waterfall, skills
// provider, tools.restrict). Reading the running CLI's version lets the panel
// say "this host may not support X" instead of failing silently on an older
// build. Everything here is best-effort: an unknown version is reported as
// unknown, never guessed from the app name.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export const TESTED_VERSION = '0.2.2'

/** Compare dotted numeric versions; non-numeric suffixes (rc.3) are ignored. */
export function compareVersions(left, right) {
  const parts = (value) =>
    String(value)
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))
  const a = parts(left)
  const b = parts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

let cached

function readVersion(anchor) {
  try {
    const manifest = JSON.parse(readFileSync(join(anchor, 'package.json'), 'utf8'))
    if (typeof manifest.version === 'string') return { version: manifest.version, source: anchor }
  } catch {
    /* try the next anchor */
  }
  return undefined
}

/**
 * Walk up from a file path until a `package.json` named @deepseek-ai/dsh is
 * found. Older CLI hosts do not set DSH_INSTALL_DIR and their profile does not
 * depend on @deepseek-ai/dsh, so the launcher entry (process.argv[1]) is the only
 * anchor that still identifies the running build.
 */
export function findManifestNear(file) {
  if (typeof file !== 'string' || file.length === 0) return undefined
  let directory
  try {
    directory = dirname(file)
  } catch {
    return undefined
  }
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      if (manifest && manifest.name === '@deepseek-ai/dsh' && typeof manifest.version === 'string') {
        return { version: manifest.version, source: directory }
      }
    } catch {
      /* keep walking */
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

export function hostInfo() {
  if (cached !== undefined) return cached

  const anchors = []
  if (process.env.DSH_INSTALL_DIR) anchors.push(process.env.DSH_INSTALL_DIR)
  const profile = process.env.DSH_PROFILE_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop')

  for (const anchor of anchors) {
    const found = readVersion(anchor)
    if (found !== undefined) {
      cached = { ...found, tested: TESTED_VERSION, supported: compareVersions(found.version, TESTED_VERSION) >= 0 }
      return cached
    }
  }

  // 0.2.0/0.2.1 CLI installs: the launcher path is the version anchor.
  const near = findManifestNear(process.argv[1])
  if (near !== undefined) {
    cached = { ...near, tested: TESTED_VERSION, supported: compareVersions(near.version, TESTED_VERSION) >= 0 }
    return cached
  }

  try {
    const require = createRequire(join(profile, 'package.json'))
    const manifest = require('@deepseek-ai/dsh/package.json')
    if (manifest && typeof manifest.version === 'string') {
      cached = {
        version: manifest.version,
        source: '@deepseek-ai/dsh',
        tested: TESTED_VERSION,
        supported: compareVersions(manifest.version, TESTED_VERSION) >= 0,
      }
      return cached
    }
  } catch {
    /* unknown host */
  }

  cached = { version: null, source: null, tested: TESTED_VERSION, supported: null }
  return cached
}

export function resetHostInfoCache() {
  cached = undefined
}
