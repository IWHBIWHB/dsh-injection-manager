// Content drawer backend: the original text behind one snapshot row.
//
// The fake context mirrors the real service shapes (assemble / skills.snapshot /
// tools.schemas) and every file lives under a temp DSH_HOME, so nothing here
// touches a real profile or workspace.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-content-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')
const cwd = join(home, 'work')
const skillDir = join(home, 'skills', 'alpha')
await mkdir(cwd, { recursive: true })
await mkdir(skillDir, { recursive: true })
await writeFile(join(cwd, 'AGENTS.md'), '# Workspace rules\n\nBe brief and cite evidence.\n', 'utf8')
const skillPath = join(skillDir, 'SKILL.md')
await writeFile(skillPath, '---\nname: alpha\ndescription: Alpha skill\n---\n\n# Alpha\n\nThe body.\n', 'utf8')
await writeFile(join(home, 'secret.txt'), 'do not read me', 'utf8')

const { CONTENT_LIMIT, TOOL_CONTENT_LIMIT, allowedPaths, collectContent, readTextFile, truncateUtf8 } = await import(
  '../lib/content.js'
)

const longText = `Tool SDK docs\n\n${'x'.repeat(4000)}`
const ctx = {
  workingDirectory: { ensure: async () => cwd, defaultDirectory: cwd },
  systemPrompt: {
    assemble: async () => ({
      sections: [
        { name: 'harness:identity', order: -1000, text: 'You are a test agent.' },
        { name: 'tools:sdk', order: 5000, text: longText },
      ],
      contexts: [
        { name: 'working-directory:current', order: 100, text: 'cwd is here', required: true },
        { name: 'approval:policy', order: 115, text: 'approval rules' },
      ],
    }),
  },
  skills: {
    snapshot: async () => ({
      complete: true,
      skills: [
        {
          name: 'alpha',
          description: 'Alpha skill does things',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'preset',
          source: 'user',
          path: skillPath,
        },
        {
          name: 'beta',
          description: 'Beta has no file',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'runtime',
          source: 'runtime',
        },
      ],
    }),
  },
  tools: {
    schemas: () => [
      { name: 'mcp__demo__lookup', description: 'Look things up', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
      { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
    ],
  },
  get: () => undefined,
}
const agent = { id: 'session-content', session: {} }

test('a section returns the assembled text, not a catalog line', async () => {
  const result = await collectContent(ctx, agent, 'sections', 'section:harness:identity')
  assert.equal(result.ok, true)
  assert.equal(result.contentType, 'text')
  assert.equal(result.note, 'assemble')
  assert.equal(result.content, 'You are a test agent.')
  assert.equal(result.limit, CONTENT_LIMIT)
  assert.equal(result.truncated, false)
  assert.equal(result.bytes, Buffer.byteLength(result.content))
  assert.equal(result.item.id, 'section:harness:identity')
  assert.equal(result.item.channel, 'sections')
  assert.equal(result.item.locked, false)
  assert.equal(result.sourcePath, undefined)
})

test('a required runtime context reports itself as locked', async () => {
  const locked = await collectContent(ctx, agent, 'contexts', 'context:working-directory:current')
  assert.equal(locked.ok, true)
  assert.equal(locked.item.locked, true)
  assert.equal(locked.content, 'cwd is here')
  const optional = await collectContent(ctx, agent, 'contexts', 'context:approval:policy')
  assert.equal(optional.item.locked, false)
})

test('a tool returns formatted JSON with the same size the snapshot measured', async () => {
  const result = await collectContent(ctx, agent, 'tools', 'tool:mcp__demo__lookup')
  assert.equal(result.ok, true)
  assert.equal(result.contentType, 'json')
  assert.equal(result.note, 'snapshot')
  assert.equal(result.item.provider, 'mcp:demo')
  const parsed = JSON.parse(result.content)
  assert.equal(parsed.name, 'mcp__demo__lookup')
  assert.equal(parsed.description, 'Look things up')
  assert.deepEqual(parsed.parameters, { type: 'object', properties: { q: { type: 'string' } } })
  assert.match(result.content, /\n {2}"name"/, 'two-space indentation')
})

test('a skill with a registered file returns the SKILL.md body', async () => {
  const result = await collectContent(ctx, agent, 'skills', 'skill:alpha')
  assert.equal(result.ok, true)
  assert.equal(result.contentType, 'markdown')
  assert.equal(result.note, 'file')
  assert.equal(result.sourcePath, skillPath)
  assert.match(result.content, /# Alpha/)
  assert.match(result.content, /The body\./)
  assert.equal(result.item.provider, 'preset')
})

test('a skill without a file falls back to frontmatter and the catalog note', async () => {
  const result = await collectContent(ctx, agent, 'skills', 'skill:beta')
  assert.equal(result.ok, true)
  assert.equal(result.note, 'catalog')
  assert.equal(result.sourcePath, undefined)
  assert.match(result.content, /^---\nname: beta\n/)
  assert.match(result.content, /Beta has no file/)
})

test('an instruction file returns the real file content', async () => {
  const path = join(cwd, 'AGENTS.md')
  const result = await collectContent(ctx, agent, 'instructions', `instructions:${path}`)
  assert.equal(result.ok, true)
  assert.equal(result.contentType, 'markdown')
  assert.equal(result.note, 'file')
  assert.equal(result.sourcePath, path)
  assert.equal(result.content, '# Workspace rules\n\nBe brief and cite evidence.\n')
  assert.equal(result.item.locked, true)
})

test('bad channels and unknown items fail with route-mappable statuses', async () => {
  assert.equal((await collectContent(ctx, agent, 'bogus', 'x')).status, 400)
  assert.equal((await collectContent(ctx, agent, 'tools', 'tool:missing')).status, 404)
  assert.equal((await collectContent(ctx, agent, 'instructions', 'instructions:C:/nowhere/AGENTS.md')).status, 404)
  assert.equal((await collectContent(ctx, agent, 'sections', '')).status, 400)
})

test('a caller can lower the limit and still gets a valid UTF-8 prefix', async () => {
  const result = await collectContent(ctx, agent, 'sections', 'section:tools:sdk', undefined, { limit: TOOL_CONTENT_LIMIT })
  assert.equal(result.ok, true)
  assert.equal(result.limit, TOOL_CONTENT_LIMIT)
  const tiny = await collectContent(ctx, agent, 'sections', 'section:tools:sdk', undefined, { limit: 8 })
  assert.equal(tiny.truncated, true)
  assert.ok(tiny.bytes <= 8)
  assert.equal(tiny.content, 'Tool SDK')
})

test('truncateUtf8 never splits a multi-byte character', () => {
  const chinese = truncateUtf8('你好世界', 7)
  assert.equal(chinese.text, '你好')
  assert.equal(chinese.bytes, 6)
  assert.equal(chinese.truncated, true)
  assert.doesNotMatch(chinese.text, /\uFFFD/)

  const emoji = truncateUtf8('😀😀', 5)
  assert.equal(emoji.text, '😀')
  assert.equal(emoji.bytes, 4)
  assert.doesNotMatch(emoji.text, /\uFFFD/)

  const untouched = truncateUtf8('abc', 10)
  assert.deepEqual(untouched, { text: 'abc', truncated: false, bytes: 3 })
})

test('the whitelist refuses any path the snapshot did not register', async () => {
  const sources = {
    skillState: { all: [{ name: 'alpha', path: skillPath }] },
    instructions: { files: [{ path: join(cwd, 'AGENTS.md') }] },
  }
  const allowed = allowedPaths(sources)
  assert.equal(allowed.has(skillPath), true)
  assert.equal(((await readTextFile(skillPath, 1024, allowed)).text).startsWith('---'), true)
  await assert.rejects(() => readTextFile(join(home, 'secret.txt'), 1024, allowed), /path-not-allowed/)
  await assert.rejects(() => readTextFile(join(home, 'secret.txt'), 1024), /path-not-allowed/)
})

test('cleanup', async () => {
  await rm(home, { recursive: true, force: true })
})
