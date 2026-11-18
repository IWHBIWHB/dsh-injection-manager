// HTTP surface for the browser panel.
//
// Reads are GET; every mutation is a POST /action with a JSON body. The panel
// never sends a whole policy object back, so two open panels cannot overwrite
// each other's switches: each action names one item and the server mutates the
// stored policy under that name.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPolicyForAgent, rewriteStats, savePolicy } from './apply.js'
import { collectContent } from './content.js'
import { buildHealth } from './health.js'
import { pushUndo, undoState } from './history.js'
import { withPolicyLock } from './lock.js'
import { restorePolicyAt, undoLastPolicy } from './actions.js'
import { hostInfo } from './hostinfo.js'
import { CHANNELS, defaultPolicy, isExcluded, normalizePolicy, policyFilePath, readPolicy } from './policy.js'
import { PRESET_NAMES, presetPolicy } from './presets.js'
import {
  buildSnapshot,
  estimateItemTokens,
  appliedAgents,
  lastApplicationState,
} from './snapshot.js'
import { getSettings } from './settings.js'
import { backfillState, readStats, requestBackfill } from './stats.js'
import { readEvents } from './events.js'
import { readTrend, TREND_RANGES, TREND_LIMIT } from './trend.js'
import { renderCard, renderText } from './text.js'

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
export const ROUTE_PREFIX = '/plugins/dsh-injection-manager'
// Bumped when the HTTP contract gains fields the panel can feature-detect.
export const API_VERSION = 2

export const ROUTES = {
  ping: `${ROUTE_PREFIX}/ping`,
  summary: `${ROUTE_PREFIX}/summary`,
  locale: `${ROUTE_PREFIX}/locale`,
  policy: `${ROUTE_PREFIX}/policy`,
  action: `${ROUTE_PREFIX}/action`,
  export: `${ROUTE_PREFIX}/export`,
  diag: `${ROUTE_PREFIX}/diag`,
  verify: `${ROUTE_PREFIX}/verify`,
  registrations: `${ROUTE_PREFIX}/registrations`,
  boot: `${ROUTE_PREFIX}/boot`,
  stats: `${ROUTE_PREFIX}/stats`,
  content: `${ROUTE_PREFIX}/content`,
  trend: `${ROUTE_PREFIX}/trend`,
  events: `${ROUTE_PREFIX}/events`,
  health: `${ROUTE_PREFIX}/health`,
}

// In-memory diagnostics written by the browser half. Never persisted.
let clientBoot = null
let clientRegistrations = null

function harden(res) {
  // These endpoints are local-only JSON; keeping sniffing and framing off
  // costs nothing and removes two classes of browser-side surprises.
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
}

// ---------------------------------------------------------------- trust fence

/**
 * Resolve the host's `connection` service without making it a hard dependency.
 * DSH 0.2.2+ exposes `ctx.connection`; older hosts do not, and the plugin must
 * keep working there. `ctx.get()` is the public service accessor; the property
 * read covers contexts where the service is exposed directly.
 */
export function connectionOf(ctx) {
  try {
    const viaGet = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
    if (viaGet !== undefined && viaGet !== null) return viaGet
  } catch {
    /* fall through to the property read */
  }
  try {
    return Reflect.get(ctx, 'connection')
  } catch {
    return undefined
  }
}

/**
 * Apply the host's Host/Origin (and browser-auth) fence to one registered
 * route. Returns true when the request was answered with a 401/403 and the
 * handler must not run; false when the caller may proceed.
 *
 * A missing service, a missing method and thrown errors all mean "proceed": a
 * security fence must never turn the panel into a blank page on an older host
 * or during early boot. The rejection is answered by the fence itself, before
 * any route logic runs, so no JSON, file or policy data can leak.
 */
export function fenceRequest(ctx, req, res) {
  let rejection
  try {
    const connection = connectionOf(ctx)
    if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') return false
    rejection = connection.requestRejection(req)
  } catch {
    return false
  }
  if (rejection !== 401 && rejection !== 403) return false
  try {
    res.statusCode = rejection
    // A rejected request carries no data and must not be cached or sniffed.
    res.setHeader('cache-control', 'no-store')
    harden(res)
    res.end()
  } catch {
    /* the socket may already be gone; the request was still rejected */
  }
  return true
}

/** Wrap one route handler with the trust fence at registration time. */
export function makeFencedHandler(ctx, handler) {
  return async function fenced(req, res) {
    if (fenceRequest(ctx, req, res) === true) return undefined
    return handler(req, res)
  }
}

function respondJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(body.length))
  harden(res)
  res.end(body)
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Mutations are same-origin JSON only. `sec-fetch-site` is the cheap browser
 * signal; the content-type requirement makes a cross-site form post impossible
 * without a preflight the harness never grants.
 */
function allowsWrite(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  // Defence in depth: a browser sends Origin on POST. When it is present it
  // must match the host that served this page.
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      if (new URL(origin).host !== req.headers.host) return false
    } catch {
      return false
    }
  }
  const type = req.headers['content-type'] ?? ''
  return type.includes('application/json')
}

function pickAgent(ctx, sessionId) {
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    try {
      const found = ctx.agents.get(sessionId)
      if (found !== undefined) return { agent: found, source: 'session' }
    } catch {
      /* fall through */
    }
  }
  try {
    const initiator = ctx.agents.currentInitiator()
    if (initiator !== undefined) return { agent: initiator, source: 'initiator' }
  } catch {
    /* no initiator boundary */
  }
  return { agent: undefined, source: 'none' }
}

function pickLastLive(ctx) {
  try {
    const live = ctx.agents.list()
    if (live.length > 0) return live[live.length - 1]
  } catch {
    /* ignore */
  }
  return undefined
}

// Shipped UI languages. The panel picks one from the browser; the host locale
// service gets all of them so switching the application language also works.
export const LOCALE_CODES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

async function readClientLocale(requested) {
  const read = async (code) => {
    try {
      const raw = await readFile(join(PACKAGE_DIR, 'locale', `${code}.json`), 'utf8')
      const parsed = JSON.parse(raw)
      const client = parsed?.client
      return client !== null && typeof client === 'object' ? client : {}
    } catch {
      return {}
    }
  }
  // `/summary` is polled every few seconds by up to three panels; shipping all
  // eight dictionaries with every response made two thirds of the payload
  // translation bytes nobody renders. A caller that names its language gets that
  // dictionary plus the English fallback; `/locale` still asks for no language
  // and receives every dictionary for host-level registration.
  const codes = LOCALE_CODES.includes(requested) ? [...new Set([requested, 'en'])] : LOCALE_CODES
  const out = {}
  for (const code of codes) out[code] = await read(code)
  return out
}

// ---------------------------------------------------------------- actions

