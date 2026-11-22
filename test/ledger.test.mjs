// Catalog and injection-ledger units. The ledger is the v3 core: these tests
// pin the two things that must not drift — who owns a surface, and that a
// recorded assembly keeps offered/admitted/blocked items plus exact text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describeItem, catalogRows, sectionOwner, contextOwner, toolOwner, messageOwner } from '../lib/catalog.js'
import { createLedger } from '../lib/ledger.js'

test('catalog: sections, contexts, tools and messages classify to the owning package', () => {
  assert.equal(sectionOwner('tool:read').owner, 'tool package (dsh-tool-*)')
  assert.equal(sectionOwner('tool:read').control, 'plugin')
  assert.equal(sectionOwner('mcp:rea').control, 'plugin')
  assert.equal(sectionOwner('harness:identity').owner, 'dsh-system-prompt')
  assert.equal(contextOwner('working-directory:current').control, 'protected')
  assert.equal(contextOwner('sandbox:policy').owner, 'dsh-sandbox-policy')
  assert.equal(toolOwner('mcp__rea__inspect').owner, 'MCP server "rea"')
  assert.equal(toolOwner('read').owner, 'dsh-tool-fs')
  assert.equal(messageOwner('agent-instructions').control, 'user')
  assert.equal(messageOwner('runtime-context').control, 'plugin')
  assert.equal(messageOwner('no-such-source').control, 'preview')
})

test('catalog: the client reference keeps the message-level rules', () => {
  const rows = catalogRows()
  assert.ok(Array.isArray(rows.messages) && rows.messages.length >= 8)
  const instructions = rows.messages.find((row) => row.kind === 'agent-instructions')
  assert.equal(instructions.control, 'user')
  assert.equal(typeof instructions.manage.zh, 'string')
  assert.equal(describeItem('message', 'skill-catalog').owner, 'skill catalog (dsh-tool-skill)')
})

