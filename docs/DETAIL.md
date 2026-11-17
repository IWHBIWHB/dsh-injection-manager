![Context injection: many sources narrowed into one first request](preview.svg)

# What this plugin actually changes

A new DSH session receives a lot before its first request reaches a model: the system prompt
sections, runtime contexts, the skill catalog as text, one JSON schema per tool, and the
`AGENTS.md` chain. None of it is visible in the conversation, and there is no single place to
turn any of it off.

This page is the five-minute version of what the plugin measures, what it can and cannot switch,
and what the surfaces in 2.1.0 show. The [README](../README.md) is the overview; the
[architecture](ARCHITECTURE.md) is the implementation.

## 1. Three numbers, three questions

| Number | Question | Where it comes from |
| --- | --- | --- |
| First-turn injection (e.g. 83.8k) | What will the *next new session* be given? | Assembled here: prompt sections and contexts from `systemPrompt.assemble()`, skills from `skills.snapshot()`, tool schemas from `tools.schemas()`, `AGENTS.md` read from the default chain |
| Window occupancy (e.g. 36%) | How full is *this* conversation? | The host's own `contextPressure` projection, divided by the model's window |
| Content (the drawer) | What does one line *actually say*? | The snapshot's own registered sources: assembled text, tool declarations, skill files or catalog lines, instruction files |

They are not comparable, and the panel never subtracts one from the other. The first number is
what the plugin controls; the second decides when the host compacts; the third is the raw text
behind a row, read only when you open it.

Token counts from this plugin are estimates (ASCII ÷ 4, other characters ÷ 1.6). The occupancy
figure is not: `pressureTokens` is provider-reported, and the window comes from the same request
record the model adapter used.

## 2. Three tabs, two ambient entries

