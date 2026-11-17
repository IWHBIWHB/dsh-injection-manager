# Changelog

## 2.1.0 — 2026-11-18

The focus release. The plugin explicitly does one job — show and manage what a new DSH session
injects — so the token-budget side feature is gone, the manage page stops crowding the list, and
suites are split by where they come from.

### Removed

- **Token budget, everywhere.** The budget KPI card, the budget section on the settings page, the
  `budget-gap` health check and its `set-budget` action, the `/inject budget` and `/inject apply`
  slash commands, the `budgetTokens` plugin config, the `budget` field in `policy.json` and the
  "outside budget" markers in the suite list are all removed. Old policy files that still carry a
  `budget` object keep loading — the field is ignored and dropped on the next write. The word
  "budget" that remains in the UI/docs refers to the 64 KiB AGENTS.md per-file cap and to read
  timeouts, not to a token target.
- **The KPI sparkline** (and its `localStorage` trend copy): the insights tab owns the trend, and
  the sparkline was the tallest thing in the row while saying the least.

### Changed

- **Manage page is fused and denser.** The composition ring and the suite ranking share one
  compact card instead of two tall ones, the KPI row has three cells, the filter bar only appears
  when a filter is active, and the header/health/table spacing is tighter. At 1050×747 the list
  shows about 6 suites instead of 2; at 1440×960 about 14 instead of 8.
- **Suites are split by origin.** The grouped list now renders an "插件 / MCP" section (MCP tool
  namespaces, `mcp:` prompt sections, provider-backed skills) followed by a "DSH 自带" section
  (host prompt sections, runtime contexts, workspace rules, core built-in tools, instruction
  files), each with its suite count. A profile with only one origin keeps the plain list. The
  classification is stamped per item/group as `origin: "plugin" | "builtin"` in `/summary`, next to
  the new effective group counters (`onCount`, `offCount`, `onTokens`, `offTokens`,
  `onSavableTokens`).
- Health checks are unchanged from 2.0.3 semantically: they still read the policy-effective
  projection, a closed suite stops warning about itself, and replaying a switch is a silent no-op.

### Verification

- `node --test` 209/209 (new origin test; budget planner/health tests removed with the feature).
- UI fixture matrix: 0 console errors, 0 horizontal overflow at 560/900/1440 widths, light/dark.
- Layout probe at the user's real panel size (1050×747): 6 fully visible suite rows (before: 2).
- Live QA instance: origin split renders REA under 插件 / MCP and the built-in families under
  DSH 自带; settings page no longer shows a budget section; `/inject` help lists only
  `health / all / minimal / undo`.

## 2.0.3 — 2026-11-17

### Fixed

- **A suite that was switched off no longer keeps asking to be switched off.** The health strip
  measured the all-on snapshot while the panel's KPIs already read the policy-effective projection:
  after closing a suite the strip still showed its `heavy-suite` row (with a "close this suite"
  button) and every click piled another identical step into the undo history. `heavy-suite` now
  reads `groups.onTokens` / `snapshot.effective.totals` / `policy.preview`, so a closed suite drops
  out of the check immediately and the remaining findings are shares of what the next request
  actually carries. The `locked-items` share uses the same effective denominator.
- **The strip refreshes itself after an action.** Every cached v2 read (health, content, events,
  trend) now listens for the `injection-manager:changed` event the action dispatches, so a switch
  cannot leave a stale check — or its action button — on screen until the tab is reopened.
- **Closing a suite from the strip closes all of it.** `switch-group` now carries `parts[]` — every
  `channel + group` the suite spans, e.g. an MCP server's tools plus its prompt section — and the
  panel executes all of them in one `groups` action instead of the first channel only.
- **Replaying an already-applied switch is a silent no-op.** `POST /action` compares the policy
  before writing: an unchanged result answers `changed: false` and writes no undo step, no event row
  and no toast. The duplicate "已关闭 …" undo entries can no longer accumulate.
- `/inject health` (and the model-side text report) now prints the `groups` action with every
  channel of the suite, matching what the panel button executes.
- Docs updated (README EN/ZH, DETAIL EN/ZH, ARCHITECTURE) to state that checks read the effective
  projection, actions cover every channel of a suite, and repeated switches are silent.

### Verification

- `node --test` 213/213 (6 new tests: effective health basis, multi-channel action payload,
  all-on vs effective group counters, idempotent replay, a snapshot → close → health regression, and
  the multi-channel `groups` suggestion text).
- Live QA instance: a `core` suite at 38% of the first turn was closed from the health strip; the
  strip re-rendered on its own with the remaining suite measured against the smaller turn, the
  closed suite reported `onTokens: 0`, and the replay answered `changed: false` with the undo depth
  unchanged. `policy.json` and `events.json` were restored byte-for-byte after the run.
- UI fixture matrix re-run: 0 console errors, 0 horizontal overflow.

## 2.0.2 — 2026-11-17

### Docs