test('ledger: records offered vs admitted, blocked items, tool schemas and text', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ledger-unit-'))
  try {
    const ledger = createLedger({ directory: home, maxEntries: 20 })
    const summary = ledger.record({
      session: 'session-1',
      offered: {
        sections: [
          { name: 'harness:identity', order: -1000, text: 'You are an AI agent.' },
          { name: 'tool:read', order: 1100, text: 'READ GUIDANCE' },
        ],
        contexts: [{ name: 'working-directory:current', order: 100, text: '/work' }],
      },
      admitted: {
        sections: [{ name: 'harness:identity', order: -1000, text: 'You are an AI agent.' }],
        contexts: [{ name: 'working-directory:current', order: 100, text: '/work' }],
      },
      variables: { model: 'deepseek-flash' },
      tools: [{ name: 'read', description: 'read files' }, { name: 'mcp__rea__inspect', description: 'inspect' }],
      messages: [],
      model: 'deepseek-flash',
      provider: 'deepseek',
    })
    assert.equal(summary.counts.sections, 1)
    assert.equal(summary.counts.blockedSections, 1)
    assert.equal(summary.counts.tools, 2)

    const listed = ledger.list({ session: 'session-1', limit: 5 })
    assert.equal(listed.total, 1)
    assert.equal(listed.entries[0].id, summary.id)

    const full = ledger.get(summary.id)
    assert.equal(full.ok, true)
    assert.equal(full.entry.blocked.sections[0].name, 'tool:read')
    // Required contexts are restored by the host, never "blocked by policy".
    assert.deepEqual(full.entry.blocked.restored, [])
    assert.equal(full.entry.counts.restoredContexts, 0)
    assert.equal(full.entry.sections[0].control, 'plugin')
    assert.equal(full.entry.contexts[0].control, 'protected')
    assert.equal(full.entry.tools[1].owner, 'MCP server "rea"')

    const item = full.entry.sections[0]
    const text = ledger.text(item.hash)
    assert.equal(text.ok, true)
    assert.equal(text.text, 'You are an AI agent.')
    assert.equal(ledger.text('ffffffffffffffffffff').ok, false)

    // The content-addressed file must really exist on disk, so the exact text
    // survives a host restart instead of only living in memory.
    await ledger.flush()
    const stored = await ledger.readStored(item.hash)
    assert.equal(stored.ok, true)
    assert.equal(stored.text, 'You are an AI agent.')

    // finalize attaches the step's turn/step and decided message-level entries
    const final = ledger.finalize(summary.id, {
      turn: 1,
      step: 1,
      messages: [{ kind: 'skill-catalog', chars: 42, preview: 'skills…', form: 'snapshot' }],
    })
    assert.equal(final.turn, 1)
    assert.equal(final.step, 1)
    const again = ledger.get(summary.id)
    assert.equal(again.entry.messages.length, 1)
    assert.equal(again.entry.messages[0].hash, null)
    assert.equal(again.entry.messages[0].previewOnly, true)
    assert.equal(ledger.stats().entries, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('catalog: real-session surfaces classify to their owning package', () => {
  // Observed in the 0.2.2-rc.5 QA session ledger; these rows keep the catalog
  // honest when the host injects surfaces a source grep does not obviously show.
  assert.equal(toolOwner('job_list').owner, 'dsh-tool-jobs')
  assert.equal(toolOwner('job_kill').owner, 'dsh-tool-jobs')
  assert.equal(toolOwner('schedule_create').owner, 'dsh-tool-schedule')
  assert.equal(toolOwner('web_search').owner, 'dsh-tool-web')
  assert.equal(toolOwner('working_directory').owner, 'dsh-tool-working-directory')
  assert.equal(toolOwner('present').owner, 'dsh-tool-present')
  assert.equal(toolOwner('plugin_manager').owner, 'dsh-plugin-manager')
  assert.equal(toolOwner('ask_user_question').owner, 'dsh-tool-ask-user')
  assert.equal(toolOwner('list_agents').owner, 'dsh-tool-agent-team')
  assert.equal(toolOwner('subagent_fork').owner, 'dsh-tool-subagent')
  assert.equal(contextOwner('subagent:identity').control, 'protected')
  assert.equal(contextOwner('tool:subagent:depth').owner, 'dsh-tool-subagent')
  assert.equal(messageOwner('time-context').control, 'preview')
  assert.equal(messageOwner('tool-jobs').control, 'preview')
})

test('ledger: message rows keep the host source kind next to the semantic kind', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ledger-unit3-'))
  try {
    const ledger = createLedger({ directory: home })
    const summary = ledger.record({
      session: 's',
      offered: { sections: [], contexts: [] },
      admitted: { sections: [], contexts: [] },
      messages: [{ kind: 'runtime-context', text: '<system-reminder>env</system-reminder>', chars: 40 }],
      tools: [],
    })
    const entry = ledger.get(summary.id).entry
    assert.equal(entry.messages[0].name, 'runtime-context')
    assert.equal(entry.messages[0].sourceKind, 'runtime-context')
    assert.equal(entry.messages[0].kind, 'environment')
    assert.equal(entry.messages[0].control, 'plugin')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('ledger: a dropped required context is recorded as restored, not blocked', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ledger-unit4-'))
  try {
    const ledger = createLedger({ directory: home })
    const summary = ledger.record({
      session: 's',
      offered: {
        sections: [],
        contexts: [
          { name: 'working-directory:current', order: 100, text: '/work' },
          { name: 'sandbox:policy', order: 110, text: 'sandbox: workspace-write' },
        ],
      },
      admitted: { sections: [], contexts: [] },
      tools: [],
    })
    const entry = ledger.get(summary.id).entry
    const restored = entry.blocked.restored
    assert.equal(restored.length, 1)
    assert.equal(restored[0].name, 'working-directory:current')
    assert.equal(restored[0].status, 'restored')
    assert.equal(entry.counts.restoredContexts, 1)
    assert.equal(entry.blocked.contexts.length, 1)
    assert.equal(entry.blocked.contexts[0].name, 'sandbox:policy')
    assert.equal(entry.counts.blockedContexts, 1)
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 })
  }
})

test('ledger: message text and variables are preview-only, not stored', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ledger-unit2-'))
  try {
    const ledger = createLedger({ directory: home })
    const summary = ledger.record({
      session: 's',
      offered: { sections: [], contexts: [] },
      admitted: { sections: [], contexts: [] },
      variables: { model: 'deepseek-flash' },
      messages: [{ kind: 'time-context', text: 'now is 12:00', chars: 11 }],
      tools: [],
    })
    const entry = ledger.get(summary.id).entry
    assert.equal(entry.variables[0].hash, null)
    assert.equal(entry.variables[0].previewOnly, true)
    assert.equal(entry.messages[0].hash, null)
    assert.equal(entry.messages[0].previewOnly, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
