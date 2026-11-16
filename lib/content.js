// Content inspection: the actual bytes behind one snapshot row.
//
// The panel can tell a user "this tool is 342 token" without ever showing what
// it says. This module answers the follow-up question — "show me the original"
// — for exactly the items the snapshot already lists, and for nothing else.
//
// Two hard rules:
//   - Reads are whitelisted. A path is only opened when it came out of the
//     snapshot's own collection (a skill's registered path, an instruction
//     file the harness probes). There is no API here that takes a caller
//     supplied path.
//   - Truncation is UTF-8 safe. A cut inside a multi-byte character would turn
//     the tail into U+FFFD, so the limit is enforced on bytes at a code-point
//     boundary.
import { open } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import { countText } from './measure.js'
import { cachedSources, collectSources, isLockedContext, resolveCwd } from './snapshot.js'

/** 256 KiB per the HTTP contract; also the default for any caller. */
export const CONTENT_LIMIT = 256 * 1024
/** Model tool budget: one item at a time must never dump 256 KiB into a turn. */
export const TOOL_CONTENT_LIMIT = 32 * 1024

export const CONTENT_CHANNELS = Object.freeze(['sections', 'contexts', 'skills', 'tools', 'instructions'])

function failure(status, error, message) {
  const out = { ok: false, status, error }
  if (message !== undefined) out.message = message
  return out
}

/**
 * Cut a string to at most `limit` UTF-8 bytes without splitting a code point or
 * a surrogate pair. Returns the byte length of the kept prefix, so `bytes` in a
 * response always describes the content actually returned.
 */
export function truncateUtf8(text, limit = CONTENT_LIMIT) {
  const source = typeof text === 'string' ? text : ''
  const total = Buffer.byteLength(source, 'utf8')
  if (total <= limit) return { text: source, truncated: false, bytes: total }
  if (limit <= 0) return { text: '', truncated: total > 0, bytes: 0 }
  let low = 0
  let high = source.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(source.slice(0, mid), 'utf8') <= limit) low = mid
    else high = mid - 1
  }
  let cut = low
  const code = source.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  const kept = source.slice(0, cut)
  return { text: kept, truncated: true, bytes: Buffer.byteLength(kept, 'utf8') }
}

/**
 * Every absolute path the current snapshot collection is allowed to open:
 * registered skill files (including a SKILL.md under a directory resource
 * base) and probed instruction files. Derived only from collection output.
 */
export function allowedPaths(sources) {
  const allowed = new Set()
  const add = (candidate) => {
    if (typeof candidate !== 'string' || candidate.length === 0) return
    try {
      allowed.add(resolvePath(candidate))
    } catch {
      /* an unrepresentable path is simply not whitelisted */
    }
  }
  const skills = Array.isArray(sources?.skillState?.all) ? sources.skillState.all : []
  for (const skill of skills) {
    add(skill?.path)
    if (skill?.resourceBase?.kind === 'directory' && typeof skill.resourceBase.path === 'string') {
      add(join(skill.resourceBase.path, 'SKILL.md'))
    }
  }
  const files = Array.isArray(sources?.instructions?.files) ? sources.instructions.files : []
  for (const file of files) add(file?.path)
  return allowed
}

/**
 * Read the first `limit` bytes of a whitelisted file and decode them as UTF-8.
 * A path that is not in `allowed` throws before any filesystem access.
 */
export async function readTextFile(path, limit = CONTENT_LIMIT, allowed) {
  if (!(allowed instanceof Set)) throw new Error('path-not-allowed')
  const resolved = resolvePath(String(path))
  if (!allowed.has(resolved)) throw new Error('path-not-allowed')

  const handle = await open(resolved, 'r')
  try {
    const info = await handle.stat()
    const totalBytes = Number.isFinite(info.size) ? info.size : 0
    const wanted = Math.min(totalBytes, limit + 4)
    const buffer = Buffer.alloc(wanted)
    let offset = 0
    while (offset < wanted) {
      const { bytesRead } = await handle.read(buffer, offset, wanted - offset, offset)
      if (bytesRead <= 0) break
      offset += bytesRead
    }
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let text = decoder.decode(buffer.subarray(0, offset), { stream: true })
    if (offset >= totalBytes) text += decoder.decode()
    const cut = truncateUtf8(text, limit)
    return {
      text: cut.text,
      truncated: offset < totalBytes || cut.truncated,
      bytes: cut.bytes,
      totalBytes,
    }
  } finally {
    await handle.close()
  }
}