- **Re-shot documentation media without private host content.** The screenshots and the demo GIF
  were captured against a real DeepSeek Harness instance, so the host sidebar carried real session
  titles (one of them an internal address), and the settings card carried a session id plus a local
  policy path. Those regions are now pixel-masked in every shipped image; nothing else changed.
  No plugin code, route, locale or contract changed in this release.

## 2.0.1 — 2026-11-17

### Security

- **Every HTTP route now passes the host's own admission fence first.** All 15 registered
  route handlers are wrapped at registration time (`makeFencedHandler`): a request asks
  `ctx.connection.requestRejection(req)` before any route logic runs, so a Host/Origin the
  host does not trust — or a request without the host-issued browser/API credential — is
  answered with the host's `403`/`401` and an empty body. The rejection happens before any
  JSON, file or policy data is read, so nothing leaks; the response still carries the usual
  `nosniff` / `no-referrer` / frame-deny / `no-store` headers.
- **Compatible degradation, not a new hard dependency.** `connection` is not added to the
  plugin's `inject` list: on a host without the service (older DSH, or before it is available
  during boot), without a `requestRejection` method, or when the call throws, the fence is
  skipped and the routes behave exactly as in 2.0.0. A security fence must never turn the
  panel into a blank page.
- Write actions keep their own same-origin check on top: `POST /action` requires a JSON
  content type, a non-cross-site `sec-fetch-site`, and a matching `Origin` when one is sent.
- New tests cover the fence paths: service missing → pass-through, `401`/`403` → handler not
  executed and response ended, `undefined` → pass-through, thrown error → pass-through; the
  registration path is covered route-by-route (15/15 fenced) and the old-host path still answers.
  11 new tests, `node --test` 207/207 green; `npm run smoke` green.

## 2.0.0 — 2026-11-16

The control-plane release: the panel now shows what the next request carries, what can be
switched off, **and what each item actually says** — with a cross-session trend and a health
strip that turn the numbers into decisions. Everything new is read-only; switching stays a
human click.

### Breaking / contract

- **HTTP contract is v2.** `GET /summary` now returns `apiVersion: 2`, `healthSummary`
  (`{high, warn, info}`) and an optional `preview` (≤180 chars) on each item. New fields are
  additive, but the panel feature-detects the version: a v2 panel against a v1 server shows a
  dismissible gate card ("this surface needs a v2 host") instead of silently hiding tabs. A v1
  panel against a v2 server keeps working.
- **Four new read-only GET routes:** `/content`, `/trend`, `/events`, `/health` (same prefix as
  the existing routes). `/content` is the only route that opens a file, and only paths already
  registered by the snapshot collection.
- **New durable file `events.json`** (`$DSH_HOME/injection-manager/`, version 1, cap 300,
  atomic tmp+rename, dedupe): an append-only feed of policy changes, presets, budget edits,
  imports, undos, compactions and prunes. `stats.json` rows recorded from 2.0.0 on also carry a
  per-channel token split (`channels`); old rows keep `channels: null` on purpose.
- **Model tool grew a single-item mode.** `context_injection` accepts optional
  `{channel, name}` and then returns just that item's original content (≤32 KB). Calling it
  without arguments still returns the whole snapshot. `/inject health` was added, and the bare
  `/inject` report now ends with one health line.

### Added

- **Content drawer.** Press "content" on any row and read the original bytes behind it: prompt
  section text, runtime-context snapshots, a tool's JSON declaration (description / parameter
  table / raw JSON), a skill's `SKILL.md` body or its catalog line, an instruction file. The
  drawer shows the source path, a byte/char/token meta line, line numbers (toggleable), in-content
  search with match highlighting and a per-line match summary, full-text copy and path copy, a
  truncation notice when the 256 KB cap hits, Esc-to-close and focus restoration. Everything is
  rendered as plain text — no `dangerouslySetInnerHTML` anywhere.
- **Health strip on the manage page.** Deterministic, read-only checks over one snapshot:
  `heavy-suite`, `budget-gap`, `catalog-truncated`, `locked-items`, `unknown-window`, `no-policy`,
  `empty-catalog`. Severity rows with the saved-token delta, up to six visible plus a "more"
  line, and one-click actions that reuse the existing `POST /action` (`switch-group`,
  `set-budget`, `open-content`, `open-tab`). The strip only fetches while the tab is visible.
- **Insights tab.** Cross-session first-turn trend as stacked channel bars (7 days / 30 days /
  all; hover for values, click to pin, Esc to unpin, ←/→ by keyboard; more than 40 points merge
  into overview buckets; rows whose channel split is unknown are striped), an aggregate band
  (sessions measured, average, peak, cumulative saved), per-session cards (search, sort by
  recent / heaviest / most saved), a cross-session composition ring, the heaviest-suite ranking
  for the current session, the current session's event timeline (12 event kinds, capacity note)
  and a coverage footnote that states what the trend does and does not contain.
- **Inline previews.** Rows expand a `preview` paragraph without leaving the list; the drawer is
  only for the full content.
