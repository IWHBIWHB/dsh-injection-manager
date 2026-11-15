// Host compatibility: version comparison and best-effort detection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compareVersions, hostInfo, resetHostInfoCache, TESTED_VERSION } from '../lib/hostinfo.js'

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
