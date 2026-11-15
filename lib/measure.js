// Text measurement shared by the host tool, the routes and the panel.
//
// A real tokenizer is not available inside the harness, so every number this
// plugin reports is an estimate with a fixed density heuristic. The panel and
// the README both say "estimate"; the tool card repeats it. Treating these
// numbers as billing data would be wrong.

/**
 * Mixed estimate: ASCII ÷ 4, everything else (CJK and other wide scripts) ÷ 1.6.
 * A pure "characters ÷ 2" rule overstates ASCII JSON schemas by almost 2×,
 * which is what made a first version of this plugin look wrong next to the
 * harness' own token meter.
 */
export function countText(text) {
  const source = typeof text === 'string' ? text : ''
  let ascii = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) < 128) ascii += 1
  }
  const wide = source.length - ascii
  return { chars: source.length, tokens: Math.round(ascii / 4 + wide / 1.6) }
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
