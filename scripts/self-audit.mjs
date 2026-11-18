#!/usr/bin/env node
// Repeatable self-audit for dsh-injection-manager.
//
// One command answers "does the repository still agree with itself?" across seven
// axes: tests, locale parity, literal client keys, the route/command/config
// contract against the docs, the published package surface, size drift, and the
// four guardrails added after the 2.2.0 consistency round.
//
// Zero dependencies, node: builtins only. The output shape is stable on purpose:
// the next RSI round diffs `--json` output instead of re-reading prose.
//
//   node scripts/self-audit.mjs                  human report
//   node scripts/self-audit.mjs --json           machine report only
//   node scripts/self-audit.mjs --strict         exit 1 when any check is fail
//   node scripts/self-audit.mjs --write-baseline write the size baseline file
//
// Weights (must match docs/RSI.md):
//   tests 30 · locale 15 · keys 10 · reconcile 15 · package 10 · invariants 20
//   size is reported but weighted 0: it warns, it never fails the build.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_REL = '_research/rsi/baseline-metrics.json'
const TEST_TIMEOUT_MS = 120_000
const EXPECTED_LOCALES = 8
const MAX_BUFFER = 64 * 1024 * 1024

const WEIGHTS = {
  tests: 30,
  locale: 15,
  keys: 10,
  reconcile: 15,
  package: 10,
  invariants: 20,
  size: 0,
}

// Absolute budgets are a coarse ceiling; the per-round comparison to
// _research/rsi/baseline-metrics.json is the signal that matters.
const SIZE_BUDGETS = {
  clientBytes: 256 * 1024,
  enLocaleBytes: 24 * 1024,
  filesBytes: 2 * 1024 * 1024,
}

const STATUS_CREDIT = { pass: 1, warn: 0.5, fail: 0 }
const DOC_PATH_EXCLUDE = new Set(['inject']) // a command, not a route
const SIZE_KEYS = ['clientBytes', 'enLocaleBytes', 'filesBytes']

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const JSON_OUT = flags.has('--json')
const STRICT = flags.has('--strict')
const WRITE_BASELINE = flags.has('--write-baseline')
const HELP = flags.has('--help') || flags.has('-h')

const KNOWN_FLAGS = new Set(['--json', '--strict', '--write-baseline', '--help', '-h'])
const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg))

if (HELP) {
  process.stdout.write(
    [
      'Usage: node scripts/self-audit.mjs [--json] [--strict] [--write-baseline]',
      '',
      '  --json            print only the JSON report',
      '  --strict          exit 1 when any check is fail (warnings do not fail)',
      '  --write-baseline  write _research/rsi/baseline-metrics.json from this run',
      '',
    ].join('\n'),
  )
  process.exit(0)
}
if (unknown.length > 0) {
  process.stderr.write(`self-audit: unknown argument(s): ${unknown.join(' ')}\n`)
  process.exit(2)
}

// ---------------------------------------------------------------- utilities

let repoCache = null
const textCache = new Map()

function readText(rel) {
  if (!textCache.has(rel)) {
    try {
      textCache.set(rel, readFileSync(join(ROOT, rel), 'utf8'))
    } catch {
      textCache.set(rel, null)
    }
  }
  return textCache.get(rel)
}

function repo() {
  if (repoCache !== null) return repoCache
  const raw = readText('package.json')
  let pkg = null
  let error = null
  if (raw === null) error = 'package.json missing'
  else {
    try {
      pkg = JSON.parse(raw)
    } catch (cause) {
      error = `package.json invalid: ${cause.message}`
    }
  }
  repoCache = { pkg, error }
  return repoCache
}

function parseJsonText(rel, what = rel) {
  const raw = readText(rel)
  if (raw === null) throw new Error(`${what} missing`)
  return JSON.parse(raw)
}

function existsRel(rel) {
  return existsSync(join(ROOT, rel))
}

function listDir(rel) {
  try {
    return readdirSync(join(ROOT, rel)).sort()
  } catch {
    return []
  }
}

