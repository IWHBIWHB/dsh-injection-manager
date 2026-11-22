# Changelog

## 3.0.5 — 2026-11-22

### Fixed

- **Tool rows understated their own tokens by about half.** A tool schema was measured from
  its description only; the `parameters` JSON — most of the tokens — was never counted, so a
  328-tool request read ≈41k while the host-side measurement of the same tools is ≈85k. The row
  now measures `name + description + parameters` (the serialized schema) while the preview keeps
  showing the human description; the measurement text is not persisted to `ledger.jsonl`.
- The ledger total now sits on the same scale as the 洞察 page instead of being a second,
  quieter number.

### Verification

- New test: a schema with parameters measures larger than its description alone, the stored
  preview never contains raw JSON, and `measureText` is stripped before persisting.
- 165 tests / 0 fail.

## 3.0.4 — 2026-11-22

### Fixed

- **The ledger tab clipped its own content.** `.ci-ledger` was a shrinkable column
  (`flex:1 1 auto` with `min-height:0`) inside a `height:100%` wrapper, so a real
  328-tool request was squeezed into the viewport: item rows and group headers were
  cut in half and the tab body never scrolled. The ledger now sizes to its content
  and the tab body scrolls normally; the request list keeps its own 220px scroll.
- **Tool owners resolved for the long tail of host tools.** Owners now come from a
  generated map of every `tools.register(defineTool({ name }))` site in the shipped
  harness sources (67 tools: MCP resource endpoints, workspace dependencies, session
  queries, office/terminal tools, agent-team task tools, plugin market, ralph, cordis
  inspect, str_replace_editor, …), not a hand-typed list. Tools registered by a
  third-party plugin are matched against the profile's installed package names
  (`agentero_list_papers` → `agentero-dsh`) and the label says it is inferred.
  Anything still unknown reads `unlisted source` with note 「归属目录里没有这条来源，只展示不改」
  instead of the old English `unknown tool provider / 只能预览`.

### Verification

- Isolated real instance (profile `v2qa`, port 49815): one real request produced a
  2,848px-tall ledger inside a 788px tab body (`scrollHeight 2874 > clientHeight 788`),
  mouse wheel scrolls it, `clippedGroups: 0`, 67 rows rendered, owners include
  `dsh-tool-fs`, `dsh-mcp-resources`, `dsh-tool-subagent-control`; 0 console errors.
- Records captured before 3.0.4 keep their old owner labels; new requests show the
  resolved packages.

## 3.0.3 — 2026-11-22

### Fixed

- **Exact ledger text survived only in memory.** The content-addressed store wrote
  `ledger-text/<hash>.txt` without ever creating the directory, so the write failed silently (caught and
  logged as a warning) and `GET /ledger-text?hash=` could only serve text captured in the current
  process. The queued write now creates the directory first; a test flushes the queue and re-reads the
  file through `readStored()` instead of trusting the memory cache.

### Verification

- 160 tests / 0 fail; real 0.2.2-rc.5 instance: after one request `ledger-text/<hash>.txt` exists on
  disk, and the same hash returns the exact text after a host restart.

## 3.0.2 — 2026-11-22

### Fixed

- **Catalog completeness for the tools a real session actually exposes.** working_directory,
  present, plugin_manager, sk_user_question, 	odo_write, the goal tools, the agent-team
  tools (gent_team, list_agents, send_message, wait_agent), list_subagent_models and
  create_worktree now resolve to their owning packages instead of showing up as
  「unknown tool provider / 只能预览」 in the ledger.

### Verification

- 160 tests / 0 fail; self-audit 100/100; the fix came from the real-session ledger screenshot used
  in the release deck, which showed three first-party tools labelled unknown.
## 3.0.1 — 2026-11-22

### Fixed

- **Required runtime contexts are not "blocked".** `working-directory:current` and `subagent:identity`
  are `required: true`, and the host's `refreshContext` puts them back even after a waterfall listener
  removes them (`dsh-system-prompt/src/index.ts:589-609`). The ledger now records such a dropped copy
  as `status: "restored"` with a separate `counts.restoredContexts` and a 「宿主还原」/「restored by
  host」 badge, instead of claiming the policy blocked something the request actually carried.
