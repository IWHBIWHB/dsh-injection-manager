// Per-request injection ledger.
//
// The authoritative moment to observe injection is the scoped
// `system-prompt/assemble` waterfall: it receives every resolved section and
// dynamic context with its exact text, after the host evaluated providers and
// before the loop renders and commits it as derived history. This module turns
// that observation into an append-only record: offered vs admitted items, tool
// schemas for the same assembly, token estimates, and a content-addressed text
// store so the panel can show the exact bytes later without keeping every copy
// in memory.
//
// Estimates only: countText() uses the same density heuristic as the rest of
// this plugin. `usage` from the provider is a different number (billing), and
// the ledger says so instead of pretending to be a tokenizer.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describeItem } from './catalog.js'
import { countText, sumMeasures } from './measure.js'

export const LEDGER_VERSION = 1
const TEXT_DIR = 'ledger-text'
const FILE_NAME = 'ledger.jsonl'
const DEFAULT_MAX_ENTRIES = 300
const DEFAULT_MAX_TEXT_BYTES = 512 * 1024
const PREVIEW_CHARS = 240
const ROTATE_BYTES = 8 * 1024 * 1024

let sequence = 0
let recordId = 0

function hashOf(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 20)
}

function previewOf(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat
}

function itemFrom(surface, name, text, extra = {}) {
  const raw = typeof text === 'string' ? text : ''
  const measure = countText(raw)
  const meta = describeItem(surface, name)
  return {
    surface,
    name: String(name ?? ''),
    chars: measure.chars,
    tokens: measure.tokens,
    hash: raw.length === 0 ? null : hashOf(`${surface}\u0000${name}\u0000${raw}`),
    preview: previewOf(raw),
    empty: raw.length === 0,
    ...meta,
    ...extra,
  }
}

/**
 * Create the ledger store for one plugin instance.
 * @param {{ directory?: string, maxEntries?: number, maxTextBytes?: number, onWarn?: (message: string) => void }} options
 */