- **Preferences** in the settings tab: content-drawer line numbers and the default insights
  range. They live in this browser and are never written to `policy.json`.
- **Version card** in the settings tab: plugin version, host version with its tested baseline,
  HTTP api version and the UI language; links to the full DETAIL page in the current language.
- **Eight-language coverage** for all new strings: +182 keys per locale (zh/en/ja/es/fr/de/ru/pt),
  372 client keys per language.

### Changed

- The middle tab is now **洞察 (Insights)** instead of a plain history list. It still reads
  `stats.json`, but the numbers are aggregated for comparisons and each point states its source
  (measured vs priced from durable log) and coverage.
- The manage page leads with health → KPI → request strip; the table keeps suite clustering and
  per-switch tri-state, and every row can now reveal its content.
- `stats.json` history is described the same way everywhere: measured rows plus a durable-log
  backfill that runs in the background (one pass per 60 s, ≤8 sessions), never a replay of every
  session and never a wait on a read.
- `screenshots.json` lists the v2 screens. README/README.zh are rewritten around the four
  surfaces and the control-plane positioning.

### Fixed

- Content reads cannot hang or flood: 2 s per request, 256 KB response cap (32 KB for the model
  tool), UTF-8-safe truncation that never splits a code point, and a whitelist restricted to
  paths the snapshot itself registered.
- The event feed is crash-safe and idempotent: a suppressed write can never turn a saved policy
  into an error, duplicate keys keep replayed host events from becoming two rows, and params are
  flattened and truncated so prompt text cannot leak into the file.
- Health checks are reproducible for one snapshot (the only clock value is
  `snapshot.generatedAt`); the two codes this host build cannot observe (`duplicate-skill`,
  `tool-name-collision`) are never emitted rather than invented.
- **Opening the insights tab no longer waits on the durable-log backfill.** The backfill became a
  background single-flight pass (one per 60 s, ≤8 sessions, 6 s budget) and the read returns the
  already-recorded rows immediately with `backfilling: true`; on a 671-session corpus the old
  synchronous pass made `/trend` take 7.1 s per poll and `/stats` 2.1 s, both now in the
  millisecond range.
- `trend.points[].scope` is a free string (commonly `startup｜clear｜route.session｜backfill`,
  unknown values pass through, capped at 64 chars) and `policy` accepts `unknown` — the contract
  was revised to fit the honest v1 data instead of rewriting history.
- An older server now shows a dismissible gate card instead of a tab that silently disappears.

### Migration

- Nothing to do for existing installs: `policy.json` keeps its v1 shape, `stats.json` stays
  readable (older rows show an unknown channel split), and `events.json` is created on the first
  event.
- If you script against `/summary`, accept the new fields — no legacy key was removed. Anything
  that pinned the old tab labels should use the new `管理 / 洞察 / 设置` set.

## 1.14.0 — 2026-11-17

- **The panel is three tabs, and the summary moved out of the working list.**
  管理 is now only what you act on (suite donut, bars, toolbar, table); the KPI
  row, the request strip and the skills card live in 统计 under 当前会话, followed
  by 历史记录. Four tabs (清单/策略/预算/说明) became 管理/统计/设置, with the old
  ones folded into 设置 and stale stored tab ids mapped, so nothing opens blank.
- **统计 measures real history.** It lists every conversation the host knows about
  (`sessionQuery.listSessions()`, a header-only read) and fills numbers in for the
  ones it can: measured sessions come from this plugin's own snapshots, and older
  ones are priced from their durable log — `request/header` tool declarations plus
  the `system/message` prompt — a bounded 8 sessions per open, cached in
  `$DSH_HOME/injection-manager/stats.json`. The footer states the coverage
  honestly ("N of 664 conversations measured").
- Skill tokens are shown as "—" for log-derived rows: the skill catalog arrives as a
  pre-step user message whose `source` is null in the durable record, so claiming a
  number there would be a guess.
- Screenshots and the demo GIF regenerated for the new layout; `screenshots.json`
  now lists panel-stats instead of the retired budget/policy images.
- 2 new sections and 20 new keys across 8 locales.

## 1.13.1 — 2026-11-17

- **The list toolbar got un-crowded.** Nine controls in one row became: scope,
  search, group/flat, a channel `<select>` and three small view toggles. The
  channel chips only appear as a removable "筛选：技能目录 ×" row when a filter is
  actually on, so the idle toolbar is quiet and the active state is still visible.
- The select and the view toggles collapse at narrow widths instead of wrapping
  into a second line that shoves the table down.
- 2 new locale keys × 8 languages.

## 1.13.0 — 2026-11-17

- **Skills vs MCP tools, side by side.** The skills card now shows all four kinds of
  line item (skills / tool schemas / prompt text / workspace rules) with their
  shares, and one sentence that answers the obvious follow-up: tool schemas are not
  skills — each MCP tool is its own JSON declaration, and on the reference machine
  they outweigh the whole skill catalog by 75.9k to 3.0k.