const mcpServerOf = (name) => {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return undefined
  const rest = name.slice('mcp__'.length)
  const end = rest.indexOf('__')
  return end > 0 ? rest.slice(0, end) : rest.split('_')[0]
}

// Content ids are the same strings `/summary` items[].id carries: the snapshot
// prefixes them with the singular channel name (`tool:read`, not `tools:read`).
const ITEM_ID_PREFIX = {
  sections: 'section:',
  contexts: 'context:',
  skills: 'skill:',
  tools: 'tool:',
  instructions: 'instructions:',
}

function itemId(channel, name) {
  return `${ITEM_ID_PREFIX[channel] ?? `${channel}:`}${name}`
}

// Snapshot ids are singular (`tool:read`, `section:harness:identity`) while the
// channel names are plural; both spellings are accepted so a panel can pass an
// id from either place.
const ID_PREFIXES = {
  sections: ['section:', 'sections:'],
  contexts: ['context:', 'contexts:'],
  skills: ['skill:', 'skills:'],
  tools: ['tool:', 'tools:'],
  instructions: ['instructions:'],
}

function nameFromId(channel, id) {
  for (const prefix of ID_PREFIXES[channel] ?? []) {
    if (id.startsWith(prefix)) return id.slice(prefix.length)
  }
  return id
}

function toolProvider(name) {
  const server = mcpServerOf(name)
  return server === undefined ? undefined : `mcp:${server}`
}

function formatJson(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return JSON.stringify({ name: String(value?.name ?? ''), description: String(value?.description ?? ''), parameters: {} }, null, 2)
  }
}