- **Panorama source references corrected** after an independent review (29 spot-checks). The section /
  context / variable / waterfall line numbers had been taken from the sibling
  `docs/subsystems/system-prompt.md` and are now the real `dsh-system-prompt/src/index.ts` ranges
  (PromptSection 52-76, PromptContext 78-90, `variable()` 568-577, `suppressRuntimeContext` 537-543,
  `refreshContext` 589-609, `assemble` 621-696, event declaration 18-31). Tool guidance now cites the
  real files (`read.ts`/`write.ts`/`edit.ts`/`apply-patch.ts`, `glob.ts`/`grep.ts`), MCP instructions
  cite `dsh-mcp-client/src/server-context.ts:33-38`, AGENTS.md text cites `state.ts:88`, and
  `contextBreakdown` is attributed to `dsh-token-meter/src/projection.ts:52-68` (not
  session-projection). The per-step order is corrected to `assemble → agent/pre-step →
  refreshContext → render/project → buildRequest`, the compaction checkpoint source kind
  (`compact-checkpoint`) is named, and the "pre-step filtering might be re-offered" claim is labelled
  an unproven design assumption instead of a fact.

### Verification

- 160 tests / 0 fail (new restored-context case); self-audit 100/100; ledger persistence across a host
  restart verified in the isolated 0.2.2-rc.5 instance (records reload from `ledger.jsonl` for the
  recorded session); panorama review results are recorded in `docs/INJECTION-PANORAMA.md` §7.1.

## 3.0.0 — 2026-11-22

### Added