- **A closed suite no longer disappears.** The policy removes its rows from the
  assembled prompt, so the list used to have nothing left to show — the suite
  vanished and its switch with it. Closed suites now stay in the list with an
  已关闭 badge and their remembered size; their switch restores the exact names the
  policy excludes, per channel. A closed row reads "—" instead of a share above
  100%.
- **Two explicit scopes.** 默认策略 = what a session created right now would receive
  (the policy view, and the default); 本会话 = what the conversation on screen is
  actually sending, measured by the host. A policy never rewrites a live session, so
  both are true at once — the reader now picks which question they are asking
  instead of guessing from a single mixed table.
- 7 new locale keys × 8 languages.

## 1.12.0 — 2026-11-16

- **The plugin now leads with why people install it: collected skills.** A
  dedicated card sits under the KPI row — how many skills are in the catalog, their
  total tokens and share of the first request, the average per skill, the providers
  they come from and the single heaviest entry. "去管理" filters the list straight
  to that channel, so the answer to "why is my prompt so big" is one click away.
- The model-facing card gained the same line first ("技能目录：38 个技能共 3.0k
  token，占首轮 3.6%…"), because a user who collected a hundred skills is exactly
  the user whose agent should be able to say that out loud.
- README now opens with the collection problem before any feature list.
- New snapshot field `skillsState.{catalogTokens,catalogShare,averageTokens,providers,heaviest,topProviders}`.
- 7 locale keys × 8 languages; the narrow sidebar stacks the card's header.

## 1.11.1 — 2026-11-16

- **The model-facing tool now says what to do with the numbers.** `context_injection`
  gained a "能做什么" block: the biggest switchable suite and what it saves, whether
  this session predates the policy, what compaction already removed (irreversible),
  and the fact that the tool cannot flip switches itself. A model that reads only
  that block can give its user the one action that matters.
- **README opens with the three facts an agent needs** (what it measures, why it is
  safe, that one suite is usually the whole win) before any screenshot.
- `docs/DETAIL.md` and `docs/DETAIL.zh.md` are real pages instead of a stray image:
  the two-numbers model, what each channel physically is, when a policy applies,
  and what happens when a piece is missing.
- npm description rewritten without the mojibake and with `context-window`,
  `compaction`, `occupancy` keywords; awesome-listing draft updated to match.
- 3 new tests for the advice block — 69 total.

## 1.11.0 — 2026-11-16

- **The denominator exists.** Occupancy is now measured, not guessed: the panel
  reads the host's own `contextPressure` projection (the next request's expected
  prompt) and divides it by the model's window, so the strip can say "53% of the
  window, 118k left" instead of leaving the user to compare two absolute numbers.
  The window comes from `request/context`; before the first request it falls back
  to `ctx.llm.resolveModelInfo().context.contextWindow` (cached per route). When
  neither exists the card prints 窗口未知 — it never invents a capacity.
- **Where the window goes.** A new card stacks the next request as system / tools
  / messages against the window (from the `contextBreakdown` projection), colours
  the bar amber at 70% and red at 90%, and labels the estimate as an estimate.
- **Compaction receipts.** A `session/event` listener folds `compaction/summary`
  and `compaction/prune` into "压缩 2 次 · 释放 78.4k" — the log already carries
  `shadowedTokenCount`, so this is a fact rather than an inference. Receipts cover
  events since the plugin loaded, and the tooltip says so.
- KPI cards are four equal columns at an 8px radius; the sparkline spans the card
  and carries an `aria-label` with its min/max; every chart is `role="img"`.
- **Fixed: every share now uses one denominator.** Closing a suite left the
  largest-suite bars and the table's 占比 column quoting shares of the all-on
  total, so a closed REA row read "390.4%" next to a 17.1k first turn. The bars
  keep their all-on width (a closed giant still looks like a giant) but fill only
  what the policy left on and read 已关闭; rows share the effective total, and an
  off row shows the tag instead of a meaningless percentage.
- The dock chip shows the window percentage (red past 90%) and falls back to the
  savable share when no window is known.
- New icon: the same three bands narrowing into one dot, drawn as gradients at
  36×36 so it survives a 20px sidebar. `assets/icon-512.png` is regenerated from
  the same geometry.
- **A name, once.** The sidebar entry is now 上下文注入 (was 注入) so it reads as
  a sibling of 上下文洞察; the page heading and the marketplace name stay
  上下文注入管理, and every locale got the same split between the short entry and
  the full product name.
- **Less air at the top.** The window card became one strip line — bar, room
  left, system/tools/messages — under four tighter KPI cards; a tall card holding
  a 24%-full bar is gone. In the narrow sidebar the strip reflows to
  label + remaining, a full-width bar, then the legend.
- The four tabs are a segmented control (a pill track with the active tab
  raised), matching the 分组/平铺 control instead of floating underlined text.
- 13 new tests (pressure, compaction, window rendering) — 66 total.

## 1.10.9 — 2026-11-16