function walk(abs, out = []) {
  let entries
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const path = join(abs, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

function relOf(abs) {
  return relative(ROOT, abs).replaceAll('\\', '/')
}

function comma(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'null'
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function lineOf(text, index) {
  let line = 1
  const end = Math.max(0, Math.min(index, text.length))
  for (let i = 0; i < end; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

function lineTextAt(text, index) {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? text.length : end).trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cap(list, max) {
  return list.length <= max ? list : [...list.slice(0, max), `... ${list.length - max} more`]
}

function check(id, title, weight, status, summary, metrics = {}, findings = []) {
  return {
    id,
    title,
    weight,
    status,
    score: Math.round(weight * STATUS_CREDIT[status] * 100) / 100,
    maxScore: weight,
    summary,
    metrics,
    findings,
  }
}

async function guarded(id, title, weight, run) {
  try {
    return await run()
  } catch (error) {
    return check(
      id,
      title,
      weight,
      'fail',
      `check crashed: ${error?.message ?? error}`,
      { error: String(error?.message ?? error) },
      [`unexpected error: ${error?.message ?? error}`],
    )
  }
}

// ---------------------------------------------------------------- docs

let docsCache = null

function docs() {
  if (docsCache !== null) return docsCache
  const files = []
  for (const rel of ['README.md', 'README.zh.md']) {
    const text = readText(rel)
    if (text !== null) files.push({ file: rel, text })
  }
  for (const name of listDir('docs')) {
    if (!name.endsWith('.md')) continue
    const rel = `docs/${name}`
    const text = readText(rel)
    if (text !== null) files.push({ file: rel, text })
  }
  docsCache = files
  return files
}

// ---------------------------------------------------------------- tests

function runNodeTest() {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    // process.execPath is the same node binary as `node`, without depending on
    // how the current shell resolved PATH.
    execFile(
      process.execPath,
      ['--test'],
      {
        cwd: ROOT,
        timeout: TEST_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      },
      (error, stdout, stderr) => {
        resolvePromise({
          error: error ?? null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          wallMs: Date.now() - started,
        })
      },
    )
  })
}

function parseTestCounts(output) {
  const counts = { tests: null, pass: null, fail: null, durationMs: null }
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:#|ℹ)\s+(tests|pass|fail|duration_ms)\s+(.+?)\s*$/)
    if (match === null) continue
    if (match[1] === 'duration_ms') {
      const value = Number.parseFloat(match[2])
      if (Number.isFinite(value)) counts.durationMs = value
    } else {
      const value = Number.parseInt(match[2], 10)
      if (Number.isFinite(value)) counts[match[1]] = value
    }
  }
  return counts
}

async function checkTests() {
  const run = await runNodeTest()
  const counts = parseTestCounts(`${run.stdout}\n${run.stderr}`)
  const failed = run.error !== null && (counts.fail === null || counts.fail === 0)
  const timedOut = run.error !== null && (run.error.killed === true || run.error.signal !== undefined || run.error.code === 'ETIMEDOUT')
  const findings = []

  if (timedOut) findings.push(`node --test did not finish within ${TEST_TIMEOUT_MS / 1000}s`)
  else if (run.error !== null && counts.fail !== null && counts.fail > 0) findings.push(`${counts.fail} test(s) failed`)
  else if (run.error !== null) findings.push(`node --test exited with ${run.error.code ?? run.error.signal ?? run.error.message}`)
  if (counts.pass === null) findings.push('could not parse a "# pass" or "ℹ pass" line from node --test output')
  else if (counts.pass === 0) findings.push('node --test reported zero passing tests')

  let status = 'pass'
  if (timedOut || failed || counts.pass === null || counts.fail === null || counts.fail > 0 || counts.pass === 0) status = 'fail'

  const passed = counts.pass ?? 0
  const failCount = counts.fail ?? 0
  const testMs = counts.durationMs === null ? run.wallMs : Math.round(counts.durationMs)
  const summary =
    counts.pass === null
      ? 'could not read a node --test summary'
      : `node --test: ${passed} passed, ${failCount} failed in ${(testMs / 1000).toFixed(1)}s`

  return check(
    'tests',
    'test suite',
    WEIGHTS.tests,
    status,
    summary,
    {
      passed,
      failed: failCount,
      total: counts.tests ?? null,
      durationMs: testMs,
      wallMs: run.wallMs,
      exitCode: run.error === null ? 0 : (run.error.code ?? null),
      signal: run.error?.signal ?? null,
      timedOut,
    },
    findings,
  )
}

// ---------------------------------------------------------------- locale

function flattenClient(node, prefix = '', out = {}) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return out
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) flattenClient(value, path, out)
    else out[path] = value
  }
  return out
}

function placeholders(value) {
  if (typeof value !== 'string') return null
  const set = new Set()
  for (const match of value.matchAll(/\{(\w+)\}/g)) set.add(match[1])
  return [...set].sort()
}

function loadEnglishKeys() {
  const parsed = parseJsonText('locale/en.json')
  const flat = flattenClient(parsed.client)
  return { flat, keys: Object.keys(flat) }
}

function checkLocale() {
  const files = listDir('locale').filter((name) => name.endsWith('.json'))
  const findings = []
  let english
  try {
    english = loadEnglishKeys()
  } catch (error) {
    return check('locale', 'locale parity', WEIGHTS.locale, 'fail', `cannot load locale/en.json: ${error.message}`, {
      files: files.length,
    })
  }

  const perFile = []
  let totalMissing = 0
  let totalExtra = 0
  let totalEmpty = 0
  let totalPlaceholder = 0
  let broken = 0

  for (const file of files) {
    let flat
    try {
      const parsed = parseJsonText(`locale/${file}`)
      flat = flattenClient(parsed.client)
    } catch (error) {
      broken += 1
      perFile.push({ file, error: String(error.message) })
      findings.push(`${file}: cannot parse (${error.message})`)
      continue
    }
    const keys = Object.keys(flat)
    const missing = english.keys.filter((key) => !(key in flat))
    const extra = keys.filter((key) => !(key in english.flat))
    const empty = keys.filter((key) => typeof flat[key] === 'string' && flat[key].trim() === '')
    const placeholderMismatch = english.keys.filter((key) => {
      if (!(key in flat)) return false
      const expected = placeholders(english.flat[key])
      const actual = placeholders(flat[key])
      if (expected === null || actual === null) return false
      return expected.join('|') !== actual.join('|')
    })

    totalMissing += missing.length
    totalExtra += extra.length
    totalEmpty += empty.length
    totalPlaceholder += placeholderMismatch.length
    perFile.push({
      file,
      keys: keys.length,
      missing: missing.length,
      extra: extra.length,
      empty: empty.length,
      placeholderMismatch: placeholderMismatch.length,
    })

    if (missing.length > 0) findings.push(`${file}: ${missing.length} missing (${cap(missing, 8).join(', ')})`)
    if (extra.length > 0) findings.push(`${file}: ${extra.length} extra (${cap(extra, 8).join(', ')})`)
    if (empty.length > 0) findings.push(`${file}: ${empty.length} empty (${cap(empty, 8).join(', ')})`)
    if (placeholderMismatch.length > 0) {
      findings.push(`${file}: ${placeholderMismatch.length} placeholder mismatch (${cap(placeholderMismatch, 8).join(', ')})`)
    }
  }

  const localeCountOk = files.length === EXPECTED_LOCALES
  if (!localeCountOk) findings.push(`expected ${EXPECTED_LOCALES} locale files, found ${files.length}`)
  if (!files.includes('en.json')) findings.push('locale/en.json is missing from the locale directory')

  const drift = totalMissing + totalExtra + totalEmpty + totalPlaceholder + broken
  const status = drift === 0 && localeCountOk && files.includes('en.json') ? 'pass' : 'fail'
  const summary =
    drift === 0 && localeCountOk
      ? `${files.length} dictionaries, ${english.keys.length} client keys, no drift`
      : `${files.length} dictionaries: ${totalMissing} missing / ${totalExtra} extra / ${totalEmpty} empty / ${totalPlaceholder} placeholder`

  return check(
    'locale',
    'locale parity',
    WEIGHTS.locale,
    status,
    summary,
    {
      files: files.length,
      expectedFiles: EXPECTED_LOCALES,
      englishKeys: english.keys.length,
      missing: totalMissing,
      extra: totalExtra,
      empty: totalEmpty,
      placeholderMismatch: totalPlaceholder,
      broken,
      perFile,
    },
    cap(findings, 30),
  )
}

