// The token estimator is a measured density table (see docs/TOKENS.md). These
// tests pin the classes that make it different from a flat chars/4 rule, and
// guard the user-facing copy from drifting back to the old formula.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { countText, isCjkCodePoint, measureText } from '../lib/measure.js'

test('measure: ASCII prose runs near 5.7 chars per token, not 4', () => {
  const text = 'The assembler walks every registered section before the request leaves the process. '
  const measured = measureText(text)
  assert.equal(measured.classes.jsonStruct, 0)
  assert.ok(measured.tokens < Math.ceil(text.length / 4), `${measured.tokens} should be under chars/4`)
  const ratio = text.length / measured.tokens
  assert.ok(ratio > 4.5 && ratio < 7, `chars/token out of range: ${ratio}`)
})

test('measure: JSON punctuation is priced denser than prose', () => {
  const json = '{"name":"read","owner":"dsh-tool-fs","chars":42}'
  const measured = measureText(json)
  assert.ok(measured.classes.jsonStruct >= 10, `struct chars: ${measured.classes.jsonStruct}`)
  const flat = Math.ceil(json.length / 4)
  assert.ok(measured.tokens > flat, `${measured.tokens} should exceed chars/4 (${flat})`)
  const ratio = json.length / measured.tokens
  assert.ok(ratio > 1.5 && ratio < 3, `chars/token out of range: ${ratio}`)
})

test('measure: CJK stays near 1.6 chars per token', () => {
  const text = '上下文装配发生在每一次模型请求之前，宿主把段落、上下文、工具声明拼成一整包。'
  const measured = measureText(text)
  assert.equal(measured.classes.cjk, text.length)
  const ratio = text.length / measured.tokens
  assert.ok(ratio > 1.45 && ratio < 1.8, `chars/token out of range: ${ratio}`)
})

test('measure: classes are disjoint and count every character once', () => {
  const text = 'a{中😀 b}:,"中'
  const measured = measureText(text)
  const { asciiProse, jsonStruct, cjk, other } = measured.classes
  assert.equal(measured.chars, text.length)
  assert.equal(asciiProse + jsonStruct + cjk + other, text.length)
  assert.equal(jsonStruct, 5) // { } : , "
  assert.ok(cjk >= 2)
  assert.equal(other, 2) // one emoji = two UTF-16 code units
  assert.equal(measured.tokens, Math.round(asciiProse * 0.176 + jsonStruct * 0.977 + cjk * 0.609 + other))
})

test('measure: countText keeps the chars+tokens shape callers rely on', () => {
  const measured = measureText('{"a":1}')
  assert.deepEqual(countText('{"a":1}'), { chars: measured.chars, tokens: measured.tokens })
})

test('measure: the CJK ranges cover the classes we claim in the docs', () => {
  for (const ch of ['中', '。', '、', 'あ', 'ア', '한', '，', 'Ａ']) {
    assert.equal(isCjkCodePoint(ch.codePointAt(0)), true, ch)
  }
  for (const ch of ['a', '{', '😀', 'é']) {
    assert.equal(isCjkCodePoint(ch.codePointAt(0)), false, ch)
  }
})

test('copy: user-facing token notes no longer promise ASCII/4', () => {
  for (const file of ['README.md', 'README.zh.md']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.equal(/ASCII\s*÷\s*4/.test(text), false, `${file} still carries the old formula`)
  }
  const doc = readFileSync(new URL('../docs/TOKENS.md', import.meta.url), 'utf8')
  assert.match(doc, /0\.176/)
  assert.match(doc, /json_struct/)
  assert.match(doc, /discussions\/13906/)
})