function skillFrontmatter(name, description, whenToUse) {
  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(description)}`]
  if (typeof whenToUse === 'string' && whenToUse.length > 0) lines.push(`whenToUse: ${JSON.stringify(whenToUse)}`)
  lines.push('---', '')
  return lines.join('\n')
}

function findSkill(sources, name) {
  const skills = Array.isArray(sources?.skillState?.all) ? sources.skillState.all : []
  return skills.find((skill) => String(skill?.name ?? '') === name)
}

function findInstruction(sources, name) {
  const files = Array.isArray(sources?.instructions?.files) ? sources.instructions.files : []
  return files.find((file) => file?.path === name || file?.display === name)
}

async function readSkill(sources, skill, name, limit) {
  const allowed = allowedPaths(sources)
  const candidates = []
  if (typeof skill?.path === 'string' && skill.path.length > 0) candidates.push(skill.path)
  if (skill?.resourceBase?.kind === 'directory' && typeof skill.resourceBase.path === 'string') {
    candidates.push(join(skill.resourceBase.path, 'SKILL.md'))
  }
  for (const candidate of candidates) {
    try {
      const file = await readTextFile(candidate, limit, allowed)
      if (file.text.trim().length > 0) {
        return {
          ok: true,
          contentType: 'markdown',
          content: file.text,
          bytes: file.bytes,
          truncated: file.truncated,
          sourcePath: resolvePath(candidate),
          note: 'file',
        }
      }
    } catch {
      /* try the next candidate, then fall back to the catalog line */
    }
  }
  const description = typeof skill?.description === 'string' ? skill.description : ''
  const fallback = skillFrontmatter(name, description, skill?.whenToUse)
  const cut = truncateUtf8(fallback, limit)
  return { ok: true, contentType: 'markdown', content: cut.text, bytes: cut.bytes, truncated: cut.truncated, note: 'catalog' }
}

/**
 * Collect the original text behind one snapshot item.
 *
 * `id` is the same string `/summary` items[].id carries (`<channel>:<name>`);
 * a bare name is accepted as a convenience. Returns `{ok:true,...}` on success
 * or `{ok:false,status,error}` so the route can map 400/404/504 without
 * embedding HTTP statuses in this module.
 */
export async function collectContent(ctx, agent, channel, id, signal, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.round(options.limit) : CONTENT_LIMIT
  if (!CONTENT_CHANNELS.includes(channel)) {
    return failure(400, 'invalid-channel', `channel must be one of ${CONTENT_CHANNELS.join('|')}`)
  }
  if (typeof id !== 'string' || id.trim().length === 0) {
    return failure(400, 'invalid-id', 'id is required')
  }
  const raw = id.trim()
  const name = nameFromId(channel, raw)
  if (name.length === 0) return failure(404, 'not_found', 'empty item name')

  try {
    const sources = cachedSources(agent) ?? (await collectSources(ctx, agent, await resolveCwd(ctx, agent, signal), signal))
    if (signal?.aborted === true) return failure(504, 'timeout', 'content collection exceeded the 2s budget')

    if (channel === 'sections' || channel === 'contexts') {
      const bucket = channel === 'sections' ? sources.assembly?.sections : sources.assembly?.contexts
      const entries = Array.isArray(bucket) ? bucket : []
      const entry = entries.find((candidate) => String(candidate?.name ?? '') === name)
      if (entry === undefined) return failure(404, 'not_found', `no ${channel} item named ${name}`)
      const text = typeof entry.text === 'string' ? entry.text : ''
      const measure = countText(text)
      const cut = truncateUtf8(text, limit)
      const locked = channel === 'contexts' && (entry.required === true || isLockedContext(name))
      return {
        ok: true,
        item: { id: itemId(channel, name), channel, name, tokens: measure.tokens, chars: measure.chars, locked },
        contentType: 'text',
        content: cut.text,
        bytes: cut.bytes,
        truncated: cut.truncated,
        limit,
        note: 'assemble',
      }
    }

    if (channel === 'tools') {
      const schemas = Array.isArray(sources.schemas) ? sources.schemas : []
      const schema = schemas.find((candidate) => String(candidate?.name ?? '') === name)
      if (schema === undefined) return failure(404, 'not_found', `no tool named ${name}`)
      const description = typeof schema.description === 'string' ? schema.description : ''
      let rawParameters = ''
      try {
        rawParameters = JSON.stringify(schema.parameters ?? {}) ?? ''
      } catch {
        rawParameters = ''
      }
      const measure = countText(`${name}\n${description}\n${rawParameters}`)
      const formatted = formatJson({ name, description, parameters: schema.parameters ?? {} })
      const cut = truncateUtf8(formatted, limit)
      const provider = toolProvider(name)
      return {
        ok: true,
        item: {
          id: itemId('tools', name),
          channel: 'tools',
          name,
          tokens: measure.tokens,
          chars: measure.chars,
          ...(provider === undefined ? {} : { provider }),
          locked: false,
        },
        contentType: 'json',
        content: cut.text,
        bytes: cut.bytes,
        truncated: cut.truncated,
        limit,
        note: 'snapshot',
      }
    }

    if (channel === 'skills') {
      const skill = findSkill(sources, name)
      if (skill === undefined) return failure(404, 'not_found', `no skill named ${name}`)
      const description = typeof skill.description === 'string' ? skill.description : ''
      const measure = countText(`${name}\n${description}`)
      const file = await readSkill(sources, skill, name, limit)
      return {
        ok: true,
        item: {
          id: itemId('skills', name),
          channel: 'skills',
          name,
          tokens: measure.tokens,
          chars: measure.chars,
          ...(typeof skill.provider === 'string' ? { provider: skill.provider } : {}),
          locked: false,
        },
        contentType: file.contentType,
        content: file.content,
        bytes: file.bytes,
        truncated: file.truncated,
        limit,
        ...(file.sourcePath === undefined ? {} : { sourcePath: file.sourcePath }),
        note: file.note,
      }
    }

    // instructions
    const file = findInstruction(sources, name)
    if (file === undefined) return failure(404, 'not_found', `no instruction file matching ${name}`)
    if (file.status === 'missing') return failure(404, 'not_found', `${file.display} is not present on disk`)
    const allowed = allowedPaths(sources)
    let read
    try {
      read = await readTextFile(file.path, limit, allowed)
    } catch (error) {
      return failure(500, 'unreadable', String(error?.message ?? error))
    }
    return {
      ok: true,
      item: {
        id: itemId('instructions', file.path),
        channel: 'instructions',
        name: file.display,
        tokens: Number(file.tokens) || 0,
        chars: Number(file.chars) || 0,
        locked: true,
      },
      contentType: 'markdown',
      content: read.text,
      bytes: read.bytes,
      truncated: read.truncated,
      limit,
      sourcePath: resolvePath(file.path),
      note: 'file',
    }
  } catch (error) {
    if (signal?.aborted === true) return failure(504, 'timeout', 'content collection exceeded the 2s budget')
    return failure(500, 'content-failed', String(error?.message ?? error))
  }
}