- The Items tab opens with a visual overview: an SVG donut of the per-channel
  composition (center = effective total), the largest suites as proportion bars,
  and a first-turn sparkline in the total KPI. Hand-rolled SVG/CSS, no chart
  dependency — the same technique dsh-context uses for its dashboard.
- Eight locales gained `topSuites`; screenshots regenerated.

## 1.10.8 — 2026-11-16

- Sorting moved into the table headers, like a normal data grid: 条目 / 通道 /
  token / 占比 are clickable, show ▲▼ (or ↕ when inactive) and `aria-sort`.
  The toolbar chips are gone; the choice persists as `key:dir`.
- Fixed the direction: descending token order was inverted (zero-token suites
  came first). Suites and flat rows share the same comparator.
- Screenshot fixture now reads `/summary` and `/locale` live, so regenerated
  images cannot ship untranslated keys.

## 1.10.7 — 2026-11-16

- Suites are merged by label across channels: REA's 229 MCP tools and its prompt
  section are now one row (`REA · 230 条目 · 多通道 · 66,715`) instead of two rows
  sorted far apart. Toggling it dispatches a new bulk `groups` action, so one
  switch turns the whole suite on or off.
- The footer now reports effective totals and merged group counts (`27/35 组`).
- Route test covers the bulk action; the fixture understands `groups`.

## 1.10.6 — 2026-11-16

- The top strip now always shows the **policy view**, in real time: 首轮注入 and
  可关闭 are the composition after the current policy (17.1k / 14.6k when REA is
  off), the bar + legend use the same per-channel numbers, and the third card
  became 全开时 (the un-policied baseline) so the comparison is explicit.
  Previously the strip showed the session's assembled prompt, so closing a suite
  changed only "策略后" and looked like a stale refresh.
- Footer totals follow the same effective view; snapshots expose
  `effective.channels` / `effective.totals`.

## 1.10.5 — 2026-11-16

- First registry release: `npm i dsh-injection-manager` installs 1.10.4 (54 files,
  894,925 bytes). The npm badge is on both READMEs.
- Release workflow now publishes through npm **trusted publishing (OIDC)**:
  `id-token: write`, npm upgraded in the job, no `NPM_TOKEN` secret. Configure the
  trusted publisher in the package settings once (repo `IWHBIWHB/dsh-injection-manager`,
  workflow `release.yml`), then a `v*` tag releases with provenance.

## 1.10.4 — 2026-11-16

- When the current session was created before the saved policy, the panel now
  says so under the KPI strip: "本会话在策略保存前创建，不受新策略影响；「策略后」是
  下一个新会话的预估。" Previously only the Notes tab mentioned it, so a switch
  that changed "策略后" but not "首轮注入" looked like a refresh bug.
- Eight locales gained `sessionNotApplied`.

## 1.10.3 — 2026-11-16

- Fixed "I switched it off but the panel still shows the old numbers": the panel's
  snapshot fetch used a single in-flight flag, so a poll that started before your
  click could swallow the fresh reload, leaving the old summary until the next
  poll. Responses now carry a sequence ticket and only the newest one is applied,
  so a post-write reload always wins.

## 1.10.2 — 2026-11-16

- Fixed the plugin metadata error `ENOENT ... D:\DSH\dsh-context-injection\locale\de.json`:
  the profile kept a junction `node_modules/dsh-context-injection` pointing at the
  directory's pre-rename location. The junction is gone; the only link now points
  at `D:\DSH\dsh-injection-manager`.
- Repaired the mojibake in `package.json`'s description (two `??` where the em
  dashes were) that came from an early PowerShell edit.

## 1.10.1 — 2026-11-16

- Fixed the "switched-off suite becomes unfindable" bug: items that leave the
  assembled prompt because the policy excludes them are remembered (per agent
  and by name across agents) and listed again under 「已关闭」 with their size and
  a 「恢复整套」 button. Restoration goes through a new `names` action, because
  item/group toggles cannot address names the assembly no longer contains.
- The item list also gained sorting: 按 token / 按名称, applied to both flat rows
  and suite order, remembered per browser.
- The closed-index used the wrong policy shape (`policy.channels` instead of the
  flat `policy.<channel>`), which is why it always came back empty; two new tests
  cover a tool disappearing between builds and the cross-agent name memory.

## 1.10.0 — 2026-11-16

- The composer chip is quieter: muted text with a dot, no border until hover,
  `83.8k 97%` instead of `注入 83.8k · 可关闭 97%`, plus a hover × to hide it.
  Hiding is per browser (localStorage) and the Notes tab can switch it back on.
  The chip now carries its own stylesheet — it used to render as a native
  button because the panel's `<style>` only mounted with the panel.
- The panel refreshes itself: a silent `/summary` poll every 5 s (chip: 15 s)
  while the page is visible, paused when hidden, plus an immediate broadcast on
  every write. A policy changed by `/inject`, another window or a plugin reload
  now shows up without pressing 刷新.

## 1.9.10 — 2026-11-15

