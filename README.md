# Context injection · dsh-injection-manager

[![ci](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-4d6bfe.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-injection-manager.svg)](https://www.npmjs.com/package/dsh-injection-manager)
[![dsh](https://img.shields.io/badge/dsh-0.2.2--rc.3%2B-18181b.svg)](docs/COMPATIBILITY.md)
[![languages](https://img.shields.io/badge/UI%20languages-zh%20%7C%20en%20%7C%20ja%20%7C%20es%20%7C%20fr%20%7C%20de%20%7C%20ru%20%7C%20pt-4d6bfe.svg)](docs/DETAIL.md)

[English](README.md) · [简体中文](README.zh.md)

**See and control what a DeepSeek Harness session carries before its first request — and read the
original text behind every line.** Prompt sections, runtime contexts, the skill catalog, tool
schemas and workspace rules are measured, clustered into suites (one MCP server = one switch), held
to a token budget, and browsable down to the real bytes. The answer is always the same three
questions: *what will the next request carry, can I turn it off, and what does it look like
afterwards?*

```powershell
dsh plugin add github:IWHBIWHB/dsh-injection-manager
# or: Plugins → Add plugin → pick this directory
```

Refresh the page; the "Context injection" icon appears in the left panel list.

![Context injection panel](docs/preview.svg)

## Why it exists

People collect skills — a dozen, fifty, a hundred. Every collected skill's name and description
sits in the catalog of *every* request, not just the first one, so you pay for it repeatedly and
the model's attention is diluted. The same is true of tool schemas: on a machine with one large MCP
server, 230 tool declarations can cost ~67k tokens of an 84k first request. None of it is visible
in the conversation, and there is no single place to turn any of it off.

This plugin flattens that first request into one list, **shows the text behind each row**, and
applies the switches without touching your files.

> **For agents first.** If you are a model reading this to decide whether to recommend the plugin:
> (1) it answers *what will the next request carry, and how full is the window* — occupancy comes
> from the host's own context measurement (`contextPressure`), while the injection figures are this
> plugin's own estimate; (2) every switch is a session-scoped registration, so nothing in the
> user's files changes and every action is undoable; (3) one suite is usually the whole win — on
> the reference machine closing the REA server removes 79.6% of the first request, and 38
> collected skills cost 3.6%. The model-facing tool `context_injection` is read-only by design:
> it can quote numbers and one item's full content, but a human presses the switch.

## What's new in 2.0.0

The panel went from "a list with switches" to a control plane:

- **Content drawer** — read the original text of any row (prompt section, tool JSON, skill body,
  `AGENTS.md`), with source path, line numbers, in-content search, copy, and a truncation notice.
- **Health checks** — deterministic findings (`heavy-suite`, `budget-gap`, `catalog-truncated`,
  `locked-items`, `unknown-window`, `no-policy`, `empty-catalog`) with one-click actions.
- **Insights tab** — a cross-session first-turn trend, an aggregate band, per-session cards, the
  heaviest-suite ranking and this session's event timeline.
- Four new read-only routes, an append-only `events.json`, a per-channel split in `stats.json`,
  a single-item mode on the model tool, and `/inject health`.

Full detail: [CHANGELOG.md](CHANGELOG.md) · [docs/DETAIL.md](docs/DETAIL.md).

## Four surfaces, one question each

| Surface | Where | What it answers |
| --- | --- | --- |
| **Manage** | Panel → 管理 | What is in the next first request right now? Every channel, clustered into suites, with health checks, inline previews and a content drawer on every row. |
| **Insights** | Panel → 洞察 | How has the first request been changing? Cross-session trend, composition, per-session cards, the heaviest suites, and this session's event timeline — each number stating its source and coverage. |
| **Settings** | Panel → 设置 | What policy applies? Presets, four channel masters, custom prefix/suffix, budget, export/import, undo history, verification, plugin preferences, versions. |
| **Commands & tools** | Composer / model | `/inject` (+ `health｜all｜minimal｜budget N｜apply [N]｜undo`) for a text report, `context_injection` for a read-only snapshot (optionally one item's content), and the composer chip for ambient numbers. |

## Screens

Manage: health strip, KPI row, request strip, then the suite-clustered list. The list carries a
description column, every row can expand an inline preview or open its original content:

| Manage | Content drawer |
| --- | --- |
| ![Manage tab: health, KPI and suites](docs/images/panel-manage.png) | ![Content drawer: breadcrumb, source note, parameter table and raw JSON](docs/images/panel-drawer.png) |

A suite expands to its items, each with a preview and a content button:

![Expanded suite with inline preview](docs/images/panel-manage-expanded.png)

Insights: cross-session first-turn trend (hover → pin → Esc), aggregate band, composition ring,
heaviest suites, session cards and the current session's event timeline:

![Insights tab](docs/images/panel-insights.png)

Settings: presets, channel masters, budget, prefix/suffix, export/import/undo, verification,
preferences, version and language:

![Settings tab](docs/images/panel-settings.png)

The sidebar shows the same snapshot compactly, and the composer carries a one-line chip
(`83.8k · 36%` — first turn, then window occupancy):

![Sidebar panel](docs/images/panel-sidebar.png)

Dark theme follows the host; the composer chip is the ambient entry:

| Dark theme | Composer chip |
| --- | --- |
| ![Dark theme](docs/images/panel-dark.png) | ![Composer chip](docs/images/dock.png) |

Switching the REA suite off moves the first request from 83.8k to 17.1k tokens; Undo brings it back
(real data, interactions recorded against the fixture):

![Demo: suite switch and undo](docs/images/demo.gif)

## What it manages

| Channel | Mechanism | Effect when switched off |
| --- | --- | --- |
| Prompt sections | A session-scoped `system-prompt/assemble` filter drops the named section | That text disappears from the system prompt |
| Runtime contexts | Same filter by name (required entries excluded) | Approval/sandbox snapshots stop entering the first request |
| Skill catalog | A same-name, non-invocable skill registered in the session scope | The skill disappears from the model-visible catalog |
| Tool schemas | `tools.restrict({ deny })` | The definition and parameters are no longer sent |
| Workspace rules | **Read-only display** | — |

Workspace rules (`AGENTS.md` / `CLAUDE.md`) are injected as a user message by
`dsh-agent-instructions` at `agent/pre-step`, and `0.2.2` exposes no public suppression hook. The
plugin never renames, deletes or edits those files: the panel marks them read-only, reports whether
each candidate is actually on the load path, and — in the drawer — shows the exact file content that
is being injected.

Required contexts (working directory, subagent identity) are read-only too; no policy can drop them.

## Suites: switch a whole group

The list groups by suite by default instead of showing hundreds of rows:

- One MCP server is one suite. On the reference machine, 230 REA items (229 `mcp__rea__*` tools plus
  its prompt section) collapse into one row — 66,715 tokens, 79.6% of the first request.
- Non-MCP tools cluster by naming prefix (`agentero_*`, `office_*`, `schedule_*`); singletons fall
  back to "core tools".
- Skills group by provider (for example 33 `filesystem` skills in one group).
- Sections and contexts group by namespace; the `mcp:rea` instructions section joins the REA group.
- A group row shows item count, tokens, share and a tri-state switch; a partially disabled group
  shows the mixed state, and a fully closed suite stays in the list with its remembered size so it
  can be reopened.

## The content drawer

Every row can answer the obvious follow-up: *show me what that actually says.*

- **Prompt text and runtime contexts** — the assembled text, as plain text, with the source noted
  as "assembled from the system prompt" (nothing is re-rendered as HTML).
- **Tools** — the JSON declaration split into a description, a parameter table (name, type,
  required, description) and the raw JSON; one copy button per view.
- **Skills** — the `SKILL.md` body when it can be resolved, otherwise the exact catalog line that
  is injected (and the drawer says which one it is).
- **Workspace rules** — the real file content, with its path.
- Line numbers (toggleable), in-content search with match highlighting and a per-line summary, copy
  full text / copy path, a "content is longer than 256 KB, truncated" notice, Esc to close, focus
  returns to the row you opened it from.

The only paths the host will open are the ones the snapshot itself registered — the request cannot
name a path. Token figures are estimates (ASCII ÷ 4, other characters ÷ 1.6), not tokenizer output.

## Health checks

The manage page opens with a deterministic strip of findings over the current snapshot:

| Code | Meaning | Action |
| --- | --- | --- |
| `heavy-suite` | One suite is ≥25% of the first request (or ≥30k tokens) | Switch that suite off |
| `budget-gap` | The projection is above the saved budget | Open the budget / switch the suggested suite |
| `catalog-truncated` | Skill descriptions are being cut at the catalog line length | Read the affected skill |
| `locked-items` | Items that cannot be switched off are ≥10% of the first request | Switch to the manage list |
| `unknown-window` | No measurement yet, so occupancy is unknowable | (informational) |
| `no-policy` | Nothing has ever been switched off in this workspace | Open settings |
| `empty-catalog` | No skills are collected at all | Open settings |

Severity is `high / warn / info`; up to six rows are shown with a "more" line, and every action
reuses the same `POST /action` the panel uses. Checks are a pure function of one snapshot, so two
refreshes of the same data cannot disagree. Two contract codes (`duplicate-skill`,
`tool-name-collision`) are never emitted: this host build resolves duplicates before the plugin can
observe them, and inventing a finding would be a lie.

## Insights

The 洞察 tab reads `$DSH_HOME/injection-manager/stats.json` (this plugin's own measurements) plus a
bounded durable-log backfill that runs **in the background**: one pass per minute, at most 8
sessions per pass, never awaited by a read. Opening the tab returns what is already recorded and
flags `backfilling: true` while a pass fills in more.

- **Trend** — one stacked bar per session, split by the five channels; 7 days / 30 days / all; hover
  for values, click to pin, Esc to unpin, ←/→ by keyboard. Above 40 points the bars merge into
  overview buckets so a long history does not turn into hairlines. Bars for sessions whose channel
  split is unknown are **striped**, not zeroed.
- **Aggregate band** — sessions measured (shown as measured / known), average and peak first-turn
  tokens, cumulative saved.
- **Per-session cards** — search by id/title/directory, sort by recent / heaviest / most saved,
  current session marked; every card opens that session's row in the manage list or its content.
- **Cross-session composition** — the five-channel ring averaged over sessions that have a channel
  split.
- **Heaviest suites** — the current session's suites by size, with the part the policy already
  switched off drawn lighter.
- **Event timeline** — the current session's policy changes, presets, budget edits, imports, undos,
  compactions and prunes (`events.json`, capped at 300, oldest first in the window).
- **Coverage footnote** — "recorded N of M sessions on this machine; the trend only contains what
  this plugin measured and a bounded log backfill."

## Context window: the denominator this list needs

"Injection 83.8k" cannot tell you whether to switch anything off. The number that can is how much
of the window is left, so the panel takes the denominator from the host's own measurement:

| Number | Source | Meaning |
| --- | --- | --- |
| occupancy 24.6% | `contextPressure` (window from `request/context`, else `ctx.llm.resolveModelInfo().context.contextWindow`) | next request's expected prompt ÷ the model's window |
| 258.4k / 1M | same | used / capacity, with "790.2k left" next to it |
| system 2.4k · tools 77.9k · messages 129.7k | `contextBreakdown` projection | where this request goes, conversation history included |
| compacted 2× · freed 78.4k | `shadowedTokenCount` on `compaction/summary` and `compaction/prune` | what the host already dropped for you |

Past 70% the number turns amber, past 90% red, and the composer chip follows. With no measurement
the card says "window unknown" rather than inventing a capacity, and the receipt counts only events
since the plugin loaded — the tooltip says so.

## Policy semantics

The policy lives in `$DSH_HOME/injection-manager/policy.json`, one file, written atomically.

Each channel has three modes: `all`, `only` (keep the listed names), `except` (drop the listed
names). A single switch in the panel lands in `except`, or removes the entry from an `only` list, so
manual switches and presets never fight each other.

- **Everything** — no policy.
- **Minimal** — identity, persona prefix, and the file/terminal tools only. On the reference machine
  it moves the first request from 84k to 5k tokens.
- **Budget** — enter a target; the plugin greedily picks the largest switchable items and summarises
  them per suite (one row for turning REA off, 130 items), then applies the suggestion on click.
  Required contexts and workspace rules never participate; an unreachable target is reported as
  unreachable instead of silently failing.
- **Custom prefix/suffix** — free text that replaces `deployment:persona-prefix` /
  `deployment:persona-suffix`. Empty means nothing is injected. Both change the prompt prefix and
  therefore cache reuse; the panel says so.

A policy applies at `agent/created` — only to sessions created afterwards. A running conversation is
never rewritten. The panel states whether the current session was created with the policy.

## Control plane, not a replay

[dsh-context](https://github.com/bowenliang123/dsh-context) records what already happened — per-request
composition, file activity, command executions, timing, cost, the multi-agent fleet. It is the best
tool for *"why did the last request cost that"*.

This plugin answers the question **before** the request exists: *what will the next one carry, what
can I switch off, and what does it look like after that?* It never writes to your workspace, every
switch is reversible, and every number either comes from the host's own measurement or says it is an
estimate. Install both if you want the full picture; they do not modify each other.

| | dsh-context | dsh-injection-manager |
| --- | --- | --- |
| Direction | After the fact: requests, events, cost | Before: the next session's first turn |
| Core action | Observe, expand, filter, compare | Observe + **switch, preset, budget**, undoable |
| Granularity | Per request (per-step composition, files, commands) | Per session's first-turn injection (5 channels + suites) |
| Output | Charts and detail | A decision: which suite to drop, what it saves, what the window does |
| Boundary | Multi-agent, files, commands, billing | Only the injection catalog: prompt sections, contexts, skills, tools, rules |
| License | Apache-2.0 | MIT |

## Five entry points

| Entry | Where | What |
| --- | --- | --- |
| Sidebar icon | Left panel list, "Injection" | Opens the panel: 管理 / 洞察 / 设置 |
| Manage tab | Main area | Health, KPI, request strip, suite list, switches, content drawer |
| Composer chip | Under the input | First-turn total and window occupancy, deliberately muted; × hides it, Settings can bring it back |
| `context_injection` tool | Model-callable | Read-only snapshot with a Markdown card; optional `{channel, name}` for one item's content (≤32 KB) |
| `/inject` command | Composer | Text report + one health line; `/inject health`, `/inject minimal`, `/inject all`, `/inject budget 20000`, `/inject apply [20000]`, `/inject undo` |

The model-facing tool is read-only: the model cannot loosen or tighten the policy. Every write comes
from a click in the panel.

## Install

```powershell
dsh plugin add github:IWHBIWHB/dsh-injection-manager
```

Or locally: DSH → Plugins → Add plugin → pick this directory, or
`dsh plugin add D:/path/to/dsh-injection-manager`. Refresh the page; the "Injection" icon appears in
the left panel list.

Upgrading from `dsh-context-preflight` / `dsh-context-injection`: if only an old policy file exists,
it is read once and used as the current policy. Writes always go to
`$DSH_HOME/injection-manager/policy.json`.

Uninstall: remove the plugin like any other; the policy, stats and event files stay in
`$DSH_HOME/injection-manager/` (delete that directory to start clean).

Version support and required APIs: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Plugin configuration

Plugins → dsh-injection-manager → Configuration exposes four presentation and first-run options:

| Setting | Default | Effect |
| --- | --- | --- |
| `dock` | on | Show the "injection 84k · 97% switchable" chip next to the composer |
| `refreshOnFocus` | on | Refresh the panel when the window regains focus |
| `showRawNames` | on | Show the raw key (`harness:identity`) next to the readable label |
| `budgetTokens` | 0 | Initial budget before a policy file exists; 0 = none |

In-panel preferences (Settings tab) are browser-local: content-drawer line numbers and the default
insights range. They are never written to the policy file, so there is exactly one source of truth
for switches.

## Data & privacy

| Path | Content | Written by |
| --- | --- | --- |
| `$DSH_HOME/injection-manager/policy.json` | Channel modes, names, prefix/suffix, budget | Panel actions (atomic write) |
| `$DSH_HOME/injection-manager/stats.json` | One measured row per session, with a per-channel token split | Every snapshot the panel/tool/command builds |
| `$DSH_HOME/injection-manager/events.json` | Append-only event feed, max 300, atomic write | Policy saves, presets, budget edits, imports, undos, compactions |
| Plugin config row | dock / refreshOnFocus / showRawNames / budgetTokens | Plugins → Configuration |
| Browser local storage | Drawer line numbers, insights range, dismissed cards | This browser only |

No network requests, no telemetry, no uploads. Every HTTP route also passes the host's own
Host/Origin admission fence before any route logic runs: an untrusted origin, or a request without
the host-issued browser/API credential, gets a `401`/`403` with an empty body. Only on a host that
does not offer that service is the fence skipped (the routes then behave exactly as in 2.0.0). The
event feed stores only policy and session
metadata: strings are flattened and truncated to 200 characters and the session's prompt text is
never written. The content drawer reads files from disk only when you open it, only for paths the
snapshot registered, and nothing read there is persisted.

## Self-check

The plugin exposes 15 routes under `/plugins/dsh-injection-manager`: 12 read-only GETs, plus three
POST-only endpoints — `/action` changes the policy, and `/boot` + `/registrations` are client
self-reports (a GET on those two returns 405):

| Route | What it proves |
| --- | --- |
| `/ping` | The plugin registered its routes |
| `/summary?session=<id>` | The snapshot the panel renders (`apiVersion: 2`, `healthSummary`, item previews) |
| `/content?channel=<id>&id=<itemId>[&session=<id>]` | Original content behind one row (UTF-8 safe, 256 KB cap, 2 s budget) |
| `/trend?range=all｜30d｜7d&limit=120` | Cross-session first-turn trend + aggregate + coverage + `backfilling` |
| `/events?session=<id>&limit=60` | The session's event feed with its window |
| `/health?session=<id>` | The same checks the health strip shows |
| `/stats` | The raw history file plus coverage/backfill state |
| `/verify?session=<id>` | Re-assembles a live session and returns the **effective** sections, contexts and tool names |
| `/diag` | Client module presence, last application result, how many times the assemble filter ran |
| `/policy`、`/export`、`/locale` | Policy file state, exports, dictionaries |
| `POST /boot`、`POST /registrations` | Client self-reports (in memory only; GET returns 405) |
| `POST /action` | The one policy write path: switch, preset, budget, import, undo (same-origin JSON only) |

The 设置 tab exposes the same verification behind a button.

## Docs

- [Detail](docs/DETAIL.md): the five-minute version of what is measured, what is switchable, and what the new surfaces show
- [Architecture](docs/ARCHITECTURE.md): the four injection channels, the snapshot pipeline, the routes and the data files
- [FAQ](docs/FAQ.md): why `AGENTS.md` cannot be switched off, unreachable budgets, what the content drawer reads, relation to `dsh-context`
- [Compatibility](docs/COMPATIBILITY.md): tested versions, required APIs, upgrade checks
- [Performance](docs/PERFORMANCE.md): measured timings for 355 items, 27 suites, a 230-row expand and the v2 surfaces
- [Security](SECURITY.md): reporting, verifiable boundaries, accepted risks
- [Contributing](CONTRIBUTING.md): local loop, pre-commit checks, release steps (`npm run smoke` runs the pipeline offline)

## Limitations

- `0.2.2` has no ordering API for contributions; the budget is a greedy largest-first heuristic, not
  a global optimum.
- The skill catalog is a pre-step message, so granularity is per-skill (or the whole catalog via the
  `skill` tool).
- User-message channels such as workspace rules and time context cannot be switched off; the plugin
  shows them (and their content) instead of pretending otherwise.
- The insights trend only contains sessions this plugin measured or priced from durable logs; older
  rows have no channel split and render striped.
- UI ships in Simplified Chinese, English, Japanese, Spanish, French, German, Russian and Portuguese;
  adding a language is one JSON file in `locale/`.

## License

MIT