// ---------------------------------------------------------------- client keys

function checkClientKeys() {
  const source = readText('client.js')
  if (source === null) return check('keys', 'client keys', WEIGHTS.keys, 'fail', 'client.js missing', {})
  const english = loadEnglishKeys()
  const calls = []
  const pattern = /\bt\(\s*(['"])([^'"]*)\1/g
  for (const match of source.matchAll(pattern)) calls.push({ key: match[2], index: match.index })

  const skipped = calls.filter((call) => call.key.endsWith('.') || call.key.includes('${'))
  const literal = calls.filter((call) => !call.key.endsWith('.') && !call.key.includes('${'))
  const firstUse = new Map()
  for (const call of literal) if (!firstUse.has(call.key)) firstUse.set(call.key, call.index)

  const missing = []
  for (const [key, index] of [...firstUse.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!(key in english.flat)) missing.push({ key, line: lineOf(source, index) })
  }

  const findings = missing.map(({ key, line }) => `client.js:${line} t('${key}') is not a locale/en.json client key`)
  const status = missing.length === 0 ? 'pass' : 'fail'
  const summary =
    missing.length === 0
      ? `${firstUse.size} literal keys all present; ${skipped.length} prefix-concatenated keys skipped`
      : `${missing.length} of ${firstUse.size} literal keys are missing from locale/en.json`

  return check(
    'keys',
    'client keys',
    WEIGHTS.keys,
    status,
    summary,
    {
      calls: calls.length,
      literalKeys: firstUse.size,
      skippedPrefixKeys: skipped.length,
      skippedSamples: [...new Set(skipped.map((call) => call.key))].sort(),
      missing: missing.length,
    },
    cap(findings, 30),
  )
}

// ---------------------------------------------------------------- reconcile

function routeIdsFromCode(source) {
  const prefixMatch = source.match(/export const ROUTE_PREFIX\s*=\s*['"]([^'"]+)['"]/)
  const prefix = prefixMatch === null ? '/plugins/dsh-injection-manager' : prefixMatch[1]
  const start = source.indexOf('export const ROUTES')
  const end = start === -1 ? -1 : source.indexOf('\n}', start)
  const block = start === -1 ? '' : source.slice(start, end === -1 ? source.length : end)
  const ids = []
  for (const match of block.matchAll(/(?:^|\n)\s*([A-Za-z_$][\w$]*):\s*(?:`([^`]+)`|'([^']+)')/g)) {
    let raw = match[2] ?? match[3] ?? ''
    raw = raw.replace(/\$\{ROUTE_PREFIX\}/g, prefix)
    if (raw.startsWith(`${prefix}/`)) ids.push(raw.slice(prefix.length + 1))
    else if (raw.startsWith('/')) ids.push(raw.replace(/^\/+/, ''))
  }
  return { prefix, ids: [...new Set(ids)].filter((id) => id.length > 0).sort() }
}

function commandIdsFromCode(source) {
  const ids = new Set()
  for (const match of source.matchAll(/command\s*===\s*'([a-z][a-z0-9-]*)'/g)) ids.add(match[1])
  return [...ids].sort()
}

function configFieldsFromCode(source) {
  const start = source.indexOf('export const Config')
  if (start === -1) return []
  const end = source.indexOf('// Hard dependencies', start)
  const block = source.slice(start, end === -1 ? source.length : end)
  const fields = []
  for (const match of block.matchAll(/([A-Za-z_$][\w$]*):\s*Schema\./g)) fields.push(match[1])
  return [...new Set(fields)].sort()
}

function documentedRouteIds(codeIds) {
  const found = new Set()
  const docFiles = docs()
  for (const { text } of docFiles) {
    // The README states the prefix once and then lists `/ping`, `/summary`, ...
    // Normalise both shapes to a route id; only full-prefix mentions can reveal
    // a route the code does not have.
    for (const match of text.matchAll(/\/plugins\/dsh-injection-manager\/([a-z][a-z0-9-]*)/g)) found.add(match[1])
    for (const id of codeIds) {
      const short = new RegExp('`/' + escapeRegExp(id) + '(?=[?`\\s|)])')
      if (short.test(text)) found.add(id)
    }
    // Standalone code spans such as ` /health `: catches a documented route the
    // code does not have, which the known-id loop above cannot see.
    for (const match of text.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
      if (!DOC_PATH_EXCLUDE.has(match[1])) found.add(match[1])
    }
  }
  return found
}

function documentedCommands() {
  const found = new Set()
  for (const { text } of docs()) {
    for (const match of text.matchAll(/\/inject[ \t]+([a-z][a-z0-9-]*)/g)) found.add(match[1])
  }
  return found
}

function configRowNames() {
  const names = new Set()
  for (const { text } of docs()) {
    for (const line of text.split(/\r?\n/)) {
      if (!/Plugin config row|插件行\s*`config`/.test(line)) continue
      const cells = line.split('|')
      const cell = cells[2] ?? ''
      for (const part of cell.split('/')) {
        const name = part.trim().replaceAll('`', '')
        if (/^[a-z][A-Za-z0-9]*$/.test(name)) names.add(name)
      }
    }
  }
  return names
}

function checkReconcile() {
  const routesSource = readText('lib/routes.js')
  const indexSource = readText('index.js')
  if (routesSource === null || indexSource === null) {
    return check('reconcile', 'route / command / config contract', WEIGHTS.reconcile, 'fail', 'lib/routes.js or index.js missing', {})
  }

  const routes = routeIdsFromCode(routesSource)
  const apiVersionMatch = routesSource.match(/export const API_VERSION\s*=\s*(\d+)/)
  const apiVersion = apiVersionMatch === null ? null : Number(apiVersionMatch[1])
  const commands = commandIdsFromCode(indexSource)
  const configFields = configFieldsFromCode(indexSource)
  const docRoutes = documentedRouteIds(routes.ids)
  const docCommands = documentedCommands()
  const docText = docs().map((doc) => doc.text).join('\n')

  const documentedConfig = new Set(configFields.filter((field) => new RegExp(`\\b${escapeRegExp(field)}\\b`).test(docText)))
  const tableConfig = configRowNames()

  const routeCodeOnly = routes.ids.filter((id) => !docRoutes.has(id))
  const routeDocOnly = [...docRoutes].filter((id) => !routes.ids.includes(id)).sort()
  const commandCodeOnly = commands.filter((id) => !docCommands.has(id))
  const commandDocOnly = [...docCommands].filter((id) => !commands.includes(id)).sort()
  const configCodeOnly = configFields.filter((field) => !documentedConfig.has(field))
  const configDocOnly = [...tableConfig].filter((field) => !configFields.includes(field)).sort()
  const apiVersions = [...docText.matchAll(/apiVersion\s*[:=]\s*(\d+)/g)].map((match) => match[1])
  const apiVersionDocumented = Number.isFinite(apiVersion) && apiVersions.includes(String(apiVersion))
  const apiVersionLabel = apiVersion ?? '?'

  const findings = []
  for (const id of routeDocOnly) findings.push(`route documented but not in ROUTES: /${id}`)
  for (const id of routeCodeOnly) findings.push(`route in ROUTES but not documented: /${id}`)
  for (const id of commandDocOnly) findings.push(`command documented but not handled: /inject ${id}`)
  for (const id of commandCodeOnly) findings.push(`command handled but not documented: /inject ${id}`)
  for (const field of configDocOnly) findings.push(`config field documented but absent from Config: ${field}`)
  for (const field of configCodeOnly) findings.push(`config field in Config but not documented: ${field}`)
  if (!apiVersionDocumented) findings.push(`API_VERSION ${apiVersionLabel} is not documented`)
  if (!Number.isFinite(apiVersion)) findings.push('API_VERSION is missing from lib/routes.js')

  const docOnlyTotal = routeDocOnly.length + commandDocOnly.length + configDocOnly.length
  const codeOnlyTotal = routeCodeOnly.length + commandCodeOnly.length + configCodeOnly.length
  let status = 'pass'
  if (docOnlyTotal > 0 || !Number.isFinite(apiVersion)) status = 'fail'
  else if (codeOnlyTotal > 0 || !apiVersionDocumented) status = 'warn'

  const summary =
    status === 'pass'
      ? `routes ${routes.ids.length}/${routes.ids.length}, commands ${commands.length}/${commands.length}, config ${configFields.length}/${configFields.length}, apiVersion ${apiVersionLabel}`
      : `routes ${routes.ids.length - routeCodeOnly.length}/${routes.ids.length}, commands ${commands.length - commandCodeOnly.length}/${commands.length}, config ${configFields.length - configCodeOnly.length}/${configFields.length}, apiVersion ${apiVersionLabel}`

  return check(
    'reconcile',
    'route / command / config contract',
    WEIGHTS.reconcile,
    status,
    summary,
    {
      routePrefix: routes.prefix,
      apiVersion: Number.isFinite(apiVersion) ? apiVersion : null,
      apiVersionsInDocs: [...new Set(apiVersions)].sort(),
      routes: routes.ids,
      documentedRoutes: [...docRoutes].filter((id) => routes.ids.includes(id)).sort(),
      routeCodeOnly,
      routeDocOnly,
      commands,
      documentedCommands: [...docCommands].sort(),
      commandCodeOnly,
      commandDocOnly,
      configFields,
      documentedConfig: [...documentedConfig].sort(),
      configCodeOnly,
      configDocOnly,
    },
    cap(findings, 30),
  )
}

// ---------------------------------------------------------------- package

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`)
}

function packageFilesInfo() {
  const { pkg, error } = repo()
  if (pkg === null) throw new Error(error ?? 'package.json missing')
  const seen = new Map()
  const missing = []
  const entries = Array.isArray(pkg.files) ? pkg.files : []
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      missing.push(String(entry))
      continue
    }
    const abs = resolve(ROOT, entry)
    if (!entry.includes('*')) {
      if (!existsSync(abs)) {
        missing.push(entry)
        continue
      }
      if (statSync(abs).isDirectory()) for (const file of walk(abs)) seen.set(relOf(file), file)
      else seen.set(relOf(abs), abs)
      continue
    }
    const slash = entry.lastIndexOf('/')
    const dirPart = slash === -1 ? '.' : entry.slice(0, slash)
    const basePart = slash === -1 ? entry : entry.slice(slash + 1)
    const dirAbs = resolve(ROOT, dirPart)
    if (!existsSync(dirAbs)) {
      missing.push(entry)
      continue
    }
    const matcher = globToRegExp(basePart)
    let matched = 0
    for (const name of readdirSync(dirAbs).sort()) {
      if (!matcher.test(name)) continue
      const file = join(dirAbs, name)
      const stat = statSync(file)
      matched += 1
      if (stat.isDirectory()) for (const nested of walk(file)) seen.set(relOf(nested), nested)
      else if (stat.isFile()) seen.set(relOf(file), file)
    }
    if (matched === 0) missing.push(entry)
  }
  return {
    entries: entries.map(String),
    files: [...seen.keys()].sort(),
    paths: [...seen.values()].sort(),
    missing: [...new Set(missing)].sort(),
  }
}

function exportTargets(exportsField) {
  const out = []
  const walk = (node, key) => {
    if (typeof node === 'string') {
      out.push({ key, target: node })
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [name, value] of Object.entries(node)) walk(value, key === null ? name : `${key}.${name}`)
  }
  for (const [name, value] of Object.entries(exportsField ?? {})) walk(value, name)
  return out
}

function targetExists(target) {
  if (typeof target !== 'string' || target.length === 0) return false
  if (!target.includes('*')) return existsRel(target.replace(/^\.\//, ''))
  const slash = target.lastIndexOf('/')
  const dirRel = slash === -1 ? '.' : target.slice(0, slash).replace(/^\.\//, '')
  const base = slash === -1 ? target : target.slice(slash + 1)
  const dirAbs = join(ROOT, dirRel)
  if (!existsSync(dirAbs)) return false
  const matcher = globToRegExp(base)
  return readdirSync(dirAbs).some((name) => matcher.test(name))
}

function checkPackage() {
  const { pkg, error } = repo()
  if (pkg === null) return check('package', 'package surface', WEIGHTS.package, 'fail', error ?? 'package.json missing', {})
  const info = packageFilesInfo()
  const targets = exportTargets(pkg.exports)
  const missingExports = targets.filter((entry) => !targetExists(entry.target))
  const changelog = readText('CHANGELOG.md')
  const changelogVersion = changelog === null ? null : ((changelog.match(/^##\s+\[?v?(\d+\.\d+\.\d+)/m) ?? [])[1] ?? null)
  const versionMatch = changelogVersion !== null && pkg.version === changelogVersion
  const selfAuditShipped = info.files.includes('scripts/self-audit.mjs')

  const findings = []
  for (const entry of info.missing) findings.push(`files entry does not exist or matches nothing: ${entry}`)
  for (const entry of missingExports) findings.push(`exports target does not exist: ${entry.key} -> ${entry.target}`)
  if (!versionMatch) findings.push(`package.json version ${pkg.version ?? '?'} != CHANGELOG latest ${changelogVersion ?? '?'}`)
  if (!selfAuditShipped) findings.push('scripts/self-audit.mjs is not covered by package.json files')

  const baseStatus = info.missing.length === 0 && missingExports.length === 0 && versionMatch ? 'pass' : 'fail'
  const status = baseStatus === 'pass' && !selfAuditShipped ? 'warn' : baseStatus
  const summary =
    baseStatus === 'pass'
      ? `files ${info.files.length} present, exports ${targets.length} present, version ${pkg.version} = CHANGELOG${selfAuditShipped ? '' : ' (audit script not shipped)'}`
      : `${info.missing.length} missing files, ${missingExports.length} missing exports, version ${pkg.version ?? '?'} vs ${changelogVersion ?? '?'}`

  return check(
    'package',
    'package surface',
    WEIGHTS.package,
    status,
    summary,
    {
      version: pkg.version ?? null,
      changelogVersion,
      filesEntries: info.entries.length,
      filesMatched: info.files.length,
      missingFiles: info.missing,
      exportTargets: targets.length,
      missingExports: missingExports.map((entry) => `${entry.key} -> ${entry.target}`),
      selfAuditShipped,
    },
    cap(findings, 30),
  )
}

// ---------------------------------------------------------------- size

function baselinePath() {
  return join(ROOT, BASELINE_REL)
}

function readBaseline() {
  const path = baselinePath()
  if (!existsSync(path)) return { path: BASELINE_REL, exists: false, data: null, error: null }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return { path: BASELINE_REL, exists: true, data, error: null }
  } catch (error) {
    return { path: BASELINE_REL, exists: false, data: null, error: String(error.message) }
  }
}

function metricValue(data, key) {
  if (data === null || typeof data !== 'object') return null
  const value = data[key] ?? data.metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function checkSize() {
  const { pkg } = repo()
  const info = packageFilesInfo()
  const clientPath = join(ROOT, 'client.js')
  const enPath = join(ROOT, 'locale/en.json')
  const clientBytes = existsSync(clientPath) ? statSync(clientPath).size : 0
  const enLocaleBytes = existsSync(enPath) ? statSync(enPath).size : 0
  const filesBytes = info.paths.reduce((sum, file) => sum + statSync(file).size, 0)
  const current = { clientBytes, enLocaleBytes, filesBytes }

  let baseline = readBaseline()
  let written = false
  if (WRITE_BASELINE) {
    const payload = {
      schemaVersion: 1,
      writtenAt: new Date().toISOString(),
      version: pkg?.version ?? null,
      clientBytes,
      enLocaleBytes,
      filesBytes,
      filesCount: info.files.length,
    }
    mkdirSync(dirname(baselinePath()), { recursive: true })
    writeFileSync(baselinePath(), `${JSON.stringify(payload, null, 2)}\n`)
    baseline = { path: BASELINE_REL, exists: true, data: payload, error: null }
    written = true
  }

  const comparison = {}
  const findings = []
  for (const key of SIZE_KEYS) {
    const previous = metricValue(baseline.data, key)
    const value = current[key]
    const delta = previous === null ? null : value - previous
    const percent = previous === null || previous === 0 ? null : Math.round((delta / previous) * 1000) / 10
    comparison[key] = { current: value, baseline: previous, delta, percent }
    if (previous !== null && delta > 0 && percent !== null && percent > 5) {
      findings.push(`${key} grew ${comma(delta)} B (${percent}%) over baseline`)
    }
  }
  for (const key of SIZE_KEYS) {
    if (current[key] > SIZE_BUDGETS[key]) findings.push(`${key} ${comma(current[key])} B exceeds budget ${comma(SIZE_BUDGETS[key])} B`)
  }
  if (!baseline.exists && !written) findings.push(`no baseline (${BASELINE_REL}); run with --write-baseline to pin this round`)
  if (baseline.error !== null) findings.push(`baseline is unreadable: ${baseline.error}`)

  const status = findings.length === 0 ? 'pass' : 'warn'
  const summary =
    findings.length === 0
      ? `client ${comma(clientBytes)} B, en ${comma(enLocaleBytes)} B, package ${comma(filesBytes)} B; within budget and baseline`
      : `client ${comma(clientBytes)} B, en ${comma(enLocaleBytes)} B, package ${comma(filesBytes)} B; see warnings`

  return check(
    'size',
    'size budget',
    WEIGHTS.size,
    status,
    summary,
    {
      clientBytes,
      enLocaleBytes,
      filesBytes,
      filesCount: info.files.length,
      budgets: SIZE_BUDGETS,
      baseline: {
        path: BASELINE_REL,
        exists: baseline.exists,
        written,
        comparison,
      },
    },
    findings,
  )
}

// ---------------------------------------------------------------- invariants

function sliceFunction(source, name) {
  const marker = `function ${name}`
  const start = source.indexOf(marker)
  if (start === -1) return null
  const boundary = /\n[ \t]*(?:async\s+)?function[ \t]+[A-Za-z_$]/g
  boundary.lastIndex = start + 1
  const next = boundary.exec(source)
  return { start, text: source.slice(start, next === null ? source.length : next.index) }
}

function sliceTopConst(source, name) {
  const marker = `const ${name} =`
  const start = source.indexOf(marker)
  if (start === -1) return null
  const boundary = /\n  (?:const|let|function|async function) /g
  boundary.lastIndex = start + 1
  const next = boundary.exec(source)
  return { start, text: source.slice(start, next === null ? source.length : next.index) }
}

function guard(id, title, ok, passSummary, failSummary, findings = []) {
  return { id, title, status: ok ? 'pass' : 'fail', summary: ok ? passSummary : failSummary, findings: ok ? [] : findings }
}

function checkInvariants() {
  const client = readText('client.js')
  const routes = readText('lib/routes.js')
  const policy = readText('lib/policy.js')
  const english = (() => {
    try {
      return { flat: loadEnglishKeys().flat, error: null }
    } catch (error) {
      return { flat: null, error: String(error.message) }
    }
  })()

  const guards = []

  // (a) DockChip must not go back to the all-on total.
  const dock = client === null ? null : sliceFunction(client, 'DockChip')
  const dockHits = []
  if (dock !== null) {
    for (const match of dock.text.matchAll(/data\.totals\.tokens\b/g)) {
      const index = dock.start + match.index
      dockHits.push({ line: lineOf(client, index), snippet: lineTextAt(client, index) })
    }
  }
  guards.push(
    guard(
      'a',
      'DockChip does not read data.totals.tokens',
      dock !== null && dockHits.length === 0,
      'no data.totals.tokens inside DockChip',
      dock === null ? 'DockChip not found in client.js' : `${dockHits.length} data.totals.tokens hit(s) inside DockChip`,
      dockHits.map((hit) => `client.js:${hit.line} ${hit.snippet}`).concat(
        dockHits.length === 0 ? [] : ['if the old-host fallback is intentional, narrow this guard to the primary assignment'],
      ),
    ),
  )

  // (b) "off next session" has its own label; the ordinary row no longer says
  // "turnedOff" for an item that is still in this session.
  const itemRow = client === null ? null : sliceFunction(client, 'ItemRow')
  const offInClient = client !== null && /t\(\s*['"]offNextSession['"]\s*\)/.test(client)
  const offInEnglish = english.flat !== null && Object.hasOwn(english.flat, 'offNextSession')
  const rowHits = []
  if (itemRow !== null && client !== null) {
    for (const match of itemRow.text.matchAll(/t\(\s*['"]turnedOff['"]\s*\)/g)) {
      rowHits.push({ line: lineOf(client, itemRow.start + match.index) })
    }
  }
  guards.push(
    guard(
      'b',
      'offNextSession exists; ItemRow does not use turnedOff',
      offInClient && offInEnglish && itemRow !== null && rowHits.length === 0,
      'offNextSession present in client.js + en.json; ItemRow has no turnedOff',
      `offInClient=${offInClient} offInEnglish=${offInEnglish} rowHits=${rowHits.length}`,
      [
        ...(offInClient ? [] : ["client.js has no t('offNextSession')"]),
        ...(offInEnglish ? [] : ['locale/en.json client.offNextSession is missing']),
        ...(itemRow === null ? ['ItemRow not found in client.js'] : []),
        ...rowHits.map((hit) => `client.js:${hit.line} ItemRow still calls t('turnedOff')`),
      ],
    ),
  )

  // (c) The /action route is the one write path and must share the policy queue.
  const action = routes === null ? null : sliceTopConst(routes, 'action')
  const routesInfo = routes === null ? { ids: [] } : routeIdsFromCode(routes)
  const actionRoutePresent = routesInfo.ids.includes('action')
  const lock = action === null ? null : action.text.match(/withPolicyLock/g)
  guards.push(
    guard(
      'c',
      'action route uses withPolicyLock',
      actionRoutePresent && action !== null && lock !== null,
      'ROUTES.action present; handler calls withPolicyLock',
      action === null ? 'action handler not found in lib/routes.js' : 'action handler does not call withPolicyLock',
      [
        ...(actionRoutePresent ? [] : ['ROUTES.action is missing']),
        ...(action === null ? ['lib/routes.js: const action = ... not found'] : []),
        ...(action !== null && lock === null ? ['lib/routes.js: action handler has no withPolicyLock'] : []),
      ],
    ),
  )

  // (d) The backup write is what makes a corrupt policy recoverable.
  const backup = policy === null ? null : [...policy.matchAll(/BACKUP_SUFFIX/g)]
  guards.push(
    guard(
      'd',
      'policy.js keeps BACKUP_SUFFIX',
      backup !== null && backup.length > 0,
      `BACKUP_SUFFIX present (${backup?.length ?? 0} references)`,
      'lib/policy.js has no BACKUP_SUFFIX',
      policy === null ? ['lib/policy.js is missing'] : [],
    ),
  )

  const passed = guards.filter((item) => item.status === 'pass').length
  const findings = guards.flatMap((item) => item.findings.map((finding) => `(${item.id}) ${finding}`))
  const status = passed === guards.length ? 'pass' : 'fail'
  const result = check(
    'invariants',
    'regression guards',
    WEIGHTS.invariants,
    status,
    `${passed}/${guards.length} guards pass`,
    { passed, total: guards.length, guards },
    cap(findings, 30),
  )
  // The four guards are independent; each one is worth a quarter of the group.
  result.score = Math.round((WEIGHTS.invariants * passed) / guards.length * 10) / 10
  if (result.score === WEIGHTS.invariants) result.status = 'pass'
  return result
}

// ---------------------------------------------------------------- report

function humanDetails(item) {
  const lines = []
  const m = item.metrics
  switch (item.id) {
    case 'tests':
      lines.push(`pass ${comma(m.passed)} · fail ${comma(m.failed)} · ${(m.durationMs / 1000).toFixed(1)}s`)
      if (m.timedOut) lines.push(`timed out after ${TEST_TIMEOUT_MS / 1000}s`)
      break
    case 'locale':
      lines.push(`en keys ${comma(m.englishKeys)} · ${m.files} files (expected ${m.expectedFiles})`)
      for (const file of m.perFile ?? []) {
        if (file.error !== undefined) lines.push(`${file.file}: ${file.error}`)
        else lines.push(`${file.file}: keys ${file.keys} | missing ${file.missing} | extra ${file.extra} | empty ${file.empty} | placeholders ${file.placeholderMismatch}`)
      }
      break
    case 'keys':
      lines.push(`calls ${comma(m.calls)} · literal ${comma(m.literalKeys)} · skipped ${comma(m.skippedPrefixKeys)} · missing ${comma(m.missing)}`)
      if (m.skippedSamples?.length > 0) lines.push(`skipped prefixes: ${m.skippedSamples.join(', ')}`)
      break
    case 'reconcile':
      lines.push(`routes ${m.documentedRoutes.length}/${m.routes.length} · commands ${m.documentedCommands.length}/${m.commands.length} · config ${m.documentedConfig.length}/${m.configFields.length} · apiVersion ${m.apiVersion ?? '?'}`)
      if (m.routeCodeOnly.length + m.routeDocOnly.length + m.commandCodeOnly.length + m.commandDocOnly.length + m.configCodeOnly.length + m.configDocOnly.length > 0) {
        lines.push(`code-only: routes [${m.routeCodeOnly.join(', ')}] commands [${m.commandCodeOnly.join(', ')}] config [${m.configCodeOnly.join(', ')}]`)
        lines.push(`doc-only: routes [${m.routeDocOnly.join(', ')}] commands [${m.commandDocOnly.join(', ')}] config [${m.configDocOnly.join(', ')}]`)
      }
      break
    case 'package':
      lines.push(`files ${m.filesMatched} matched from ${m.filesEntries} entries · exports ${m.exportTargets - m.missingExports.length}/${m.exportTargets} · version ${m.version ?? '?'} / CHANGELOG ${m.changelogVersion ?? '?'}`)
      break
    case 'size':
      lines.push(`client ${comma(m.clientBytes)} B / ${comma(m.budgets.clientBytes)} B · en ${comma(m.enLocaleBytes)} B / ${comma(m.budgets.enLocaleBytes)} B · package ${comma(m.filesBytes)} B / ${comma(m.budgets.filesBytes)} B`)
      lines.push(`baseline ${m.baseline.exists ? m.baseline.path : 'absent'}${m.baseline.written ? ' (written now)' : ''}`)
      for (const key of SIZE_KEYS) {
        const row = m.baseline.comparison[key]
        const suffix = row.baseline === null ? 'null' : `${row.delta >= 0 ? '+' : ''}${comma(row.delta)} B (${row.percent ?? 'n/a'}%)`
        lines.push(`${key}: ${comma(row.current)} B vs baseline ${suffix}`)
      }
      break
    case 'invariants':
      for (const item of m.guards ?? []) lines.push(`(${item.id}) ${item.status.toUpperCase()}: ${item.summary}`)
      break
    default:
      break
  }
  return lines
}

function printHuman(report) {
  const out = []
  out.push('')
  out.push(`${report.repo.name} self-audit  ${report.repo.version ?? '?'}  ${report.generatedAt}`)
  out.push(`node ${report.node}  ·  score ${report.score}/${report.maxScore}  ·  ${report.status.toUpperCase()}`)
  for (const item of report.checks) {
    out.push('')
    out.push(`[${item.status.toUpperCase()}] ${item.id}  ${item.score}/${item.maxScore}`)
    out.push(`  ${item.summary}`)
    for (const line of humanDetails(item)) out.push(`  ${line}`)
    for (const finding of item.findings.slice(0, 8)) out.push(`  - ${finding}`)
    if (item.findings.length > 8) out.push(`  - ... ${item.findings.length - 8} more (see --json)`)
  }
  out.push('')
  out.push(`totals: ${report.totals.pass} pass · ${report.totals.warn} warn · ${report.totals.fail} fail`)
  out.push(`baseline: ${report.baseline.exists ? report.baseline.path : 'not written (run --write-baseline)'}`)
  out.push(`strict: ${STRICT ? (report.totals.fail > 0 ? 'on, failing (exit 1)' : 'on, no fail') : 'off'}`)
  out.push('')
  process.stdout.write(`${out.join('\n')}\n`)
}

async function main() {
  const started = Date.now()
  const { pkg } = repo()
  const checks = []
  checks.push(await guarded('tests', 'test suite', WEIGHTS.tests, checkTests))
  checks.push(await guarded('locale', 'locale parity', WEIGHTS.locale, checkLocale))
  checks.push(await guarded('keys', 'client keys', WEIGHTS.keys, checkClientKeys))
  checks.push(await guarded('reconcile', 'route / command / config contract', WEIGHTS.reconcile, checkReconcile))
  checks.push(await guarded('package', 'package surface', WEIGHTS.package, checkPackage))
  checks.push(await guarded('size', 'size budget', WEIGHTS.size, checkSize))
  const sizeCheck = checks.find((item) => item.id === 'size')
  // Size is a warning surface by contract: even a crash must not turn the
  // audit red for a metric that has no weight.
  if (sizeCheck !== undefined && sizeCheck.status === 'fail') {
    sizeCheck.status = 'warn'
    sizeCheck.score = 0
    sizeCheck.findings.push('size check failed; downgraded to warn because size has no weight')
  }
  checks.push(await guarded('invariants', 'regression guards', WEIGHTS.invariants, checkInvariants))

  const totals = { pass: 0, warn: 0, fail: 0 }
  for (const item of checks) totals[item.status] += 1
  const score = Math.round(checks.reduce((sum, item) => sum + item.score, 0) * 10) / 10
  const maxScore = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0)
  const status = totals.fail > 0 ? 'fail' : totals.warn > 0 ? 'warn' : 'pass'
  const sizeItem = checks.find((item) => item.id === 'size')

  const report = {
    schemaVersion: 1,
    tool: 'self-audit',
    generatedAt: new Date().toISOString(),
    repo: {
      name: pkg?.name ?? 'dsh-injection-manager',
      version: pkg?.version ?? null,
    },
    node: process.version,
    elapsedMs: Date.now() - started,
    status,
    score,
    maxScore,
    weights: WEIGHTS,
    budget: SIZE_BUDGETS,
    totals,
    baseline: {
      path: BASELINE_REL,
      exists: sizeItem?.metrics?.baseline?.exists === true,
      written: sizeItem?.metrics?.baseline?.written === true,
    },
    checks,
  }

  if (JSON_OUT) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else printHuman(report)

  process.exitCode = STRICT && totals.fail > 0 ? 1 : 0
}

await main()