- Corrected a stale limitation line: sections are filtered through the scoped
  `system-prompt/assemble` waterfall, not "shadowed with an empty same-name
  section" (that was the first approach and it threw).
- README version callouts updated to 1.9.9 with the current feature list.

## 1.9.9 — 2026-11-15

- Both READMEs gained a "60-second tour" / 「60 秒演示」: five steps with the
  expected numbers, including the part people misread (an existing session is
  not affected by a policy saved later).

## 1.9.8 — 2026-11-15

- "最近一次应用" now says what the policy actually did to each channel:
  `段落 2/25 · 上下文 0/9 · 技能 0/38 · 工具 9/280`. Counts are recorded in the
  apply report via a shared `countChannelState()`, with three unit tests.
- Real check: a new agent created under the minimal preset reported
  `sections 2/25, contexts 0/9, skills 0/38, tools 9/280, saved 78,799`; the
  policy was then restored to `all` with undo.

## 1.9.7 — 2026-11-15

- Item list shows what the current budget plan would switch off: a small
  "预算外" tag per row and "129 预算外" on the suite header, so the list and the
  budget page tell the same story. Tags only appear when a budget target is set.
- Eight locales gained `outsideBudget` / `outsideBudgetHint`; a one-line
  formatting glitch in `groupLabelOf` was tidied while nearby.

## 1.9.6 — 2026-11-15

- The Policy tab now warns before a preset switch replaces manual choices:
  "当前有 229 项手动关闭；切换预设会重算并覆盖这些选择。" The count comes from
  a shared `excludedCountOf()` used by both the policy and budget pages.
- FAQ says presets behave the same way as applying a budget.

## 1.9.5 — 2026-11-15

- Budget page warns before it overwrites manual choices: "当前有 N 项被手动关闭；
  应用建议会按预算重算，并覆盖这些选择。" with the real count (229 after one
  REA switch in the fixture).
- FAQ explains that applying a budget recomputes instead of stacking, and what
  to do if you want to keep manual exclusions.

## 1.9.4 — 2026-11-15

- The render boundary now shows what failed, offers Reload and Copy error, and
  says the error is recorded at `/diag` (and that `/inject` still works) instead
  of printing a bare message. Its copy is bilingual on purpose: the boundary can
  render before locale data loads.
- Empty list: "没有匹配的条目" plus a Clear filters button that resets search,
  channel and the switchable-only filter in one click.
- Eight locales gained `noMatch` / `clearFilters`.

## 1.9.3 — 2026-11-15

- Budget page: quick targets (24k / 48k / 80k), a sort switch for the suggestion
  list (by tokens / by suite name, remembered), and a plain "还有 N 组未列出"
  instead of a bare `+N`.
- Real host check: setting 24000 yields `plan.after = 23945`, 147 drops in 7
  groups; clearing the budget returns to 0 drops.

## 1.9.2 — 2026-11-15

- Keyboard: `/` focuses the search box from anywhere outside a text field.
- The item list exposes `role="group"` with a count label, so screen readers
  announce "条目 · 352" instead of an unnamed region.
- Accessibility sweep over all four tabs (headless Chromium): 0 buttons without
  an accessible name, 0 unlabeled inputs, 0 switches without a name, proper
  `aria-pressed` / `aria-expanded`, H1 → H2 heading order.

## 1.9.1 — 2026-11-15

- The tool/command text report ends with `宿主 DSH … · 撤销栈 N 步 · 策略文件 …`,
  so a pasted report carries the host version, undo depth and policy path.
- Both READMEs gained "At a glance" / 「能力一览」: nine capabilities and where to
  find each one.

## 1.9.0 — 2026-11-15

- Host compatibility probe: the plugin reads the running DSH version
  (`DSH_INSTALL_DIR`, then `@deepseek-ai/dsh` from the profile) and shows a
  banner when it is older than the tested 0.2.2. Unknown versions stay unknown.
  `/diag` exposes `host`, `/summary` carries it to the panel.
- Three `hostinfo` tests cover rc suffixes, a newer manifest and an unknown host.

## 1.8.8 — 2026-11-15

- Restoring an earlier step now asks once ("确认回退？" / Cancel): it discards
  newer history, so a stray click should not be enough.
- Eight locales gained `confirmRestore` / `cancel`; the demo GIF was re-recorded
  with the corrected custom-preset label after a suite switch.

## 1.8.7 — 2026-11-15

- Multi-step undo: the Policy tab lists the last 20 remembered steps with their
  label and time, and a Restore button jumps back to any of them (discarding the
  newer ones). `/summary` exposes `undo.entries`; a new `restore` action drives
  it. Restoring does not push a new history entry — it is an undo.
- Route test covers two actions, the entry list, restore-to-first and an empty
  history afterwards.

## 1.8.6 — 2026-11-15

- Undo history entries carry the action label, so the footer button reads
  "撤销上一步 · 已关闭 REA · 229 条目" instead of a bare button. The label comes
  from the client (already localized) with a server-side fallback for API calls.
