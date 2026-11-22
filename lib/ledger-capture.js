// Capture layer between the host's request assembly and the ledger store.
//
// Two host facts drive the shape of this file (both from 0.2.2-rc.5 source):
//   - the prompt assembly for a step happens *before* `agent/pre-step`
//     (dsh-agent-loop/src/agent.ts:300 then :302), so the message-level
//     injections of that step are only known afterwards: the record is written
//     when the assembly is observed and finalised when pre-step reports the
//     decided messages;
//   - plugin-built snapshots call `systemPrompt.assemble({ scope })` without an
//     `agent` field (dsh-agent-loop gives real steps an agent), so the capture
//     ignores assemblies that have no agent and the panel's own reads never
//     pollute the ledger.
//
// The listener runs as a waterfall *first* and records after `next()`: the
// returned assembly is what other listeners (this plugin's own policy filter)
// admitted, so `offered` vs `admitted` is a real before/after, not a guess.
import { createLedger } from './ledger.js'
import { resolveDshHome } from './policy.js'

const DEFAULT_LIMIT = 300
const MAX_PREVIEW = 240

let ledger = null
let enabled = true
let enabledPredicate = null
let pendingFinalize = new Map()
let onWarn = () => {}
let warnCount = 0

function warn(message) {
  warnCount += 1
  if (warnCount <= 20) onWarn(message)
}

/** Create/replace the ledger store. Called once on plugin load and by tests. */
export function configureLedger(options = {}) {
  enabled = options.enabled !== false
  enabledPredicate = typeof options.enabled === 'function' ? options.enabled : null
  const directory = options.directory === undefined ? `${resolveDshHome()}/injection-manager` : options.directory
  ledger = createLedger({
    directory: directory === null ? null : directory,
    maxEntries: options.maxEntries ?? DEFAULT_LIMIT,
    maxTextBytes: options.maxTextBytes,
    onWarn: warn,
  })
  onWarn = typeof options.onWarn === 'function' ? options.onWarn : () => {}
  pendingFinalize = new Map()
  void ledger.ready().catch((error) => warn(`ledger load failed: ${String(error && error.message || error)}`))
  return ledger
}

export function ledgerStore() {
  return ledger
}

export function setLedgerEnabled(value) {
  enabled = value !== false
  enabledPredicate = null
}

function liveEnabled() {
  if (enabledPredicate !== null) {
    try {
      return enabledPredicate() !== false
    } catch {
      return true
    }
  }
  return enabled
}

export function ledgerEnabled() {
  return liveEnabled() && ledger !== null
}

function textOfMessage(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const parts = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'file') parts.push(`[file ${block.name ?? ''}]`)
  }
  return parts.join('\n')
}

/** Summarise one message for the ledger (preview only; content stays out of disk). */
export function messageMeta(message, extra = {}) {
  const source = message?.source ?? {}
  const text = textOfMessage(message)
  const flat = text.replace(/\s+/g, ' ').trim()
  return {
    kind: typeof source.kind === 'string' ? source.kind : 'unknown',
    form: typeof source.form === 'string' ? source.form : undefined,
    chars: text.length,
    preview: flat.length > MAX_PREVIEW ? `${flat.slice(0, MAX_PREVIEW)}…` : flat,
    text: flat.slice(0, 600),
    ...extra,
  }
}

function toolsFor(ctx, context) {
  if (ctx === undefined || ctx === null || typeof ctx.tools?.schemas !== 'function') return []
  try {
    const schemas = ctx.tools.schemas(context?.agent, context?.toolSet)
    if (!Array.isArray(schemas)) return []
    return schemas.map((schema) => {
      const description = typeof schema?.description === 'string' ? schema.description : ''
      let measureText = description
      if (schema?.parameters !== undefined) {
        try {
          measureText = `${String(schema?.name ?? '')}\n${description}\n${JSON.stringify(schema.parameters)}`
        } catch {
          measureText = description
        }
      }
      return {
        name: String(schema?.name ?? ''),
        description,
        hasParameters: schema?.parameters !== undefined,
        measureText,
      }
    })
  } catch (error) {
    warn(`tool schema capture failed: ${String(error && error.message || error)}`)
    return []
  }
}

/**
 * Waterfall listener body. Registered globally so every agent's assembly is
 * observed; assemblies without an `agent` (panel snapshots, diagnostics) are
 * ignored on purpose.
 */
export async function captureAssembly(ctx, assembly, context, next) {
  const proceed = typeof next === 'function' ? next : context
  const admitted = typeof proceed === 'function' ? await proceed() : assembly
  if (!ledgerEnabled()) return admitted
  const assembleContext = typeof next === 'function' ? context : undefined
  const agent = assembleContext?.agent
  if (agent === undefined || agent === null) return admitted
  try {
    const session = typeof agent.id === 'string' && agent.id.length > 0 ? agent.id : '(unknown)'
    const modelSelection = assembleContext?.modelSelection
    const summary = ledger.record({
      session,
      turn: undefined,
      step: undefined,
      model: typeof modelSelection?.model === 'string' ? modelSelection.model : undefined,
      provider: typeof modelSelection?.provider === 'string' ? modelSelection.provider : undefined,
      offered: {
        sections: assembly?.sections,
        contexts: assembly?.contexts,
        variables: assembly?.variables,
      },
      admitted: {
        sections: admitted?.sections,
        contexts: admitted?.contexts,
        variables: admitted?.variables,
      },
      messages: [],
      tools: toolsFor(ctx, assembleContext),
      rendersAs: 'system-message+runtime-context',
    })
    pendingFinalize.set(session, summary.id)
  } catch (error) {
    warn(`ledger capture failed: ${String(error && error.message || error)}`)
  }
  return admitted
}

/**
 * Called from the global `agent/pre-step` listener (after `next()`): attaches
 * the step's turn/step numbers and decided messages to the newest open record of
 * that agent.
 */
export function finalizePreStep(agent, payload, decision) {
  if (!ledgerEnabled()) return
  const session = typeof agent?.id === 'string' ? agent.id : undefined
  if (session === undefined) return
  const id = pendingFinalize.get(session)
  if (id === undefined) return
  pendingFinalize.delete(session)
  try {
    const rejected = decision?.kind === 'reject'
    const messages = Array.isArray(decision?.messages) ? decision.messages.map((message) => messageMeta(message, {
      turn: Number(payload?.turn),
      step: Number(payload?.step),
    })) : []
    ledger.finalize(id, {
      turn: Number.isFinite(payload?.turn) ? payload.turn : null,
      step: Number.isFinite(payload?.step) ? payload.step : null,
      messages,
      rejected,
    })
  } catch (error) {
    warn(`ledger finalize failed: ${String(error && error.message || error)}`)
  }
}

export function ledgerStats() {
  if (ledger === null) return { entries: 0, sessions: 0, enabled: false }
  return { ...ledger.stats(), enabled: liveEnabled() }
}

export function ledgerEntries(filter) {
  return ledger === null ? { ok: false, error: 'not-ready', entries: [], total: 0 } : ledger.list(filter)
}

export function ledgerEntry(id) {
  return ledger === null ? { ok: false, error: 'not-ready' } : ledger.get(id)
}

export async function ledgerText(hash) {
  if (ledger === null) return { ok: false, error: 'not-ready' }
  const memory = ledger.text(hash)
  if (memory.ok) return memory
  if (memory.error === 'read-store') return ledger.readStored(memory.hash)
  return memory
}

export function ledgerClear() {
  if (ledger !== null) ledger.clear()
  pendingFinalize = new Map()
}