export function createLedger(options = {}) {
  const directory = typeof options.directory === 'string' && options.directory.length > 0 ? options.directory : null
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(20, Math.round(options.maxEntries)) : DEFAULT_MAX_ENTRIES
  const maxTextBytes = Number.isFinite(options.maxTextBytes) ? Math.max(64 * 1024, Math.round(options.maxTextBytes)) : DEFAULT_MAX_TEXT_BYTES
  const onWarn = typeof options.onWarn === 'function' ? options.onWarn : () => {}

  /** @type {Array<Record<string, unknown>>} */
  const entries = []
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map()
  /** @type {Map<string, { text: string, bytes: number, truncated: boolean }>} */
  const texts = new Map()
  const textWrites = new Set()
  let storedTextBytes = 0
  let droppedTextBytes = 0
  let writeQueue = Promise.resolve()

  function putText(surface, name, text) {
    const raw = typeof text === 'string' ? text : ''
    if (raw.length === 0) return null
    const hash = hashOf(`${surface}\u0000${name}\u0000${raw}`)
    if (texts.has(hash)) return hash
    const bytes = Buffer.byteLength(raw, 'utf8')
    if (storedTextBytes + bytes > maxTextBytes) {
      droppedTextBytes += 1
      return null
    }
    texts.set(hash, { text: raw, bytes, truncated: false })
    storedTextBytes += bytes
    if (directory !== null) {
      const target = join(directory, TEXT_DIR, `${hash}.txt`)
      textWrites.add(hash)
      writeQueue = writeQueue
        .then(() => writeFile(target, raw, 'utf8'))
        .catch((error) => {
          textWrites.delete(hash)
          onWarn(`ledger text write failed: ${String(error && error.message || error)}`)
        })
    }
    return hash
  }

  function summarize(entry) {
    return {
      id: entry.id,
      seq: entry.seq,
      at: entry.at,
      session: entry.session,
      turn: entry.turn,
      step: entry.step,
      model: entry.model,
      totals: entry.totals,
      delta: entry.delta,
      counts: entry.counts,
      blocked: entry.blocked,
      messages: Array.isArray(entry.messages) ? entry.messages.length : 0,
      provider: entry.provider,
    }
  }

  async function loadExisting() {
    if (directory === null) return { loaded: 0 }
    let raw
    try {
      raw = await readFile(join(directory, FILE_NAME), 'utf8')
    } catch {
      return { loaded: 0 }
    }
    let loaded = 0
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.id !== 'string') continue
        // A record is appended twice: once at assembly, once finalised with the
        // step messages. Later lines win.
        const known = byId.get(parsed.id)
        if (known !== undefined) {
          const index = entries.indexOf(known)
          if (index >= 0) entries[index] = parsed
          byId.set(parsed.id, parsed)
          continue
        }
        byId.set(parsed.id, parsed)
        entries.push(parsed)
        loaded += 1
      } catch {
        /* a torn last line is expected after a crash; skip it */
      }
    }
    entries.sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0))
    while (entries.length > maxEntries) {
      const dropped = entries.shift()
      if (dropped !== undefined) byId.delete(dropped.id)
    }
    return { loaded }
  }

  function appendPersisted(entry) {
    if (directory === null) return
    writeQueue = writeQueue
      .then(async () => {
        try {
          const info = await stat(join(directory, FILE_NAME))
          if (info.size > ROTATE_BYTES) {
            await writeFile(join(directory, FILE_NAME), '', 'utf8')
          }
        } catch {
          /* missing file is fine */
        }
        await appendFile(join(directory, FILE_NAME), `${JSON.stringify(entry)}\n`, 'utf8')
      })
      .catch((error) => onWarn(`ledger append failed: ${String(error && error.message || error)}`))
  }

  function record(input) {
    const now = Date.now()
    sequence += 1
    recordId += 1
    const session = typeof input.session === 'string' && input.session.length > 0 ? input.session : '(unknown)'
    const previous = [...entries].reverse().find((entry) => entry.session === session)
    const offeredSections = (input.offered?.sections ?? []).map((section) => itemFrom('section', section.name, section.text, { order: section.order }))
    const admittedSections = (input.admitted?.sections ?? []).map((section) => {
      const item = itemFrom('section', section.name, section.text, { order: section.order })
      const hash = putText('section', section.name, section.text)
      return hash === null ? { ...item, textUnavailable: true } : { ...item, hash }
    })
    const blockedSections = offeredSections
      .filter((item) => !admittedSections.some((admitted) => admitted.name === item.name))
      .map((item) => ({ ...item, status: 'blocked' }))
    const contexts = (input.admitted?.contexts ?? []).map((context) => {
      const item = itemFrom('context', context.name, context.text, { order: context.order })
      const hash = putText('context', context.name, context.text)
      return hash === null ? { ...item, textUnavailable: true } : { ...item, hash }
    })
    const blockedContexts = (input.offered?.contexts ?? [])
      .filter((context) => !(input.admitted?.contexts ?? []).some((admitted) => admitted.name === context.name))
      .map((context) => ({ ...itemFrom('context', context.name, context.text), status: 'blocked' }))
    const tools = (input.tools ?? []).map((tool) => itemFrom('tool', tool.name, tool.description ?? '', { hasParameters: tool.hasParameters === true }))
    const variables = Object.entries(input.variables ?? {}).map(([name, value]) => ({ ...itemFrom('variable', name, typeof value === 'string' ? value : ''), hash: null, previewOnly: true }))
    // Message text is preview-only on purpose: conversation content stays out
    // of the plugin's on-disk ledger, and the preview is enough to identify the
    // surface. Items are marked so the UI does not offer a dead "exact text"
    // link.
    const messages = (input.messages ?? []).map((message) => {
      const meta = itemFrom('message', message.kind, message.text ?? '', {
        sourceKind: message.kind,
        form: message.form,
        step: message.step,
        turn: message.turn,
      })
      return { ...meta, hash: null, previewOnly: true }
    })
    const totals = sumMeasures([...admittedSections, ...contexts, ...tools])
    const bySurface = {
      sections: sumMeasures(admittedSections),
      contexts: sumMeasures(contexts),
      tools: sumMeasures(tools),
      messages: sumMeasures(messages),
    }
    const previousNames = new Set([...(previous?.sections ?? []), ...(previous?.contexts ?? []), ...(previous?.tools ?? [])].map((item) => item.name))
    const currentNames = new Set([...admittedSections, ...contexts, ...tools].map((item) => item.name))
    const delta = {
      added: [...currentNames].filter((name) => !previousNames.has(name)),
      removed: [...previousNames].filter((name) => !currentNames.has(name)),
      from: previous === undefined ? null : previous.id,
    }
    const entry = {
      version: LEDGER_VERSION,
      id: `inj-${now.toString(36)}-${recordId.toString(36)}`,
      seq: sequence,
      at: now,
      session,
      turn: Number.isFinite(input.turn) ? input.turn : null,
      step: Number.isFinite(input.step) ? input.step : null,
      model: input.model ?? null,
      provider: input.provider ?? null,
      totals: { ...totals, estimate: true },
      bySurface,
      counts: {
        sections: admittedSections.length,
        contexts: contexts.length,
        tools: tools.length,
        messages: messages.length,
        blockedSections: blockedSections.length,
        blockedContexts: blockedContexts.length,
      },
      delta,
      sections: admittedSections,
      contexts,
      tools,
      variables,
      messages,
      blocked: { sections: blockedSections, contexts: blockedContexts },
      rendersAs: input.rendersAs ?? 'system-message',
    }
    entries.push(entry)
    byId.set(entry.id, entry)
    while (entries.length > maxEntries) {
      const dropped = entries.shift()
      if (dropped !== undefined) byId.delete(dropped.id)
    }
    appendPersisted(entry)
    return summarize(entry)
  }

  /** Attach the step numbers and decided messages to a recorded assembly. */
  function finalize(id, patch = {}) {
    const entry = byId.get(String(id ?? ''))
    if (entry === undefined) return { ok: false, error: 'not_found' }
    if (Number.isFinite(patch.turn)) entry.turn = patch.turn
    if (Number.isFinite(patch.step)) entry.step = patch.step
    if (Array.isArray(patch.messages)) {
      entry.messages = patch.messages.map((message) => (message && typeof message === 'object' && typeof message.control === 'string'
        ? message
        : { ...itemFrom('message', message && message.kind, message && message.text === undefined ? '' : message.text), sourceKind: message && message.kind, chars: Number(message && message.chars) || 0, form: message && message.form, preview: message && message.preview, hash: null, previewOnly: true }))
      if (entry.counts !== undefined) entry.counts.messages = patch.messages.length
      if (entry.bySurface !== undefined) entry.bySurface.messages = sumMeasures(patch.messages.map((message) => ({ chars: Number(message.chars) || 0, tokens: Number(message.tokens) || 0 })))
    }
    if (patch.rejected === true) entry.rejected = true
    appendPersisted(entry)
    return summarize(entry)
  }
  function list(filter = {}) {
    const session = typeof filter.session === 'string' && filter.session.length > 0 ? filter.session : null
    const limit = Number.isFinite(filter.limit) ? Math.max(1, Math.min(200, Math.round(filter.limit))) : 20
    const pool = session === null ? entries : entries.filter((entry) => entry.session === session)
    const slice = pool.slice(-limit).reverse()
    return {
      ok: true,
      estimate: true,
      total: pool.length,
      entries: slice.map(summarize),
      latest: pool.length === 0 ? null : summarize(pool[pool.length - 1]),
    }
  }

  function get(id) {
    const entry = byId.get(String(id ?? ''))
    if (entry === undefined) return { ok: false, error: 'not_found' }
    return { ok: true, entry }
  }

  function text(hash) {
    const key = String(hash ?? '')
    const known = texts.get(key)
    if (known !== undefined) return { ok: true, hash: key, text: known.text, bytes: known.bytes }
    if (key.length === 0) return { ok: false, error: 'bad-hash' }
    // After a restart the memory cache is empty but the content-addressed file
    // is still on disk; the route awaits readStored() rather than pretending the
    // text never existed.
    return directory === null ? { ok: false, error: 'absent', hash: key } : { ok: false, error: 'read-store', hash: key }
  }

  async function readStored(hash) {
    const key = String(hash ?? '')
    if (!/^[a-f0-9]{20}$/.test(key)) return { ok: false, error: 'bad-hash' }
    try {
      const raw = await readFile(join(directory, TEXT_DIR, key + '.txt'), 'utf8')
      return { ok: true, hash: key, text: raw, bytes: Buffer.byteLength(raw, 'utf8') }
    } catch {
      return { ok: false, error: 'absent', hash: key }
    }
  }

  function stats() {
    return {
      entries: entries.length,
      sessions: new Set(entries.map((entry) => entry.session)).size,
      storedTexts: texts.size,
      storedTextBytes,
      droppedTexts: droppedTextBytes,
      maxEntries,
      maxTextBytes,
      directory,
    }
  }

  function clear() {
    entries.length = 0
    byId.clear()
    texts.clear()
    storedTextBytes = 0
  }

  return { record, finalize, list, get, text, readStored, stats, clear, loadExisting, flush: () => writeQueue, ready: () => loadExisting() }
}

// Re-export so a capture module does not need to import measure separately.
export { previewOf as ledgerPreview }