- `/summary` exposes `undo.last` / `undo.lastAt`; route tests cover the fallback.

## 1.8.5 — 2026-11-15

- Toasts now say what happened: "已关闭 REA · 229 条目" with Undo, instead of a
  generic "已写入". Item, group, channel and preset actions each carry their own
  message; undo says "已撤销".
- Eight locales gained `turnedOn` / `turnedOff` / `undone`; the demo GIF was
  re-recorded.

## 1.8.4 — 2026-11-15

- "Switchable only" filter in the item toolbar: hides read-only entries
  (workspace rules, required contexts), 34 groups become 31 on the reference
  snapshot. The footer shows `31/34` while the filter is on, and the choice is
  remembered like the view mode.
- Eight locales gained `onlySwitchable` / `onlySwitchableHint`.

## 1.8.3 — 2026-11-15

- The Notes tab now carries the effective-assembly check: one button calls
  `/verify`, shows whether this session was created with the policy, and prints
  the effective section/context/tool counts next to the panel's own numbers.
- Eight locales gained the `verify*` keys; the about screenshot was refreshed.

## 1.8.2 — 2026-11-15

- Search highlights the matched substring in group labels and item names.
  The helper is named `HitMark` on purpose: `Highlight` is a DOM global (CSS
  Custom Highlight API), and the first version crashed every row by shadowing
  it — caught while verifying with real page errors, not by reading the code.

## 1.8.1 — 2026-11-15

- The success toast now carries an inline Undo for six seconds, so a mistaken
  suite switch can be reverted without scrolling to the footer.
- Policy tab: Copy report (clipboard), next to export/import; the settings
  screenshot was regenerated with the new buttons.
- Eight locales gained `copyReport` / `copied` / `copyFailed`.

## 1.8.0 — 2026-11-15

- Policy import: the Policy tab accepts a JSON file — either a bare policy or a
  whole exported manifest — validates it, writes it atomically, and records it
  on the undo stack, so an import can be reverted with one click.
- Action bodies may be up to 1 MiB so an exported manifest can be pasted back;
  imports that are not objects are rejected with `invalid-policy`.
- Route tests cover bare policy, exported manifest, undo after import and the
  invalid shape.

## 1.7.0 — 2026-11-15

- `/inject apply [tokens]`: turn the current (or given) budget into a policy from
  the terminal, with the per-suite summary in the reply.
- `/inject undo`: revert the last policy write from the command line.
- Command writes now share the panel's undo history. The new command tests
  caught that they previously bypassed it, so `/inject undo` after
  `/inject apply` used to fail with "nothing-to-undo".
- Six command tests cover budget, apply, undo, an already-fitting target and
  unknown subcommands.

## 1.6.1 — 2026-11-15

- The group/flat view and the selected tab persist across reloads (localStorage,
  per browser). Private windows fall back to the defaults.
- The fourth KPI now answers "how big is the first request next to the whole
  session": `697.6k` with `占本会话 12%` instead of a bare "not comparable" note.
- Screenshots and the demo GIF re-recorded with the new toolbar and KPI.

## 1.6.0 — 2026-11-15

- The KPI shows the preset by name (全开 / 极简 / 自定义 / Everything / Minimal)
  instead of the raw id, and carries the saved percentage when a policy is active.
- Group view gained 展开全部 / 折叠全部; the toolbar now reads search → view mode
  → channel filter → expand controls.
- Tried a per-row size bar behind each row; it read as stray underlines, so it
  was removed before release rather than shipped as decoration.

## 1.5.1 — 2026-11-15

- Budget suggestions are summarised per suite: a 130-item "turn REA off"
  suggestion is one row instead of a flat list of 147 items, and the same suite
  is never listed twice across channels. The plan still applies item names, so
  applying it remains a normal policy write.

## 1.5.0 — 2026-11-15

- `npm run smoke`: runs the whole snapshot pipeline against a fake context and
  prints the text report, so the plugin can be sanity-checked without DSH. CI
  runs it too.
- SECURITY.md: reporting channel, verifiable boundaries (no eval, no network,
  no workspace writes), accepted risks.
- GitHub issue templates (bug / feature) and a pull-request template ask for the
  `/diag` fields and the locale-key check that actually matter.
- Locale parity is now tested: every language must match English's key paths,
  have non-empty values, keep identical `{placeholders}`, and ship its detail
  document.

## 1.4.1 — 2026-11-15

- Market screenshots extended to six: suites, budget, policy, sidebar, settings
  and the dark theme; `screenshots.json` updated.
- `docs/PERFORMANCE.md`: measured timings on the real 352-item snapshot
  (panel ready 168–240 ms, 229-row expand 61–120 ms, search 37–54 ms) and the
  conclusion that a virtual list is unnecessary.
- README shows the dark theme and links the performance page.

## 1.4.0 — 2026-11-15

- Security: JSON responses carry `nosniff` / `DENY` / `no-store`; writes also
  check that a present `Origin` matches the serving host (on top of the
  `sec-fetch-site` and JSON content-type checks). Covered by tests.