- **Injection ledger (注入台账): one record per model request, captured at the assembly.** The plugin
  now listens on the global `system-prompt/assemble` waterfall, calls `next()`, and records the
  **offered** (before other listeners) and **admitted** (after this plugin's own policy filter)
  sections, contexts and interpolation variables together with the exact tool schemas of that
  assembly (`ctx.tools.schemas`). A second global listener on `agent/pre-step` (which the host runs
  *after* the assembly — `dsh-agent-loop/src/agent.ts:300,302`) finalises the same record with the
  step's `turn`/`step` and the decided message-level injections (`source.kind`: skill catalog,
  AGENTS.md, time, plan, goal, reminders, compaction summary). Assemblies without an `agent` (the
  panel's own snapshots, diagnostics) are ignored, so opening the panel never pollutes the ledger.
- **Attribution catalog (`lib/catalog.js`)** for every surface: registering package, kind,
  controllability (`plugin` / `protected` / `preview` / `user`), how a user changes it, and the host
  source line that proves it. Prefixes and kinds without a row are reported as unknown/preview instead
  of claiming control. Covers the real 0.2.2-rc.5 surfaces, including `subagent:identity`,
  `tool:*:depth`, `job_*`, `schedule_*`, `web_*` and eleven message source kinds.
- **Fourth panel tab 台账 / Ledger**: per-request history with estimated tokens, delta against the
  previous request, the blocked-by-policy list, item detail with owner/control badges, and the exact
  text of any section/context on demand (content-addressed; message-level text stays preview-only).
  A resident reference card lists the injected content this plugin cannot control and where the user
  changes it.
- **Routes `/ledger`, `/ledger-text?hash=`, `/ledger-catalog`** and the model-facing
  `context_injection {ledger:true, entry?, limit?}` read-only mode. `API_VERSION` is now 3; the plugin
  exposes 18 routes (15 GET + 3 POST-only).
- Volatile Config switch `ledger` (default on) in the plugin's settings card.
- `docs/INJECTION-PANORAMA.md`: the source-level panorama of every injection surface (six surfaces,
  section/context order tables, message source kinds, precedence rules, visibility channels,
  controllable boundary, unknowns and doc/source conflicts).
- `docs/DESIGN-v3.md`: how the ledger and the catalog are built, what they deliberately do not do.

### Changed

- Snapshot payload and tool card report `apiVersion: 3`; the ledger's token counts are labelled
  estimates (ASCII÷4 + other÷1.6), never provider billing.
- README (en/zh) documents the three new routes and the ledger; `ARCHITECTURE.md`,
  `COMPATIBILITY.md` and the fence/route tests move to 18 routes and apiVersion 3.
- Client size budget 276 KB → 304 KB for the ledger tab (documented in the self-audit).

### Verification

- 159 tests / 0 fail (six new ledger/catalog tests plus three batch-action transition tests).
- **Test-count correction:** earlier local runs added a duplicated tree under `_research/` to the
  discovered test files (75 extra), so local counts since 2.3.x were inflated (2.3.1 saw 231, 2.3.2 saw
  225). The repository suite — what CI runs — is the 24 files under `test/`: 156 tests at 2.3.1, 150 at
  2.3.2, **159 at 3.0.0**. The duplicate copy was moved out of the repository.
- 0.2.2-rc.5 isolated web instance, live request: ledger recorded 24 sections, 8 contexts, 11 tool
  schemas and 2 message-level injections; exact section text round-trips by content hash; the last
  four failing panel checks (404s from a missing client route table) were fixed and the probe is
  14/14 with zero console errors. Offline/blocked-items probe: switching `tool:jobs` off and
  `job_list` off makes the next session's ledger list the section under `blocked` and drop the tool
  from the admitted schema set.

## 2.3.2 — 2026-11-22

### Changed

- **`/inject` is a client shortcut now: plugin icon plus a searchable switch list.** The host command
  registry has no icon field and its plain-text report only repeated numbers the panel already shows,
  so the host command is gone. `client.js` registers the surface on the client `commandUi` service
  (`commandUi.register({ name: 'inject', icon: PanelIcon, ui: { kind: 'popupSelect' } })`). Typing
  `/inject` opens one popup: open the full panel, preset minimal / all-on, undo, then the switchable
  suites sorted by token cost (up to 8, plugin/builtin badge, count and state). Picking a row writes
  `POST /action` immediately; the data still comes from `GET /summary`.
- The host `commands` dependency is gone from the plugin's `inject` list, and the now-unused text
  renderers `renderHealthLine` / `renderHealthText` / `healthCheckText` were removed from
  `lib/text.js` with their tests. The panel's health page and `/health` were never using them.
- The eight READMEs, `docs/ARCHITECTURE.md`, `docs/COMPATIBILITY.md` and `SECURITY.md` no longer
  advertise `/inject health|all|minimal|undo`; the entry is described as a popup, and
  `COMPATIBILITY.md` now states that the shortcut depends on the client `commandUi` service (not
  verified on the 0.2.0/0.2.1 hosts, where it simply does not appear).

### Fixed

- **A suite row in the popup sent the short key (`core`) instead of the cluster id (`tools:core`), so
  `POST /action` matched zero items and the click looked like it did nothing.** Rows now carry the
  full cluster id; multi-channel suites go through the panel's `parts` path, and the policy really
  flips.
- The self-audit reconcile item now checks the client registration (`commandUi.register` and
  `name: 'inject'` in `client.js`, `commandUi` in `docs/ARCHITECTURE.md`), so a host rename cannot
  drop the shortcut unnoticed. The client size budget moved 272 KB → 276 KB because the browser half
  carries this surface now.

### Verification

- 150 tests / 0 fail; self-audit 100/100 (7/7 checks).
- 0.2.2-rc.5 QA instance, `/inject` probe 12/12: the slash menu lists `注入快捷开关 inject` with an
  SVG icon; Enter opens the popup (action group + suite group + search box); clicking `core` dropped
  its `onCount` 23 → 0 through `/action`; popup closed; zero console errors.
  Screenshots: `_research/verify/desk-dev/shots/inject-232/`.

## 2.3.1 — 2026-11-21

### Fixed

- **DSH 0.2.0 hosts activate again.** `workingDirectory` was a hard dependency and that service
  only exists from 0.2.1 on, so 0.2.0-rc.1 reported `pending (waiting for service:
  workingDirectory)` and the plugin never started. It is now optional: `resolveCwd()` tries the
  working-directory service, the 0.2.0 workspace registry, the agent/session header, then
  `process.cwd()`. Verified on 0.2.0-rc.1 and 0.2.1-rc.5: the plugin activates, `/summary` answers
  with `apiVersion: 2`, preset writes persist, and the panel boots with zero console errors.
- **Host version is detected on old CLI installs.** 0.2.0/0.2.1 do not set `DSH_INSTALL_DIR` and
  their profile does not depend on `@deepseek-ai/dsh`, so `/diag.host` used to be `null` there.
  `hostInfo()` now also walks up from the launcher entry (`process.argv[1]`), and the compatibility
  line in the panel shows the real version.

### Added

- **Feedback row in Settings.** "Copy diagnostics" copies a sanitized report — versions, slot
  registration, policy counts; no paths, session ids or conversation text
  (`lib/diagnostics.js`) — and falls back to a selectable textarea when the browser blocks clipboard
  writes. "Report a problem" opens the bug template prefilled with that report.
- `GET /diag?report=1` exposes the same sanitized report for scripts and issue templates.
- **`node scripts/release.mjs`**: one command runs the same gates as CI, bumps `package.json`,
  commits only the version + changelog, and creates the annotated tag (`--dry-run` validates first).
- `docs/GAPS.md`: the honesty ledger (current value, target, action, evidence) for market listing,
  external feedback, release cadence and host coverage.

### Verification

- 156 tests / 0 fail (local count corrected in 3.0.0); self-audit 100/100.
- Old hosts: 0.2.0-rc.1 and 0.2.1-rc.5 installed from npm into isolated homes; plugin activates,
  `/summary` returns `apiVersion: 2`, preset write persists, diagnostics report works, no console
  errors.
- Feedback: row renders in all eight locales; copy produces a 536-character report without paths;
  issue popup carries template and body; the 16/16 entry probe still passes on 0.2.2-rc.5.

## 2.3.0 — 2026-11-20

Five entry points, one snapshot. The panel already told one story; the conversation, the right sidebar
and the settings row now tell the same story from the same payload.

### Added

- **Conversation tab (`注入` / `Inject`)** — `conversation.view` slot. Leads with this conversation's
  measured injection (`numbers.session`), then the next new session's projection (`numbers.next`),
  the switchable share, the window, and the channel composition. Read-only by design: switches apply
  to sessions created after the save.
- **Preference row in Settings → General** — `settings.general.item` slot backed by
  `configForms.get('injection-manager')`. `dock` / `refreshOnFocus` / `showRawNames` are editable
  there; where the host serves no config form the row shows the effective values read-only.
- Five-entry contract in `scripts/self-audit.mjs`: the five slot names must appear both in the
  registration code and in `docs/ARCHITECTURE.md`; a silently unregistered surface now fails the
  audit (reconcile, 15 points).
- `dsh.compatibility` manifest field; README set translated to eight languages; `docs/DECISIONS.md`
  and `docs/SELF-ASSESSMENT.md`; three new documentation screenshots (conversation tab, right-sidebar
  panel, preferences row) captured on rc.5 with personal chrome removed.

### Changed

- **Right-sidebar panel migrated** from the removed `sidebar.panel` slot to the host's
  `sidebarRightTabs` service + `sidebar.right.pane.tab` (+ title). On hosts that still declare the old
  slot and have no tab registry, the old registration is kept as a fallback — one panel, never two.
- **`Config` fields are `.volatile()`** — flipping a presentation switch applies immediately, without
  restarting the plugin. `lib/settings.js` accepts both plain values and volatile references and
  re-reads on access.
- `package.json` files/targets: eight READMEs, new docs, `screenshots.json` entries for the new
  surfaces.

### Verification

- 151 tests / 0 fail (local count corrected in 3.0.0); self-audit 100/100 (including the new five-entry check and refreshed size
  baseline).
- DSH 0.2.2-rc.1 (CLI) 15/15 browser checks, DSH 0.2.2-rc.5 (Desktop) 16/16; zero console errors.
- Performance (rc.5): `/summary` median 46 ms (p90 206 ms cold), panel open 220 ms, conversation tab
  199 ms, right panel 82 ms; details in `docs/PERFORMANCE.md`.
- Independent design review before release (`docs/REVIEW-230.md`, full review and author response):
  33/70 at the first cut, three defects fixed before shipping — the conversation tab mixed the
  next-session projection into a this-session reading; the composer chip had three switches over two
  storage systems; the right sidebar had dead controls and no way back to the full panel.
  `_research/verify/desk/probe-review.mjs` now covers those interactions (10/10).

## 2.2.9 — 2026-11-19

### Changed

- **Every channel square is its own hover target.** Hovering one 8px square shows that channel's
  name, its token count inside the suite and its share; hovering the `多通道 · 3` text shows all of
  them, largest first. The card is drawn in the panel's own style — 10px radius, hairline border, the
  card shadow, tabular numbers — not the OS tooltip.
- The card is portalled into `.ci-root` so it inherits the theme (light and dark both measured
  `rgb(255,255,255)` / `rgb(22,22,25)`), and into a layer above the table so the table's own scroll box
  cannot clip it. It flips above the anchor when the row is near the bottom edge, and disappears on
  scroll or resize.

### Verification

- Probe hovered the second of three squares: card `系统提示词段落 148 13.4%`; hovered the text:
  all three rows, sorted; leaving the row leaves zero `.ci-tip` nodes.

## 2.2.8 — 2026-11-19

### Changed

- **A 多通道 row now says how many channels and what each holds.** The channel cell reads
  `多通道 · 3` and its hover title lists the channels by size, e.g. 工具 schema 950 86.2% /
  系统提示词段落 148 13.4% / 运行时上下文 4 0.4%. Single-channel rows got the same treatment
  (`工具 schema · 6,086 token`). The cell shows a dotted underline and a help cursor so the hover is
  discoverable.

### Verification

- Hover titles read back from the DOM for six suites, including a three-channel one.

## 2.2.7 — 2026-11-19

### Changed

- **The ring and the ranking are one card again**, stacked instead of side by side. As two cards the
  ranking was 440px tall and the ring 300px, so the left column ended in a visible hole, and the
  ring's legend was squeezed into two 200px columns that clipped every label to "系统提…". Now the
  ring sits in a header strip with the five channel figures in one row, a hairline separates it from
  the ranking below, and the whole block is one card.
- **The legend no longer ellipsises channel names.** The row grid gave the label 76px where the text
  needed 77, so Chrome drew an ellipsis on every name. The strip widens the label to 91px.

### Fixed

- **The health strip said "还有 0 条提示"** when it had one actionable row and nothing folded.

### Verification

- `node --test` 223/223; `node scripts/self-audit.mjs --strict` 7/7, 0 warnings.
- Legend measured: five rows of 203px, label 91px for 77px of text, `clipped: false` on all five.

## 2.2.6 — 2026-11-18

### Changed

- **The closed-items block under the list is gone.** It listed the same suites the list already
  renders with a 已关闭 tag and a switch to turn them back on, and when one suite spanned two
  channels it printed that suite twice (REA 229 条目, then REA 1 条目). Restoring is the switch on
  the row itself; nothing was lost but a duplicate listing.

### Verification

- `node --test` 223/223; `node scripts/self-audit.mjs --strict` 7/7, 0 warnings.
- Fixture screenshots 26/26; the manage page now ends at the last suite row.

## 2.2.5 — 2026-11-18

The settings page was four cards of eleven rows and eight paragraphs, and almost none of it was a
setting. It is now one card of five rows, about a fifth of its former height.

### Changed

- **设置 is one card**: 策略文件 (path + export Markdown/JSON + import), 预设 (全开/极简 with the
  two-click overwrite confirmation), a folded 自定义前言/后记, 输入框摘要 (the composer chip), and
  说明 (host/API/language plus a folded 详细说明).
- **Removed**: the undo-history card (the manage page's 撤销上一步 walks the same stack), the
  copy-report button (the `/inject` command and the tool print the same text), the 核对本会话 button
  (the health strip and `/inject health` cover diagnostics), the last-apply line, the update time, and
  the separate 偏好 card.
- **Two preferences lost their switches because they have better homes**: the drawer's line-number
  default is a toggle inside the drawer itself, and the default trend range is the range pills on
  洞察. Their stored values are unchanged, so nothing resets.

### Verification

- `node --test` 223/223; `node scripts/self-audit.mjs --strict` 7/7, 0 warnings.
- The settings card measures 215px at 1360px wide; it was about 900px.

## 2.2.4 — 2026-11-18

Spacing and width, from a screenshot of the live panel: the tab row sat 7px under the subtitle, and
the table ran to the window edge with a 669px empty description column in the middle of it.

### Changed

- **The event timeline card is gone from 洞察.** A session usually has one or two events ("新会话"
  and little else), so the card was a mostly empty box taking a third of the row beside the session
  cards. What it showed — presets, switches, undo steps — is already the undo history in 设置, with a
  button to go back. The `/events` route and the writer stay; compaction and policy events are still
  recorded for scripts and the tool.
- **The tab row breathes.** 7px above it became 16px, and the header, the tabs and the page body now
  start on the same 20px edge (the header was at 14px).
- **One reading column.** Header, tabs and body are wrapped in a shell capped at 1240px and centred,
  so a 1900px window shows a 1200px table instead of an 1880px one. The composer chip, the sidebar
  and the drawer are unaffected.
- **The description column is capped at 250px** instead of taking 1.2fr of the row (669px at 1920).
  Channel, tokens, share and switch got a little more room (110 / 84 / 64 / 56px).

### Fixed

- **2.2.3 rendered the v2 gate twice on a v1 host.** The old line survived the tab rewrite next to
  the new one.

### Verification

- `node --test` 223/223; `node scripts/self-audit.mjs --strict` 7/7, 0 warnings.
- Layout measured at 1360 / 1600 / 1920: the table is 1200px wide in all three, every row's left edge
  is at 80px, and the subtitle-to-tabs gap is 16px.

## 2.2.3 — 2026-11-18

Each panel has one job now. 管理 is a switchboard, 洞察 is an ordered diagnosis, 设置 is four
questions. Everything that answered a different question was deleted rather than moved around, and
the prose that explained what the screen already showed is gone.

### Changed

- **管理 is switches only.** The request strip, the health list and the fused "composition ring +
  ranking" card are gone from this tab; what is left is one line of numbers (`新会话首轮 18k ·
  可关闭 15.5k (86.2%)`), the toolbar, the suite list and the folded closed line. Undo moved from a
  footer sentence to a button on that line.
- **洞察 has one fixed order**, top to bottom: 本次请求构成 → 注入构成环 + 最重套件排行 → 健康检查 →
  趋势 → 变更与会话卡. The four-KPI row, the "current session" line and the cross-session average ring
  are deleted: the first two repeated the composition cards, the third was a second ring.
- **A ranking bar is a link.** Clicking a bar on 洞察 opens 管理 with that suite already filtered —
  including suites in the folded DeepSeek 官方 bucket, which now unfolds itself when a suite filter is
  active (before, the jump landed on a folded line and the table looked empty).
- **设置 is four cards**: 偏好 (browser-local switches, including the composer chip), 预设 (with the
  two-click overwrite confirmation and the latest three undo steps), 策略文件 (path, update time, four
  export/import actions, verification, prefix/suffix), 关于 (host, API version, language, the
  read-only items, and one folded 详细说明). The eight stacked explanation paragraphs are inside that
  fold instead of under the controls.
- **The health strip reads as rows when nothing is actionable.** With every check a note, the first
  three are shown directly instead of an empty box with a single folded line; the group id inside
  the text is translated (`「core」` → `「基础工具」`).
- **The trend chart keeps only what the chart cannot show.** "斜纹 = 通道未知" appears only when the
  bars are actually striped; the "全部范围按时间升序" line is gone.

### Fixed

- **English panels printed Chinese for `items`, `chars`, `groups`, `required`.** The translator
  treated a translation that equals its own key as a stub and fell back to Chinese, so `31 items`
  read `31 条目`. A missing value is now the only degradation case.
- **Filtering by a suite emptied the table for every translated suite name.** A suite chip carries
  the display label (`基础工具`) while an item carries the raw group id (`core`); both sides are
  compared now. This also fixes clicking a suite name inside the list.
- Policy update times are formatted instead of printed as raw ISO strings.

### Verification

- `node --test` 223/223; `node scripts/self-audit.mjs` 7/7 checks, 0 warnings.
- Fixture screenshots 26/26 plus a two-click probe: both settings disclosures unfold, and a ranking
  bar lands on 管理 with one suite and its rows visible.
- README/docs tab descriptions and the panel screenshots are regenerated from the same client.

## 2.2.2 — 2026-11-18

Subtraction pass. Three regions that repeated an existing number or offered nothing to press are
gone; nothing they did was removed, only moved to where it belongs.

### Changed

- **The three KPI cards are gone from the panel.** "首轮" is the composition card's headline,
  "可关闭" is in the footer, and the only number those cards held alone — window occupancy — is in
  the request strip right below. The manage page now opens on the strip and the list instead of a
  third of a screen repeating two figures.
- **"已关闭 229 条" is one line, not a card.** It shows the count, the remembered tokens and the
  restore hint; clicking opens the per-suite restore rows. The closed list is a receipt, not a
  workspace.
- **Settings no longer carries three long blocks.** The permanent "当前有 230 项手动关闭…" warning
  became a second click: pressing a preset turns the button into 确认覆盖 for four seconds, and only
  the second press overwrites manual choices. The channel master switches card is removed (suite and
  per-item switches in the list, plus `/inject minimal`, still cover it). Undo history shows the
  latest three steps and a `查看全部 12 步` toggle instead of twelve near-identical rows.

### Verification

- `node --test` 223/223.
- Fixture screenshots 26/26, including the collapsed closed line, the three-step history, the
  expanded history and the 确认覆盖 state.

## 2.2.1 — 2026-11-18

### Changed

- **The list asks one question: is this DeepSeek's, or mine?** The grouped list now has two
  sections. **DeepSeek 官方** folds into a single line (`24 组 · 15.4k token`) and stays folded until
  clicked; **其他插件与 MCP** stays open below it. The official side is not what the panel was
  opened for, and unfolded it pushed the plugin rows below the fold on a laptop.
- **The classification is a maintained list, not a name heuristic.** `lib/origin.js` holds the
  official tool names, tool families, section prefixes, context prefixes and the explicit
  third-party prefixes; anything unlisted counts as *other*. The old rule ("only `mcp__` names are
  plugins") put `agentero`, `dsh-office`, `dsh-context` and every other non-MCP plugin inside
  "DSH built-in", where a user looking for what to switch off would never find them. A suite's
  origin is now a majority vote, so one plugin item cannot re-label the whole `core` family.
- **The health strip only keeps rows with a button.** "3 items cannot be closed" and "window
  unknown" occupied two rows without offering a move; they collapse into one line (`还有 3 条提示 ·
  点开查看`) that opens on click. A suite the host owns is never offered as "关掉这一套" — even when
  an older host still sends that action, the panel checks the suite's origin and demotes it to a
  note.

### Verification

- `node --test` 223/223 (three new: official names stay official, a plugin is never hidden in the
  official bucket, a suite is official only when most of its items are).
- Fixture screenshots 24/24 across the three surfaces, both themes, three locales and five policy
  states; the added states are "official bucket expanded" and "notes expanded".
- Host restart required for the new classification; the client-side action guard takes effect on a
  panel refresh even against a 2.1.x host.

## 2.2.0 — 2026-11-18

The consistency release. Every surface now quotes the same two numbers, "off" has one meaning,
and a policy write either lands whole or leaves the previous file intact.

### Changed

- **Two numbers, two names.** `/summary` gained `numbers: { session, next }`: what the current
  conversation is injecting, and what a session created after the saved policy will get. The KPI
  header, the panel footer, the sidebar footer, the composer badge and the composition header all
  read that pair and say 新会话首轮 / 本会话 (next session / this session) instead of sharing one
  "首轮注入" label. The badge used to read the all-on total, so closing a 66k suite moved the panel
  by three quarters and the badge by nothing; it now reads `next` and keeps `session` in the tooltip.
- **"Off" is no longer two words for one badge.** A row that is still in this session's assembly but
  excluded from the next one says 新会话关闭; an item that has already left the assembly says
  已关闭. Both used to render on the same row.
- **The tool card and `/inject health` tell installed suites and host suites apart.** An MCP/plugin
  suite is described as closeable and is the one the card recommends; a host suite (`core`,
  `browser`, `schedule`, `subagent`) is reported as informational and never suggested. The
  recommendation also skips suites the policy already closed, and the card headline says 本会话.
- **Sidebar kind chips land on a channel.** `提示词` / `规则` used to send `prompts` / `rules` — ids
  no channel filter could match, so the click opened an empty list with raw translation keys. They
  map to `sections` / `instructions` now.

### Fixed

- **Concurrent policy writes can neither drop a switch nor corrupt the file.** `POST /action` and
  the `/inject` preset/undo commands go through one process-wide queue (`lib/lock.js`), and the file
  write itself is queued with a unique temp name. Two panels flipping two suites used to interleave,
  keep the later write only, and — when both landed in the same millisecond — publish a truncated
  JSON that read back as "everything on", silently re-enabling the suites that had just been closed.
- **A corrupt `policy.json` recovers from `policy.json.bak`** (written before every save) instead of
  falling back to "everything on"; the read reports `recovered: true` and names the backup in
  `error`.

### Performance

- **Polled `/summary` responses are ~44% smaller.** They carried all eight client dictionaries
  (~137 KB of 267 KB on the reference profile) while the panel renders one. The client now sends
  `?lang=`, the host answers with that dictionary plus English, `/locale` still returns all eight
  for host-level registration, and a polled response drops to about 150 KB.

### Verification

- `node --test` 220/220 (nine new: policy queue/backup recovery, corrupt-file recovery, `numbers`
  contract, per-language payload, installed-vs-host suite wording, closed-suite recommendation).
- Fixture harness (`_research/rsi/`): 22 screenshots across three surfaces, two themes, three
  locales and five policy states; no horizontal overflow, no unnamed controls, no console errors
  beyond a fixture 404.
- `node scripts/self-audit.mjs` scores the repository; `docs/RSI.md` records the loop and this
  round's baseline.

### Notes

- `docs/images/*` and the demo GIF still show the 2.1.1 labels. The numbers and wording under them
  are unchanged; a re-shoot is queued for the next release rather than faked here.
- Backlog after this round: attribute a tool to the plugin that registered it (the host's
  `ToolSchema` has no owner field), per-skill last-used, session-to-session diff, filterable
  event timeline, virtualised 354-row list.

## 2.1.1 — 2026-11-18

### Fixed

- **Health checks no longer recommend closing DSH's own suites.** `heavy-suite` is now restricted to
  installed plugin / MCP suites (`group.origin === 'plugin'`), so a big `core`, `browser`,
  `schedule` or `subagent` suite gets an informational `builtin-heavy` note instead of a "turn this
  suite off" button — closing the host's own tool families is not a sensible default. Snapshots
  without `origin` (older hosts) keep the previous behaviour.
- **Switching a suite from the list actually writes the policy.** The grouped list keys rows by
  label (`filesystem`) while `POST /action` needs the real group id (`skills:filesystem`); the
  single-channel branch sent the label, matched zero rows and returned `changed: false`, so a click
  on a suite row was a silent no-op. It now sends the real `channel + group` pair from the row's
  parts (same as the health strip action).

### Verification

- `node --test` 211/211 (two new tests: built-in heavy suites are informational and carry no
  action; a heavy plugin suite keeps its switch recommendation; the huge tool fixture moved to an
  MCP namespace so it remains a plugin suite).
- Live QA: `core` at 38% renders as `builtin-heavy` info with no button; clicking the `filesystem`
  suite switch now answers `changed: true` and writes `skills: except […]`.
- Docs screenshots and the demo GIF re-shot after the change and re-masked (host session titles,
  session ids, local policy path).

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
