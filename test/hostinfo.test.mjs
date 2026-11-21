// Host compatibility: version comparison and best-effort detection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compareVersions, findManifestNear, hostInfo, resetHostInfoCache, TESTED_VERSION } from '../lib/hostinfo.js'

test('version comparison handles rc suffixes and missing parts', () => {
  assert.equal(compareVersions('0.2.2-rc.3', '0.2.2'), 0)
  assert.equal(compareVersions('0.2.3', '0.2.2'), 1)
  assert.equal(compareVersions('0.2.1', '0.2.2'), -1)
  assert.equal(compareVersions('0.2', '0.2.0'), 0)
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1)
})

test('an install directory with a newer manifest is reported as supported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-'))
  await mkdir(join(root, 'dsh'), { recursive: true })
  await writeFile(join(root, 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.3.0' }))
  process.env.DSH_INSTALL_DIR = join(root, 'dsh')
  resetHostInfoCache()
  const info = hostInfo()
  assert.equal(info.version, '0.3.0')
  assert.equal(info.supported, true)
  assert.equal(info.tested, TESTED_VERSION)
  await rm(root, { recursive: true, force: true })
  delete process.env.DSH_INSTALL_DIR
  resetHostInfoCache()
})

test('findManifestNear walks up to the launcher package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-near-'))
  const pkg = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(join(pkg, 'lib'), { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' }))
  const entry = join(pkg, 'lib', 'bin.js')
  await writeFile(entry, '')
  const found = findManifestNear(entry)
  assert.equal(found.version, '0.2.1-rc.5')
  assert.equal(found.source, pkg)
  await rm(root, { recursive: true, force: true })
})

test('a launcher path identifies an old host without DSH_INSTALL_DIR', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-argv-'))
  const pkg = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(join(pkg, 'lib'), { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.1' }))
  const entry = join(pkg, 'lib', 'bin.js')
  await writeFile(entry, '')
  const originalArgv = process.argv[1]
  delete process.env.DSH_INSTALL_DIR
  process.env.DSH_PROFILE_DIR = join(tmpdir(), 'no-profile-' + Date.now())
  process.argv[1] = entry
  resetHostInfoCache()
  const info = hostInfo()
  assert.equal(info.version, '0.2.0-rc.1')
  assert.equal(info.supported, false, '0.2.0 is below the 0.2.2 full-feature target')
  process.argv[1] = originalArgv
  delete process.env.DSH_PROFILE_DIR
  resetHostInfoCache()
  await rm(root, { recursive: true, force: true })
})

test('an unknown host is reported as unknown, not guessed', async () => {
  process.env.DSH_INSTALL_DIR = join(tmpdir(), 'does-not-exist-' + Date.now())
  process.env.DSH_PROFILE_DIR = join(tmpdir(), 'also-not-exist-' + Date.now())
  resetHostInfoCache()
  const info = hostInfo()
  assert.equal(info.version, null)
  assert.equal(info.supported, null)
  delete process.env.DSH_INSTALL_DIR
  delete process.env.DSH_PROFILE_DIR
  resetHostInfoCache()
})