- Release pipeline: `.github/workflows/release.yml` runs on `v*` tags, verifies
  the tag matches `package.json`, runs the full suite, checks the pack contents
  and publishes to npm with the `NPM_TOKEN` secret (provenance enabled).
- CONTRIBUTING.md: local loop, pre-commit checks, design constraints, release.
- Search input is deferred (`useDeferredValue`) so typing stays responsive on a
  350-row table.

## 1.3.1 — 2026-11-15

- Integration tests: a fake context drives `applyPolicyForAgent` through all
  four channels; route tests cover suite toggles, undo, export and the
  cross-site guard (27 tests total).
- Docs: architecture (channels, snapshot pipeline, apply timing) and a FAQ.
- README demo GIF: switching the REA suite off and undoing it, recorded from
  the fixture against real snapshot data.

## 1.3.0 — 2026-11-15

- Eight UI languages: Simplified Chinese, English, Japanese, Spanish, French,
  German, Russian and Portuguese. The panel follows the browser language, and
  the host locale service receives every dictionary, so switching the
  application language works too. Units (`chars`/`items`/`groups`, the AGENTS.md
  chain line, the "required" badge) are localized instead of hard-coded.
- New screenshot of the Policy tab, now listed in `screenshots.json`.

## 1.2.1 — 2026-11-15

- Accessibility: visible `:focus-visible` rings on every control, `role="alert"`
  for failed actions and `role="status"` for confirmations, Escape closes the
  sidebar panel, transitions respect `prefers-reduced-motion`, and the read-only
  badge got a higher-contrast colour.
- Policy tab: fixed-height text areas instead of stretching to the card.

## 1.2.0 — 2026-11-15

- Export the manifest: `GET /plugins/dsh-injection-manager/export?format=md|json`
  and two buttons in the Policy tab. Markdown for a ticket, JSON for comparing
  two machines; same snapshot as the panel.
- Text rendering tests (suite list, missing instruction files, session anchor).

## 1.1.0 — 2026-11-15

- Undo: every policy write remembers the previous policy (20 deep), so a whole
  229-item suite switch is one click away from being reverted. The panel shows
  an Undo button whenever history is available.

- Plugin configuration card (Plugins → Configuration): hide the composer chip,
  refresh on window focus, show raw key names, and seed a first-run token budget.
  The plugin keeps working when the schema library cannot be resolved (Config is
  then omitted instead of failing activation).
- The panel now reports a failed switch instead of silently doing nothing, and
  confirms a successful write briefly.
- Settings loader is covered by unit tests.

## 1.0.1 — 2026-11-15

- Renamed to `dsh-injection-manager` (from the 1.0.0 development name
  `dsh-context-injection`, itself from `dsh-context-preflight`). The name owns
  the "injection" word — DSH's own tool is `context_injection` — instead of
  competing with 83 `context-*` plugins. Old policy files are still imported.
- README: install command in the first screen, CI/license/dsh badges, three real
  panel screenshots, `screenshots.json` for the plugin market, and a
  compatibility document.
- CI workflow: syntax check + unit tests on Node 20/22 + bundle metadata check.
- Policy data directory is now `$DSH_HOME/injection-manager/`; both earlier
  locations are read once on first upgrade.

## 1.0.0 — 2026-11-15

First release under the new name and package id `dsh-injection-manager`
(previously developed as `dsh-context-preflight`).

- One snapshot of the first request: prompt sections, runtime contexts, skill
  catalog, tool schemas and the workspace-rule chain, each with characters and
  estimated tokens.
- Suites: entries cluster into switchable groups (one MCP server = one suite,
  otherwise shared naming prefixes, skills by provider, sections/contexts by
  namespace), so 229 REA tools become a single switch with a tri-state state.
- Per-item switches, per-channel master switches, `all` / `only` / `except`
  modes, two presets, a greedy token budget and custom persona prefix/suffix.
- Effects are session-scoped registrations: prompt sections and runtime
  contexts through a scoped `system-prompt/assemble` filter, skills by shadow
  registration, tools through `tools.restrict`. No user file is read or
  written.
- Read-only model tool `context_injection`, `/inject` command, sidebar icon,
  composer chip, management page, and a `/verify` route that re-assembles a
  live session to prove the policy landed.
- Policy is imported once from `dsh-context-preflight` when only the old file
  exists.

### Fixed compared with the pre-1.0 development line

- Never renames `AGENTS.md` or rewrites `SKILL.md`; disabling a rule no longer
  mutates the workspace.
- Required runtime contexts (working directory, subagent identity) can no
  longer be dropped by a policy.
- Section/context exclusion no longer fails with "already registered in this
  scope" (agent presets own those names); it uses the scoped assemble filter.
- One implementation of the preview math, so the panel and the applied policy
  cannot disagree.
- Policy writes are atomic and per-action; two open panels cannot overwrite
  each other's switches.
- Cross-site POSTs are rejected; the action API requires same-origin JSON.
