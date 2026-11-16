# Changelog

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