function toggleItem(policy, channel, name, enabled) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`)
  const current = policy[channel]
  const names = new Set(current.mode === 'only' ? current.names : [])
  const except = new Set(current.mode === 'except' ? current.names : [])

  if (enabled) {
    names.delete(name)
    except.delete(name)
    if (current.mode === 'only') current.names = [...names]
    else if (current.mode === 'except') current.names = [...except]
    return
  }

  // Disabling one item: express it as an exclusion. `only` lists keep their
  // meaning (everything else is already off), so the name is added to `except`
  // only when the channel is open.
  if (current.mode === 'only') {
    current.names = current.names.filter((entry) => entry !== name)
    return
  }
  if (current.mode === 'all') {
    current.mode = 'except'
    current.names = []
  }
  if (!current.names.includes(name)) current.names.push(name)
}

function sessionIdOf(agent) {
  return typeof agent?.id === 'string' && agent.id.length > 0 ? agent.id : undefined
}

/**
 * Name count and token size for a set of switched items. Sizes come from the
 * inventory cache a previous snapshot measured; a name this process never saw
 * still counts but contributes 0 tokens instead of a guessed number.
 */
function switchNumbers(channel, names) {
  const estimate = estimateItemTokens(channel, names)
  return { count: names.length, tokens: estimate.tokens, known: estimate.known }
}

async function applyAction(ctx, agent, action) {
  const sessionId = sessionIdOf(agent)
  const state = await readPolicy()
  const policy = normalizePolicy(state.policy)

  if (action?.kind === 'undo') {
    return { policy: await undoLastPolicy({ sessionId, params: { via: 'panel' } }), changed: true }
  }

  if (action?.kind === 'restore') {
    return { policy: await restorePolicyAt(Number(action.index), { sessionId, params: { via: 'panel' } }), changed: true }
  }

  // Everything below is a mutation; remember the pre-write policy so the panel
  // can offer one-click undo for a whole-suite switch.
  const before = JSON.parse(JSON.stringify(policy))
  const undoLabel = typeof action.label === 'string' && action.label.trim().length > 0 ? action.label : describeAction(action)
  // The event row for the insights feed. Every mutation below overwrites the
  // kind/params it can describe; savePolicy records it in the same atomic step.
  const event = { kind: 'policy-saved', params: {}, tokensDelta: 0 }

  switch (action?.kind) {
    case 'item': {
      const channel = String(action.channel ?? '')
      const name = String(action.name ?? '')
      const enabled = action.enabled === true
      toggleItem(policy, channel, name, enabled)
      const numbers = switchNumbers(channel, [name])
      event.kind = 'switch'
      event.params = { channel, name, op: enabled ? 'on' : 'off', count: 1, tokens: numbers.tokens }
      event.tokensDelta = enabled ? numbers.tokens : -numbers.tokens
      policy.preset = 'custom'
      break
    }
    case 'names': {
      // Restoring a whole suite that is no longer in the assembled prompt:
      // "item" toggling cannot work because those names are absent upstream.
      const channel = String(action.channel ?? '')
      if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`)
      const names = Array.isArray(action.names) ? action.names.map((name) => String(name)) : []
      if (names.length === 0) break
      const rule = policy[channel]
      if (rule === undefined) throw new Error(`unknown channel: ${channel}`)
      const wanted = new Set(names)
      if (action.enabled === false) {
        rule.names = rule.mode === 'except' ? [...new Set(rule.names.concat(names))] : rule.names.filter((name) => !wanted.has(name))
      } else {
        rule.names = rule.mode === 'except' ? rule.names.filter((name) => !wanted.has(name)) : [...new Set(rule.names.concat(names))]
      }
      if (rule.mode === 'except' && rule.names.length === 0) rule.mode = 'all'
      const numbers = switchNumbers(channel, names)
      event.kind = 'switch'
      event.params = { channel, op: action.enabled === false ? 'off' : 'on', count: numbers.count, tokens: numbers.tokens, suite: true }
      event.tokensDelta = action.enabled === false ? -numbers.tokens : numbers.tokens
      policy.preset = 'custom'
      break
    }
    case 'channel': {
      if (!CHANNELS.includes(action.channel)) throw new Error(`unknown channel: ${action.channel}`)
      policy[action.channel] = action.enabled === true ? { mode: 'all', names: [] } : { mode: 'only', names: [] }
      event.kind = 'switch'
      event.params = { channel: String(action.channel), op: action.enabled === true ? 'on' : 'off', scope: 'channel' }
      policy.preset = 'custom'
      break
    }
    case 'preset': {
      const name = String(action.name ?? '')
      if (!PRESET_NAMES.includes(name)) throw new Error(`unknown preset: ${name}`)
      const snapshot = await buildSnapshot(ctx, agent, 'action', undefined)
      const names = {
        sections: snapshot.items.filter((item) => item.channel === 'sections').map((item) => item.name),
        contexts: snapshot.items.filter((item) => item.channel === 'contexts').map((item) => item.name),
        skills: snapshot.items.filter((item) => item.channel === 'skills').map((item) => item.name),
        tools: snapshot.items.filter((item) => item.channel === 'tools').map((item) => item.name),
      }
      const next = presetPolicy(name, names)
      // Persona text survives a preset change: it is user-authored content.
      next.prompt = policy.prompt
      Object.assign(policy, next)
      event.kind = 'preset'
      event.params = { name, via: 'panel' }
      break
    }
    case 'group': {
      const channel = String(action.channel ?? '')
      const group = String(action.group ?? '')
      if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`)
      const snapshot = await buildSnapshot(ctx, agent, 'action', undefined)
      const rows = snapshot.items.filter((item) => item.channel === channel && item.group === group && !item.locked)
      const names = rows.map((item) => item.name)
      for (const name of names) toggleItem(policy, channel, name, action.enabled === true)
      const tokens = rows.reduce((sum, item) => sum + item.tokens, 0)
      event.kind = 'switch'
      event.params = {
        channel,
        group: rows[0]?.groupLabel ?? group,
        groupId: group,
        op: action.enabled === true ? 'on' : 'off',
        count: names.length,
        tokens,
      }
      event.tokensDelta = action.enabled === true ? tokens : -tokens
      policy.preset = 'custom'
      break
    }
    case 'groups': {
      // A suite can span channels (REA's MCP tools plus its prompt section), so
      // one switch has to address several group ids at once.
      const list = Array.isArray(action.groups) ? action.groups : []
      const snapshot = await buildSnapshot(ctx, agent, 'action', undefined)
      const labels = []
      let count = 0
      let tokens = 0
      for (const entry of list) {
        const channel = String(entry.channel ?? '')
        const group = String(entry.group ?? '')
        if (!CHANNELS.includes(channel)) continue
        const rows = snapshot.items.filter((item) => item.channel === channel && item.group === group && !item.locked)
        const names = rows.map((item) => item.name)
        for (const name of names) toggleItem(policy, channel, name, action.enabled === true)
        count += names.length
        tokens += rows.reduce((sum, item) => sum + item.tokens, 0)
        if (rows[0]?.groupLabel !== undefined && !labels.includes(rows[0].groupLabel)) labels.push(rows[0].groupLabel)
      }
      event.kind = 'switch'
      event.params = {
        op: action.enabled === true ? 'on' : 'off',
        count,
        tokens,
        groups: labels,
      }
      event.tokensDelta = action.enabled === true ? tokens : -tokens
      policy.preset = 'custom'
      break
    }
    case 'import': {
      // Accept either a bare policy object or a whole exported manifest (the
      // file the panel downloads), so an export can be pasted back directly.
      const source = action.policy ?? action.data
      const candidate =
        source !== null && typeof source === 'object' && !Array.isArray(source) && typeof source.policy === 'object' ? source.policy : source
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('invalid-policy: expected a policy object')
      }
      Object.assign(policy, normalizePolicy(candidate))
      event.kind = 'import'
      event.params = { via: 'panel', format: source !== candidate ? 'manifest' : 'policy' }
      break
    }
    case 'prompt': {
      if (typeof action.prefix === 'string') policy.prompt.prefix = action.prefix
      if (typeof action.suffix === 'string') policy.prompt.suffix = action.suffix
      event.kind = 'policy-saved'
      event.params = {
        via: 'panel',
        prompt: true,
        prefixChars: policy.prompt.prefix.length,
        suffixChars: policy.prompt.suffix.length,
      }
      policy.preset = 'custom'
      break
    }
    case 'reset': {
      const fresh = defaultPolicy()
      fresh.prompt = policy.prompt
      Object.assign(policy, fresh)
      event.kind = 'policy-saved'
      event.params = { via: 'panel', reset: true, preset: 'all' }
      break
    }
    default:
      throw new Error(`unknown action kind: ${action?.kind}`)
  }

  // A replay that changes nothing — a double click, or the health strip asking
  // to close a suite that is already off — must not append another undo step, a
  // durable event, or a policy revision. The undo list is the user's history, so
  // a silent no-op is the only honest answer.
  if (JSON.stringify(policy) === JSON.stringify(before)) {
    return { policy, changed: false }
  }

  await savePolicy(policy, { sessionId, ...event })
  pushUndo(before, undoLabel)
  return { policy, changed: true }
}

function describeAction(action) {
  const kind = action && action.kind
  switch (kind) {
    case 'group':
      return `group ${action.group} ${action.enabled ? 'on' : 'off'}`
    case 'groups':
      return `groups ${(action.groups || []).length} ${action.enabled ? 'on' : 'off'}`
    case 'item':
      return `${action.enabled ? 'on' : 'off'} ${action.name}`
    case 'names':
      return `${action.enabled === false ? 'off' : 'on'} ${(action.names || []).length} names`
    case 'channel':
      return `channel ${action.channel} ${action.enabled ? 'on' : 'off'}`
    case 'preset':
      return `preset ${action.name}`
    case 'import':
      return 'import policy'
    case 'prompt':
      return 'custom prompt'
    default:
      return String(kind)
  }
}

// ---------------------------------------------------------------- handlers

export function createRoutes(ctx) {
  const summary = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.summary, 'http://localhost')
      const sessionId = url.searchParams.get('session') ?? undefined
      const language = url.searchParams.get('lang') ?? undefined
      const picked = pickAgent(ctx, sessionId)
      let agent = picked.agent
      let scopeSource = `route.${picked.source}`
      if (agent === undefined) {
        agent = pickLastLive(ctx)
        scopeSource = agent === undefined ? 'route.none' : 'route.last-live'
      }
      const snapshot = await buildSnapshot(ctx, agent, scopeSource, undefined)
      const health = buildHealth(snapshot)
      const payload = {
        ...snapshot,
        ok: true,
        apiVersion: API_VERSION,
        // Counts only: the full check list has its own route, and a summary
        // refresh should stay small.
        healthSummary: { high: health.summary.high, warn: health.summary.warn, info: health.summary.info },
        text: renderText(snapshot),
        card: renderCard(snapshot),
        presets: PRESET_NAMES,
        settings: getSettings(),
        locale: await readClientLocale(language),
      }
      respondJson(res, 200, JSON.parse(JSON.stringify(payload)))
    } catch (error) {
      respondJson(res, 500, { error: 'internal', message: String(error?.message ?? error) })
    }
  }

  const policy = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const state = await readPolicy()
      respondJson(res, 200, {
        policy: state.policy,
        path: state.path,
        exists: state.exists === true,
        legacy: state.legacy === true,
        error: state.error ?? null,
        lastApplication: lastApplicationState,
        presets: PRESET_NAMES,
      })
    } catch (error) {
      respondJson(res, 500, { error: 'internal', message: String(error?.message ?? error) })
    }
  }

  const locale = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    respondJson(res, 200, await readClientLocale())
  }

  const action = async (req, res) => {
    try {
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      if (!allowsWrite(req)) {
        respondJson(res, 403, { error: 'cross-site-write-rejected' })
        return
      }
      const raw = await readBody(req, 1_048_576)
      let parsed
      try {
        parsed = JSON.parse(raw === '' ? '{}' : raw)
      } catch (error) {
        respondJson(res, 400, { error: 'invalid-json', message: String(error?.message ?? error) })
        return
      }
      // A policy change describes the registry the panel is showing: the named
      // session when the panel sent one, otherwise the most recently active
      // agent (the same scope /summary falls back to).
      const picked =
        typeof parsed?.session === 'string' && parsed.session.length > 0
          ? pickAgent(ctx, parsed.session)
          : { agent: pickLastLive(ctx) }
      // Read-modify-write under one process-wide queue: two panels flipping two
      // suites used to interleave and the later save dropped the earlier switch.
      // The read that feeds the response happens inside the same turn so the
      // panel always gets the state its own action produced.
      const { result, state } = await withPolicyLock(async () => ({
        result: await applyAction(ctx, picked.agent, parsed),
        state: await readPolicy(),
      }))
      respondJson(res, 200, {
        ok: true,
        // `changed: false` means the policy already matched the request; the
        // panel uses it to stay silent instead of claiming a switch happened.
        changed: result.changed !== false,
        policy: state.policy,
        path: state.path,
        undo: undoState(),
      })
    } catch (error) {
      respondJson(res, 500, { error: 'action-failed', message: String(error?.message ?? error) })
    }
  }

  const ping = (req, res) => {
    respondJson(res, 200, {
      ok: true,
      plugin: 'dsh-injection-manager',
      routes: Object.values(ROUTES),
      policyPath: policyFilePath(),
      at: Date.now(),
    })
  }

  const diag = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    const payload = {
      id: 'dsh-injection-manager',
      at: Date.now(),
      packageDir: PACKAGE_DIR,
      policyPath: policyFilePath(),
      appliedAgents: countApplied(),
      host: hostInfo(),
      lastApplication: lastApplicationState,
      rewrite: rewriteStats(),
      clientBoot,
      clientRegistrations,
      clientModule: null,
      error: null,
    }
    // Temporary introspection for grouping design: what identity fields do the
    // registry entries actually carry in this build?
    try {
      const sample = ctx.tools.schemas()[0]
      payload.sampleToolKeys = sample === undefined ? null : Object.keys(sample)
    } catch {
      payload.sampleToolKeys = null
    }
    try {
      const snapshot = await ctx.skills.snapshot({})
      const skill = snapshot?.skills?.[0]
      payload.sampleSkillKeys = skill === undefined ? null : Object.keys(skill)
    } catch {
      payload.sampleSkillKeys = null
    }
    try {
      const clientModules = ctx.get('clientModules')
      if (clientModules !== null && clientModules !== undefined) {
        const graph = clientModules.graph()
        const entry = Array.isArray(graph?.entries)
          ? graph.entries.find((row) => row?.id === 'dsh-injection-manager')
          : undefined
        payload.clientModule = entry === undefined ? null : { url: entry.url, rev: entry.rev }
      }
    } catch (error) {
      payload.error = String(error?.message ?? error)
    }
    respondJson(res, 200, payload)
  }

  /**
   * Effective assembly for one live agent. `assemble()` runs the scoped
   * waterfall, so this is the proof that a saved policy actually reached a
   * session instead of only changing the policy file.
   */
  const verify = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.verify, 'http://localhost')
      const sessionId = url.searchParams.get('session') ?? ''
      let agent
      try {
        agent = sessionId.length > 0 ? ctx.agents.get(sessionId) : undefined
      } catch {
        agent = undefined
      }
      if (agent === undefined || agent === null) {
        respondJson(res, 404, { error: 'agent-not-live', session: sessionId })
        return
      }
      const assembly = await ctx.systemPrompt.assemble({ scope: agent })
      const tools = ctx.tools.schemas(agent).map((schema) => String(schema.name ?? ''))
      respondJson(res, 200, {
        session: sessionId,
        sections: (assembly.sections ?? []).map((section) => String(section.name ?? '')),
        contexts: (assembly.contexts ?? []).map((context) => String(context.name ?? '')),
        tools,
        applied: appliedAgents.has(agent),
      })
    } catch (error) {
      respondJson(res, 500, { error: 'verify-failed', message: String(error?.message ?? error) })
    }
  }

  /**
   * Download the manifest: Markdown for a ticket or a chat message, JSON for a
   * diff between two machines. Same snapshot as the panel, so an exported file
   * can be compared with what the panel shows.
   */
  const exportRoute = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.export, 'http://localhost')
      const format = (url.searchParams.get('format') ?? 'md').toLowerCase()
      const picked = pickAgent(ctx, url.searchParams.get('session') ?? undefined)
      let agent = picked.agent
      if (agent === undefined) agent = pickLastLive(ctx)
      const snapshot = await buildSnapshot(ctx, agent, 'export', undefined)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const json = format === 'json'
      const body = Buffer.from(
        json
          ? JSON.stringify({ ...snapshot, text: renderText(snapshot), card: renderCard(snapshot) }, null, 2)
          : `${renderText(snapshot)}\n\n${renderCard(snapshot)}\n`,
        'utf8',
      )
      res.statusCode = 200
      res.setHeader('content-type', json ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8')
      res.setHeader('content-disposition', `attachment; filename="injection-manifest-${stamp}.${json ? 'json' : 'md'}"`)
      res.setHeader('cache-control', 'no-store')
      res.setHeader('content-length', String(body.length))
      harden(res)
      res.end(body)
    } catch (error) {
      respondJson(res, 500, { error: 'export-failed', message: String(error?.message ?? error) })
    }
  }

  const report = (slot) => async (req, res) => {    try {
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      if (!allowsWrite(req)) {
        respondJson(res, 403, { error: 'cross-site-write-rejected' })
        return
      }
      const parsed = JSON.parse((await readBody(req)) || '{}')
      if (slot === 'boot') {
        clientBoot = {
          at: Date.now(),
          firstAt: clientBoot?.firstAt ?? Date.now(),
          count: (clientBoot?.count ?? 0) + 1,
          stage: typeof parsed?.stage === 'string' ? parsed.stage : null,
          error: typeof parsed?.error === 'string' ? parsed.error : null,
        }
      } else {
        clientRegistrations = {
          at: Date.now(),
          slots: parsed?.slots !== null && typeof parsed?.slots === 'object' ? parsed.slots : null,
          errors: Array.isArray(parsed?.errors) ? parsed.errors : [],
        }
      }
      respondJson(res, 200, { ok: true })
    } catch (error) {
      respondJson(res, 400, { error: 'bad-report', message: String(error?.message ?? error) })
    }
  }

  /**
   * History for the 统计 tab. Everything here is what this plugin measured —
   * the file is written by `recordSnapshot()` — so the response states its own
   * coverage rather than claiming to describe conversations it never saw.
   *
   * The read path never replays durable logs: it answers from stats.json (and
   * the session index once a background pass listed it) and asks for one
   * bounded fill in the background. `backfilling:true` tells the panel that the
   * corpus is still being priced; the next poll sees the new rows.
   */
  const stats = async (req, res) => {
    try {
      if (req.method !== 'GET') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.stats, 'http://localhost')
      const request = url.searchParams.get('backfill') === '0' ? { started: false, running: false } : requestBackfill(ctx)
      const history = await readStats()
      const fill = backfillState()
      respondJson(res, 200, {
        ...history,
        sessions: fill.sessions.slice(0, 60),
        backfill: fill.last,
        backfilling: request.started || request.running || fill.running,
        coverage: { ...history.coverage, known: fill.known },
        generatedAt: Date.now(),
      })
    } catch (error) {
      respondJson(res, 500, { error: 'stats-failed', message: String(error?.message ?? error) })
    }
  }

  /**
   * Original text behind one snapshot row. This is the only route that opens a
   * file, and it only opens paths that the snapshot collection registered
   * (skill files, instruction files): the request cannot name a path.
   * A 2s abort keeps the panel responsive; the response says `timeout` rather
   * than serving a half-collected item.
   */
  const content = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.content, 'http://localhost')
      const channel = url.searchParams.get('channel') ?? ''
      const id = url.searchParams.get('id') ?? ''
      const picked = pickAgent(ctx, url.searchParams.get('session') ?? undefined)
      let agent = picked.agent
      if (agent === undefined) agent = pickLastLive(ctx)
      const controller = new AbortController()
      // The contract budgets a read at 2s. Race the collection against that
      // budget so a slow assemble can never hold the drawer open; the abort
      // signal additionally stops providers that honour it.
      let timer
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          resolve({ ok: false, status: 504, error: 'timeout', message: 'content collection exceeded the 2s budget' })
        }, 2000)
      })
      let result
      try {
        result = await Promise.race([collectContent(ctx, agent, channel, id, controller.signal), deadline])
      } finally {
        clearTimeout(timer)
      }
      if (result.ok !== true) {
        respondJson(res, result.status ?? 500, {
          ok: false,
          error: result.error ?? 'content-failed',
          ...(result.message === undefined ? {} : { message: result.message }),
        })
        return
      }
      respondJson(res, 200, result)
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'content-failed', message: String(error?.message ?? error) })
    }
  }

  /**
   * Cross-session first-turn trend. Same measured rows the stats route reports,
   * plus the bounded durable-log backfill; unknown channel splits stay null.
   */
  const trend = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.trend, 'http://localhost')
      const range = url.searchParams.get('range') ?? 'all'
      if (!TREND_RANGES.includes(range)) {
        respondJson(res, 400, { ok: false, error: 'invalid-range', message: `range must be one of ${TREND_RANGES.join('|')}` })
        return
      }
      const limit = url.searchParams.get('limit') ?? String(TREND_LIMIT)
      const payload = await readTrend(range, limit, ctx)
      respondJson(res, 200, { ok: true, ...payload })
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'trend-failed', message: String(error?.message ?? error) })
    }
  }

  /** Injection event feed: what changed, for one session or the whole install. */
  const events = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.events, 'http://localhost')
      let sessionId = url.searchParams.get('session') ?? ''
      if (sessionId.length === 0) {
        const picked = pickAgent(ctx, undefined)
        const agent = picked.agent ?? pickLastLive(ctx)
        sessionId = typeof agent?.id === 'string' ? agent.id : ''
      }
      const limit = url.searchParams.get('limit') ?? '60'
      const payload = await readEvents(sessionId.length > 0 ? sessionId : undefined, limit)
      respondJson(res, 200, { ok: true, ...payload })
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'events-failed', message: String(error?.message ?? error) })
    }
  }

  /** Health checks for the current session (the /summary counts come from here). */
  const health = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTES.health, 'http://localhost')
      const picked = pickAgent(ctx, url.searchParams.get('session') ?? undefined)
      let agent = picked.agent
      let scopeSource = `health.${picked.source}`
      if (agent === undefined) {
        agent = pickLastLive(ctx)
        scopeSource = agent === undefined ? 'health.none' : 'health.last-live'
      }
      const snapshot = await buildSnapshot(ctx, agent, scopeSource, undefined)
      const report = buildHealth(snapshot)
      respondJson(res, 200, { ok: true, summary: report.summary, checks: report.checks })
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'health-failed', message: String(error?.message ?? error) })
    }
  }

  return {
    summary,
    policy,
    locale,
    action,
    ping,
    diag,
    verify,
    export: exportRoute,
    stats,
    content,
    trend,
    events,
    health,
    boot: report('boot'),
    registrations: report('registrations'),
  }
}

const countApplied = () => {
  // WeakSet has no size; the label is informational only.
  return appliedAgents === null ? 0 : undefined
}

/** Build the tool snapshot payload (kept out of index.js to bound its size). */
export { buildSnapshot, applyPolicyForAgent, isExcluded }
