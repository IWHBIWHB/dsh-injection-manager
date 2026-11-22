// Text measurement shared by the host tool, the routes and the panel.
//
// A real tokenizer is not available inside the harness, so every number this
// plugin reports is an estimate. The panel, the README and the tool card all say
// "estimate": these numbers are not billing data.
//
// The densities below were measured against the provider's own prompt-token
// figures on DSH 0.2.2-rc.5 (Desktop, Windows, `deepseek-flash`), using
// type-separated payloads and the session log's `inputTokens + cacheReadTokens`
// per step. Sources of the calibration: 9 observations, worst residual ±6.3%.
// Discussion with the measured table:
// https://github.com/deepseek-ai/deepseek-harness/discussions/13906#discussioncomment-19811615
//
//   class         tokens/char   chars/token   what it is
//   ascii_prose   0.176         5.7           letters, digits, whitespace, non-JSON punctuation
//   json_struct   0.977         1.02          { } [ ] " : ,   (JSON punctuation tokenizes ~1/char)
//   cjk           0.609         1.64          CJK ideographs, CJK punctuation, fullwidth, kana, hangul
//   other_unicode 1.0           ~1.0          emoji and symbols (only 22 chars measured: coarse)
//
// The earlier rule (ASCII ÷ 4 + everything else ÷ 1.6) got CJK right by luck
// (1.64 measured) but priced JSON punctuation at a quarter of its real cost and
// over-priced English prose by ~29%. Splitting the classes fixes both ends.

const JSON_STRUCT = new Set(['{', '}', '[', ']', '"', ':', ','])

const DENSITY = {
  asciiProse: 0.176,
  jsonStruct: 0.977,
  cjk: 0.609,
  other: 1.0,
}

/** CJK ideographs and punctuation, kana, hangul, fullwidth forms. */
export function isCjkCodePoint(code) {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

/**
 * Class-aware estimate. Returns the class histogram too, so callers can show
 * why a number is large instead of only how large it is.
 */
export function measureText(text) {
  const source = typeof text === 'string' ? text : ''
  let asciiProse = 0
  let jsonStruct = 0
  let cjk = 0
  let other = 0
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    if (code < 128) {
      if (JSON_STRUCT.has(source[index])) jsonStruct += 1
      else asciiProse += 1
    } else if (isCjkCodePoint(code)) cjk += 1
    else other += 1
  }
  const tokens = asciiProse * DENSITY.asciiProse + jsonStruct * DENSITY.jsonStruct
    + cjk * DENSITY.cjk + other * DENSITY.other
  return {
    chars: source.length,
    tokens: Math.round(tokens),
    classes: { asciiProse, jsonStruct, cjk, other },
  }
}

/** Backwards-compatible shape used across the plugin: chars + tokens only. */
export function countText(text) {
  const measured = measureText(text)
  return { chars: measured.chars, tokens: measured.tokens }
}

export const emptyMeasure = () => ({ chars: 0, tokens: 0 })

export function addMeasure(total, measure) {
  return { chars: total.chars + measure.chars, tokens: total.tokens + measure.tokens }
}

export function sumMeasures(list) {
  return list.reduce((total, entry) => addMeasure(total, entry), emptyMeasure())
}

export const groupDigits = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** 1234 → "1.2k", 1234567 → "1.2M". Used by the compact chat chip. */
export function formatTokens(value) {
  const number = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  if (number < 1000) return String(number)
  if (number < 1_000_000) {
    const scaled = number / 1000
    return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}k`
  }
  return `${Math.round((number / 1_000_000) * 10) / 10}M`
}

/** Percent with one decimal, clamped to 0..100. */
export function percent(part, whole) {
  if (!Number.isFinite(whole) || whole <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((part / whole) * 1000) / 10))
}
