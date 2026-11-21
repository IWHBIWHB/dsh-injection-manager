#!/usr/bin/env node
// One release, one command.
//
//   node scripts/release.mjs patch "Fix the wording of the empty state"
//   node scripts/release.mjs minor "Conversation tab health card"
//   node scripts/release.mjs 2.3.1 "…"
//   node scripts/release.mjs 2.3.1 --dry-run
//
// The release body must already be in CHANGELOG.md as `## <version> — <date>`;
// this script refuses to invent release notes. It runs the same gates CI runs,
// bumps package.json, commits only the version + changelog, and creates the
// annotated tag. Pushing is deliberately left to the caller (git push, or the
// Git-data-API fallback when github.com is unreachable).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const positional = argv.filter((arg) => !arg.startsWith('--'))
const dryRun = flags.has('--dry-run')
const unknown = argv.filter((arg) => arg.startsWith('--') && !['--dry-run', '--help', '-h'].includes(arg))
if (flags.has('--help') || flags.has('-h')) {
  console.log('usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> ["summary"] [--dry-run]')
  process.exit(0)
}
if (unknown.length > 0) {
  console.error(`release: unknown flag(s): ${unknown.join(' ')}`)
  process.exit(2)
}
if (positional.length === 0) {
  console.error('release: missing version or bump (patch|minor|major|X.Y.Z)')
  process.exit(2)
}

const run = (command, args, options = {}) => execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options })
const capture = (command, args) => execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim()

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value))
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`
}

function bump(current, kind) {
  if (kind === 'patch') return formatVersion({ ...current, patch: current.patch + 1 })
  if (kind === 'minor') return formatVersion({ ...current, minor: current.minor + 1, patch: 0 })
  if (kind === 'major') return formatVersion({ major: current.major + 1, minor: 0, patch: 0 })
  return null
}

const status = capture('git', ['status', '--porcelain'])
if (status !== '') {
  console.error('release: working tree is not clean. Commit or stash first:\n' + status)
  process.exit(1)
}

const packagePath = join(ROOT, 'package.json')
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
const current = parseVersion(manifest.version)
if (current === null) {
  console.error(`release: package.json version is not plain semver: ${manifest.version}`)
  process.exit(1)
}
const next = parseVersion(positional[0]) === null ? bump(current, positional[0]) : formatVersion(parseVersion(positional[0]))
if (next === null) {
  console.error(`release: invalid version or bump: ${positional[0]}`)
  process.exit(2)
}
if (capture('git', ['tag', '-l', `v${next}`]) !== '') {
  console.error(`release: tag v${next} already exists`)
  process.exit(1)
}
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
if (!new RegExp(`^## ${next.replaceAll('.', '\\.')} `, 'm').test(changelog)) {
  console.error(`release: CHANGELOG.md has no "## ${next} — <date>" section. Write release notes first.`)
  process.exit(1)
}

console.log(`release: ${manifest.version} -> ${next}`)
if (dryRun) {
  console.log('release: dry run, no files changed')
  process.exit(0)
}

// Bump first: the self-audit cross-checks package.json against CHANGELOG, and the
// changelog section for this version is written before the release is cut. A
// failed gate restores the old manifest and leaves no partial commit behind.
const previousManifest = readFileSync(packagePath, 'utf8')
manifest.version = next
writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
try {
  console.log('release: gating (tests, self-audit, smoke)')
  run('node', ['--test'])
  run('node', ['scripts/self-audit.mjs', '--strict'])
  run('node', ['scripts/smoke.mjs'])
} catch (error) {
  writeFileSync(packagePath, previousManifest, 'utf8')
  console.error('release: a gate failed; package.json restored, nothing committed')
  process.exit(1)
}
run('git', ['add', 'package.json', 'CHANGELOG.md'])
run('git', ['commit', '-m', `chore(release): v${next}`])
run('git', ['tag', '-a', `v${next}`, '-m', `v${next}`])
console.log(`release: committed and tagged v${next}`)
console.log('release: push with `git push origin master && git push origin v' + next + '`')
