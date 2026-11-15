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
import { popUndo, pushUndo, undoState } from './history.js'
import { CHANNELS, defaultPolicy, isExcluded, normalizePolicy, policyFilePath, readPolicy } from './policy.js'
import { PRESET_NAMES, presetPolicy } from './presets.js'
import { buildSnapshot, planBudget, policyFromPlan, appliedAgents, lastApplicationState } from './snapshot.js'
import { getSettings } from './settings.js'
import { renderCard, renderText } from './text.js'

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
export const ROUTE_PREFIX = '/plugins/dsh-injection-manager'

export const ROUTES = {
  ping: `${ROUTE_PREFIX}/ping`,
  summary: `${ROUTE_PREFIX}/summary`,
  locale: `${ROUTE_PREFIX}/locale`,
  policy: `${ROUTE_PREFIX}/policy`,
  action: `${ROUTE_PREFIX}/action`,
  diag: `${ROUTE_PREFIX}/diag`,
  verify: `${ROUTE_PREFIX}/verify`,
  registrations: `${ROUTE_PREFIX}/registrations`,
  boot: `${ROUTE_PREFIX}/boot`,
}

// In-memory diagnostics written by the browser half. Never persisted.
let clientBoot = null
let clientRegistrations = null

function respondJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(body.length))
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

async function readClientLocale() {
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
  return { zh: await read('zh'), en: await read('en') }
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

async function applyAction(ctx, agent, action) {
  const state = await readPolicy()
  const policy = normalizePolicy(state.policy)

  if (action?.kind === 'undo') {
    const previous = popUndo()
    if (previous === undefined) throw new Error('nothing-to-undo')
    const restored = normalizePolicy(previous)
    await savePolicy(restored)
    return restored
  }

  // Everything below is a mutation; remember the pre-write policy so the panel
  // can offer one-click undo for a whole-suite switch.
  const before = JSON.parse(JSON.stringify(policy))

  switch (action?.kind) {
    case 'item': {
      toggleItem(policy, action.channel, String(action.name ?? ''), action.enabled === true)
      policy.preset = 'custom'
      break
    }
    case 'channel': {
      if (!CHANNELS.includes(action.channel)) throw new Error(`unknown channel: ${action.channel}`)
      policy[action.channel] = action.enabled === true ? { mode: 'all', names: [] } : { mode: 'only', names: [] }
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
      next.budget = policy.budget
      Object.assign(policy, next)
      break
    }
    case 'group': {
      const channel = String(action.channel ?? '')
      const group = String(action.group ?? '')
      if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`)
      const snapshot = await buildSnapshot(ctx, agent, 'action', undefined)
      const names = snapshot.items
        .filter((item) => item.channel === channel && item.group === group && !item.locked)
        .map((item) => item.name)
      for (const name of names) toggleItem(policy, channel, name, action.enabled === true)
      policy.preset = 'custom'
      break
    }
    case 'prompt': {
      if (typeof action.prefix === 'string') policy.prompt.prefix = action.prefix
      if (typeof action.suffix === 'string') policy.prompt.suffix = action.suffix
      policy.preset = 'custom'
      break
    }
    case 'budget': {
      const tokens = Number(action.tokens)
      policy.budget.tokens = Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0
      break
    }
    case 'budget.apply': {
      const snapshot = await buildSnapshot(ctx, agent, 'action', undefined)
      const target = Number(action.tokens) > 0 ? Number(action.tokens) : policy.budget.tokens
      const plan = planBudget(policy, snapshot.items, target)
      const next = policyFromPlan(policy, plan)
      next.prompt = policy.prompt
      next.budget = { tokens: Math.round(target) }
      Object.assign(policy, next)
      break
    }
    case 'reset': {
      const fresh = defaultPolicy()
      fresh.prompt = policy.prompt
      Object.assign(policy, fresh)
      break
    }
    default:
      throw new Error(`unknown action kind: ${action?.kind}`)
  }

  await savePolicy(policy)
  pushUndo(before)
  return policy
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
      const picked = pickAgent(ctx, sessionId)
      let agent = picked.agent
      let scopeSource = `route.${picked.source}`
      if (agent === undefined) {
        agent = pickLastLive(ctx)
        scopeSource = agent === undefined ? 'route.none' : 'route.last-live'
      }
      const snapshot = await buildSnapshot(ctx, agent, scopeSource, undefined)
      const payload = {
        ...snapshot,
        text: renderText(snapshot),
        card: renderCard(snapshot),
        presets: PRESET_NAMES,
        settings: getSettings(),
        locale: await readClientLocale(),
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
      const raw = await readBody(req)
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
      await applyAction(ctx, picked.agent, parsed)
      const state = await readPolicy()
      respondJson(res, 200, { ok: true, policy: state.policy, path: state.path, undo: undoState() })
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

  return { summary, policy, locale, action, ping, diag, verify, boot: report('boot'), registrations: report('registrations') }
}

const countApplied = () => {
  // WeakSet has no size; the label is informational only.
  return appliedAgents === null ? 0 : undefined
}

/** Build the tool snapshot payload (kept out of index.js to bound its size). */
export { buildSnapshot, applyPolicyForAgent, isExcluded }
