// Locale guardrail: every shipped language must have exactly the same key set
// as English, non-empty values, identical placeholders, and a real detail
// document. Adding a key to en.json without updating the others fails here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const codes = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

const readLocale = async (code) => JSON.parse(await readFile(join(root, 'locale', `${code}.json`), 'utf8'))

function paths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.keys(value).flatMap((key) => paths(value[key], prefix === '' ? key : `${prefix}.${key}`))
}

const placeholders = (text) => (String(text).match(/\{\w+\}/g) ?? []).sort()
const valueAt = (object, path) => path.split('.').reduce((current, key) => (current === null || current === undefined ? undefined : current[key]), object)

const english = await readLocale('en')
const englishPaths = paths(english).sort()

test('English is the reference and has a detail document', async () => {
  assert.ok(englishPaths.length > 80)
  const detail = join(root, english.meta.detail)
  assert.ok((await stat(detail)).isFile())
})

for (const code of codes.filter((entry) => entry !== 'en')) {
  test(`${code}: same key set, non-empty values, same placeholders`, async () => {
    const locale = await readLocale(code)
    assert.deepEqual(paths(locale).sort(), englishPaths)
    for (const path of englishPaths) {
      const mine = valueAt(locale, path)
      const reference = valueAt(english, path)
      assert.equal(typeof mine, 'string', `${code}.${path} must be a string`)
      assert.ok(mine.trim().length > 0, `${code}.${path} must not be empty`)
      assert.deepEqual(placeholders(mine), placeholders(reference), `${code}.${path} placeholders differ`)
    }
    const detail = join(root, locale.meta.detail)
    assert.ok((await stat(detail)).isFile(), `${code} detail document missing`)
  })
}
