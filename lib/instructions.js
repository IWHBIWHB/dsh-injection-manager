// Workspace-rule (AGENTS.md / CLAUDE.md) discovery, read-only.
//
// dsh-agent-instructions injects the baseline as a pre-step user message and
// exposes no suppression hook (see _research/api-spec.md §7). This plugin
// therefore never edits, renames or hides instruction files: it only reports
// which files the harness will load, how large they are, and which ones sit
// outside the load path. Managing "everything manageable" starts with being
// honest about what is not manageable.
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'

// Keep in sync with dsh-agent-instructions defaults.
export const INSTRUCTION_BUDGET_BYTES = 65536
const BASE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
const LOCAL_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']
const ROOT_MARKERS = ['.git']

import { countText } from './measure.js'

function envPath(name) {
  const raw = process.env[name]
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2))
  return resolvePath(raw)
}

/** Absolute cwd → nearest ancestor containing `.git`, else cwd itself. */
export function projectRootOf(cwd) {
  let current = resolvePath(cwd)
  for (;;) {
    if (ROOT_MARKERS.some((marker) => existsSync(join(current, marker)))) return current
    const parent = dirname(current)
    if (parent === current) return resolvePath(cwd)
    current = parent
  }
}

/** Project root → cwd inclusive, outermost first. */
function ancestorChain(root, cwd) {
  const chain = []
  let current = resolvePath(cwd)
  const stop = resolvePath(root)
  for (;;) {
    chain.push(current)
    if (current === stop) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return chain.reverse()
}

async function probe(path, display, scope, { readContent }) {
  let info
  try {
    info = await stat(path)
  } catch {
    return undefined
  }
  if (!info.isFile()) return undefined
  const entry = { path, display, scope, bytes: info.size, status: 'loaded', chars: 0, tokens: 0 }
  if (info.size > INSTRUCTION_BUDGET_BYTES) entry.status = 'over-budget'
  if (readContent) {
    try {
      const measure = countText(await readFile(path, 'utf8'))
      entry.chars = measure.chars
      entry.tokens = measure.tokens
    } catch {
      entry.status = 'unreadable'
    }
  }
  return entry
}

const relative = (root, path) => {
  const value = path.slice(resolvePath(root).length).replace(/^[/\\]/, '')
  return value.length > 0 ? value : '.'
}

/**
 * The two user-global candidates render as `~/.dsh/AGENTS.md` and
 * `~/.agents/AGENTS.md`; project candidates render relative to cwd like the
 * harness does. `warnings` lists files that exist but are never loaded.
 */
export async function collectInstructions(cwd) {
  const cwdAbsolute = resolvePath(cwd)
  const dshHome = envPath('DSH_HOME') ?? join(homedir(), '.dsh')
  const agentsHome = envPath('DSH_AGENTS_HOME') ?? join(homedir(), '.agents')

  const files = []
  for (const [root, display] of [
    [dshHome, '~/.dsh'],
    [agentsHome, '~/.agents'],
  ]) {
    const path = join(root, 'AGENTS.md')
    const entry = await probe(path, `${display}/AGENTS.md`, 'user-global', { readContent: true })
    files.push(entry ?? { path, display: `${display}/AGENTS.md`, scope: 'user-global', status: 'missing', bytes: 0, chars: 0, tokens: 0 })
  }

  const projectRoot = projectRootOf(cwdAbsolute)
  for (const directory of ancestorChain(projectRoot, cwdAbsolute)) {
    for (const candidate of [...BASE_CANDIDATES, ...LOCAL_CANDIDATES]) {
      const path = join(directory, candidate)
      const entry = await probe(path, relative(cwdAbsolute, path), 'project', { readContent: true })
      if (entry !== undefined) files.push(entry)
    }
  }

  // Present but outside the load path: ~/AGENTS.md is the classic mistake.
  const warnings = []
  for (const candidate of BASE_CANDIDATES) {
    const path = join(homedir(), candidate)
    try {
      const info = await stat(path)
      if (info.isFile()) warnings.push({ path, bytes: info.size })
    } catch {
      /* absent is the normal case */
    }
  }

  const loaded = files.filter((file) => file.status !== 'missing')
  const total = loaded.reduce(
    (sum, file) => ({ chars: sum.chars + file.chars, tokens: sum.tokens + file.tokens }),
    { chars: 0, tokens: 0 },
  )
  return {
    budgetBytes: INSTRUCTION_BUDGET_BYTES,
    projectRoot,
    loadedCount: loaded.length,
    overBudgetCount: loaded.filter((file) => file.status === 'over-budget').length,
    files,
    warnings,
    chars: total.chars,
    tokens: total.tokens,
    // Instruction files have no public suppression hook at 0.2.2; the panel
    // says so instead of offering a switch that would do nothing.
    manageable: false,
  }
}