| Surface | What it is for |
| --- | --- |
| Manage (管理) | KPI row, request strip, health strip, one compact composition/ranking card, then the suite-clustered list (split into Plugins / MCP and DSH built-in) with switches; every row can expand a preview or open its content. |
| Insights (洞察) | Cross-session first-turn trend, aggregate band, session cards, cross-session composition, heaviest suites, this session's event timeline, coverage footnote. |
| Settings (设置) | Presets, four channel masters, custom prefix/suffix, export/import, undo history, verification, plugin preferences, versions and language. |
| Composer chip | First-turn total and window occupancy, one line, deliberately muted; × hides it. |
| `/inject` + `context_injection` | The same numbers as text, plus a read-only model tool (optionally one item's content). |

## 3. What the manage page shows

- **Health** — deterministic findings over the current snapshot (section 5), each with an action.
- **KPI** — first-turn injection, window occupancy with its denominator, and the switchable share;
  the composer chip mirrors the same numbers.
- **Request strip** — system / tools / messages split of the *current* request and compaction
  receipts, from the host's own projections.
- **Overview card** — the first-turn composition ring and the suite ranking share one compact card
  above the list; the filter bar only appears when a filter is active, so the list keeps the height.
- **The list** — five channels, clustered into suites (one MCP server = one switch) and split into
  **Plugins / MCP** (MCP tool namespaces, `mcp:<server>` prompt sections, provider-backed skills)
  and **DSH built-in** (host prompt sections, runtime contexts, workspace rules, core built-in tool
  families, instruction files); a profile with only one origin keeps the plain list. Every item
  carries a description; a suite row carries item count, tokens, share and a tri-state switch; a
  closed suite stays visible with its remembered size so it can be reopened. Items expand an inline
  preview; the content button opens the drawer.

## 4. What the content drawer reads

Only sources the snapshot itself registered — a request cannot name a path:

| Row | Content | Note shown |
| --- | --- | --- |
| Prompt section / runtime context | The assembled text (no single file) | "from the system prompt assembly" |
| Tool schema | The JSON declaration, split into description / parameter table / raw JSON | "from the session snapshot" |
| Skill | `SKILL.md` body when resolvable, otherwise the exact catalog line that is injected | "file" or "skill catalog entry" |
| Workspace rule | The real `AGENTS.md` / `CLAUDE.md` content and path | "from a file on disk" |

The drawer shows line numbers (toggleable), in-content search with match highlighting and a
per-line match summary, copy full text / copy path, a truncation notice at the 256 KB cap (32 KB
for the model tool), and closes on Esc with focus restored. It renders plain text; nothing is
re-interpreted as HTML. A slow read returns `timeout` after 2 seconds instead of a half result.

## 5. Health checks

| Code | Fires when | Action |
| --- | --- | --- |
| `heavy-suite` | an installed plugin / MCP suite is ≥25% of the next first request under the saved policy, or ≥30k tokens | turn that suite off (every channel it spans) |
| `builtin-heavy` | a DSH built-in suite is that big (informational: closing host tool families is not recommended) | — |
| `catalog-truncated` | skill descriptions are cut at the catalog line length | read the affected skill |
| `locked-items` | items that cannot be switched off are ≥10% | jump to the manage list |
| `unknown-window` | no measurement yet, so occupancy is unknowable | — |
| `no-policy` | nothing has been switched off in this workspace | open settings |
| `empty-catalog` | the skill catalog is complete and empty | open settings |

Checks are a pure function of one snapshot (two refreshes cannot disagree). They read the
**effective projection** — what the next session actually carries under the saved policy — not the
frozen live assembly, so a suite that was just switched off stops producing its own finding and the
panel refreshes the strip by itself. Replaying an already-applied switch is a no-op: the action
answers `changed: false` and writes no undo step, no event row and no toast. Up to six findings are
shown with a "more" line. Two contract codes, `duplicate-skill` and `tool-name-collision`, are
never emitted: this host build resolves duplicate names before the plugin can observe them, and
inventing a finding would be a lie.

## 6. The insights tab

- **Trend** — one stacked bar per session, split by the five channels; 7 days / 30 days / all;
  hover for values, click to pin, Esc to unpin, ←/→ by keyboard. Above 40 points the bars merge
  into overview buckets so a long history does not become hairlines. Rows without a channel split
  are striped, not zeroed. The durable-log backfill runs in the background (one pass per minute,
  ≤8 sessions) so opening the tab never waits on it; a response may carry `backfilling: true` while
  a pass is running, and the panel notes that older sessions are still being filled in.
- **Aggregate band** — sessions measured (shown as measured / known), average, peak, cumulative
  saved.
- **Session cards** — search by id/title/directory; sort by recent / heaviest / most saved; the
  current session is marked; a card opens that session in the manage list or its content.
- **Cross-session composition** — the five-channel ring averaged over sessions that have a split.
- **Heaviest suites** — the current session's suites by size, with the policy-removed part drawn
  lighter.
- **Event timeline** — policy saves, presets, imports, undos, compactions and prunes
  for this session (`events.json`, capped at 300, up to 60 shown).
- **Coverage footnote** — recorded N of M sessions; the trend only contains what this plugin
  measured plus a bounded log backfill.

## 7. What a policy does, and when

A policy is one JSON file: per channel, `all`, `only [names]` or `except [names]`, plus an optional
persona prefix/suffix.

It is applied exactly once, at `agent/created` with `source: startup|clear`. A session that already
exists is never rewritten mid-flight, so:

- the panel says whether *this* session was affected;
- "after policy" numbers are a projection for the next new session;
- undo restores the previous policy file, but still cannot retroactively change a live session.

## 8. Suites

Items cluster by name: `mcp__<server>__<tool>` is one suite per MCP server; non-MCP tools cluster by
shared prefix; skills by provider; prompt sections and contexts by namespace, so an MCP server's
prompt section joins the same suite as its tools. One switch then means "the whole server", which is
the reason this plugin exists.

## 9. Data and privacy

`policy.json` (switches), `stats.json` (one measured row per session, with a channel
split from 2.0.0 on), `events.json` (append-only, 300 rows, policy metadata only — strings are
flattened and truncated to 200 characters, prompt text has no path in), and browser-local UI
preferences. No network requests, no telemetry, no uploads. Details: [FAQ](FAQ.md).

## 10. What the model sees

The model-facing tool `context_injection` returns the same snapshot the panel renders, plus a short
"What you can do" block: which suite is the biggest win, whether this session predates the policy,
what compaction already removed, and the fact that the tool cannot flip switches. With
`{channel, name}` it returns one item's content instead (≤32 KB). It is read-only by design; every
write comes from a human click in the panel.

## 11. Failure behaviour

- Host older than 0.2.2: banner, switches may not take effect, the numbers still render.
- Host HTTP contract older than v2: the new surfaces show a dismissible gate card (current /
  minimum / dismiss) instead of silently disappearing; manage, settings and switches keep working.
- No measurement yet in this session: the window card says "window unknown" rather than guessing.
- A `compaction/*` event this build does not know: ignored (the receipt simply does not count it).
- `events.json` unreadable or absent: the timeline shows an empty state; policy saves still work.
- A content read that exceeds 2 seconds: the drawer shows the timeout and can retry.
- Policy file unreadable: the panel shows the error and keeps running with the all-on defaults;
  `/inject` still prints the snapshot.
