# RSI：可重复的自审计

一句话：每次改数字、改开关或改文案，跑一次 `node scripts/self-audit.mjs`，把代码、面板和文档对一遍；对不上就红，不靠人眼。

## 为什么

- 用户信的是面板上的数字。口径漂移一次（徽标读全开总量、面板读生效值），之后每个数字都可疑。
- 「关闭」有两种事实：本会话已移除、只对新会话生效。混用一个词，用户会以为开关失灵。
- 发布前的人眼检查不可复现；固定结构的 JSON 报告才能让下一轮直接 diff。
- 自审不是发布仪式，是给下一轮省时间：先找最弱项，再决定改什么。

## PDCA 四步

| 步骤 | 本仓库动作 | 产物 |
| --- | --- | --- |
| Plan | 跑 `node scripts/self-audit.mjs`，按 fail > warn > 分低选最弱项 | 本轮 1~2 个目标 |
| Do | 先加会红的测试，再改代码；一次只动一个口径 | `test/*.test.mjs` + 代码 |
| Check | 重跑 self-audit；`node _research/rsi/shot.mjs` 截图；`node --test` | `--json` 报告、截图、通过数 |
| Act | 写 CHANGELOG；把新修的点变成护栏；没做完的进 backlog | 版本条目 + 本文件 |

Check 的三样证据要能复查：self-audit 的 JSON、截图目录、`node --test` 的通过数，缺一不可。

## 六个审计视角

### 1. MECE

- 七个检查项是否覆盖「测试 / 文案 / 契约 / 包 / 体积 / 规则」，且互不重叠。
- 新增一个面（例如权限）时，是加检查项还是塞进已有项；权重是否要重分。
- 同一事实是否只在一处定义：路由表、`Config`、locale。
- 有没有「脚本说 pass 但人看不出为什么」的项。

### 2. 宿主正确性

- `/summary` 的 `numbers.session` / `numbers.next` 是否同源；旧宿主回退是否只影响显示。
- 写策略是否都走 `withPolicyLock`，临时文件名是否唯一，`.bak` 是否在写前落盘。
- 路由是否仍接 `requestRejection` 栅栏，POST 是否限同源。
- 宿主升级后 `API_VERSION` 是否要加，客户端能否特性检测。

### 3. 客户端

- DockChip、面板头、页脚、侧栏是否读同一对数字。
- `t()` 的字面量 key 是否都在 `locale/en.json`；前缀拼接（`health.`）是否有兜底。
- `ItemRow` 的关闭标签是否区分「本会话已移除」与「新会话关闭」。
- 排序、搜索、展开态在 354 行列表上是否仍可操作。

### 4. 文档与 i18n

- README、README.zh、docs 是否都写了 15 条路由、4 个子命令、3 个配置字段。
- 8 份 locale 的 key、空串、占位符集合是否与 en 一致。
- 截图和文案是否同一版本；过期截图要标注，不假装。
- CHANGELOG 最新版本号是否等于 `package.json`。

### 5. UX

- 首屏是否回答「这次注入多少、能关多少、关了什么」。
- 「关闭」动作后，本会话与新会话的反馈是否分开说。
- 空态、错态、旧宿主态是否都有下一步，而不是空白。
- 颜色之外是否还有文字/图标表达状态；键盘能否走完主路径。

### 6. 同类对比

- 相邻插件（`dsh-context`、`billion-context`、`dsh-mnemon-*`）解决的是注入前、注入后还是记忆，别把三件事混成一件。
- 该补的必须落在「看/管首轮注入」职责内；越界的（压缩、请求重放、记忆开关）明确写「不做」。
- 宿主已有能力（`contextPressure`、`compaction/summary`）先用，不在插件里重算一个。

## 指标与权重

`score = Σ(权重 × 系数)`；pass = 1、warn = 0.5、fail = 0；满分 100。体积权重 0，只 warn，不拉低分数。

| id | 看什么 | 权重 | 判定 |
| --- | --- | --- | --- |
| tests | `node --test` 的 pass/fail/耗时（120s 超时） | 30 | 有 fail、0 通过或解析不到 → fail |
| locale | 8 份 `locale/*.json` 的 client key 对等 | 15 | 缺失/多余/空串/占位符不一致 → fail |
| keys | `client.js` 的 `t('...')` 字面量 vs en | 10 | 有 key 不在 en → fail |
| reconcile | 路由/命令/配置字段的代码↔文档双向差集 | 15 | 文档有代码无 → fail；仅代码有或 API 版本未写 → warn |
| package | `files`、`exports`、版本 vs CHANGELOG | 10 | 文件/导出缺失或版本不一致 → fail；自审脚本没进包 → warn |
| invariants | 4 条护栏，每条 5 分 | 20 | 任一条不成立 → fail，按通过条数给分 |
| size | client / en / 包体字节与基线 | 0 | 永不 fail；超预算、涨 5% 或缺基线只 warn |

- `--strict` 只在任一 fail 时退出 1；warn 不拦。
- `--json` 输出固定字段顺序；基线在 `_research/rsi/baseline-metrics.json`，只有 `--write-baseline` 才写。
- 护栏：(a) DockChip 不得读 `data.totals.tokens`；(b) `offNextSession` 存在且 `ItemRow` 不用 `turnedOff`；(c) action 路由含 `withPolicyLock`；(d) `policy.js` 含 `BACKUP_SUFFIX`。

## 2026-11-18 这一轮

- 基线：2.1.1，211 个测试。
- 修了：数字口径统一（`/summary` 增 `numbers: { session, next }`，徽标/页头/页脚同源）；关闭语义拆分（`offNextSession` 与 `turnedOff` 不再同排）；策略写入串行化 + 写前 `.bak`；`/summary` 按 `?lang=` 只回一份词典；`text.js` 不再建议关闭宿主自带套件。
- 结果：220 个测试全过（新增 9 条），新增护栏 4 条。
- 自审终态：7 pass / 0 warn / 0 fail，100/100，`--strict` 退出 0；体积基线已写（`_research/rsi/baseline-metrics.json`）。
- 护栏当场抓到一次：首跑 (a) 失败，因为 DockChip 的旧宿主回退仍直接读 `data.totals.tokens`。没有放宽护栏，而是把 DockChip 改成复用 `tokenNumbersOf()`——护栏要能逼出更好的代码，不是被代码改窄。
- 证据：本文件、`_research/rsi/shots/`（22 张）、`node --test` 220/220、`scripts/self-audit.mjs --json`。

## 2026-11-20 这一轮（2.3.0：五入口闭环）

- 基线：2.2.9，223 个测试，自审 100/100，npm latest 2.2.9，GitHub 有 v2.2.9 release；
  但官方精选目录 0 命中、README 只有两种语言、`sidebar.panel` 入口在 rc.5 已静默失效。
- 这一轮的判据不是「再加功能」，而是「同一件事是否真有五个入口」：
  - 会话标签页 `conversation.view`：本会话视角，只读；
  - 右侧栏迁移到 `sidebarRightTabs` + `sidebar.right.pane.tab`（旧槽回退只在没有新服务的宿主上启用）；
  - 设置 → 通用设置偏好行 `settings.general.item`，Config 三个字段改 `.volatile()`。
- 新增护栏：自审 reconcile 项要求五个槽位名同时出现在 `client.js` 与 `docs/ARCHITECTURE.md`；
  任一侧缺失直接 fail。这样宿主下一次删槽位时，先红的是自审，不是用户界面。
- 结果：226 个测试全过（新增 3 条 volatile 设置用例）；自审 100/100，体积基线重写；
  rc.1 CLI 15/15、rc.5 Desktop 16/16 浏览器检查通过，0 console error。
- 证据：`docs/DECISIONS.md`（本轮 5 条决策）、`docs/SELF-ASSESSMENT.md`、
  `docs/images/session-tab.png`、`sidebar-panel.png`、`settings-general.png`、
  `docs/PERFORMANCE.md` 2.3.0 节、`_research/verify/probe-entries.mjs` 与 `_research/verify/desk/`。
- 自评本轮真实弱点：会话页信息量偏薄；`/summary` 仍是整包轮询（252KB）；六个翻译 README 未经
  母语复核；市场收录仍未完成。
- 发布（2026-11-20）：tag `v2.3.0` → release workflow 校验版本、跑测试、`npm publish --provenance`
  并发 GitHub Release；GitHub CI 与 release 两条 workflow 均 success；npm 安装路径在干净 profile
  实测五入口 16/16。

## 2026-11-21 这一轮（2.3.1：缩短差距）

- 起点：一页「差距/诚实」把五个数字摆出来——精选目录 0、外部 issue 0、tag 9、真机宿主 2 代、
  自评 8.6。这一轮不扩功能面，只处理能靠代码/流程消掉的差距。
- 选中并解决：
  - **旧宿主**：0.2.0-rc.1 上插件因 `workingDirectory` 是硬依赖而永不激活（`pending`），
    0.2.1-rc.5 虽能启但 `/diag.host` 是 null（旧 CLI 不设 `DSH_INSTALL_DIR`、profile 也不依赖
    `@deepseek-ai/dsh`）。改成可选服务 + 回退链路 + 从 `process.argv[1]` 识别版本；两代宿主
    从 npm 装进隔离 home 实测：激活、`/summary apiVersion 2`、preset 写入落盘、诊断报告、0 console error。
  - **反馈通道**：设置页内「复制诊断 / 报告问题」，诊断走新的 `lib/diagnostics.js`（只留版本、
    槽位注册、策略计数，去掉路径/会话 id/对话），浏览器拦剪贴板时展开可选中文本；`/diag?report=1`
    给脚本用。实测复制 536 字符、无路径、issue 模板+正文预填。
  - **发布节奏**：`scripts/release.mjs` 把 CI 同款门槛、bump、commit、tag 收成一条命令；SOP 固定
    patch 每周 / minor 2–4 周；2.3.1 为第一笔。
  - **目录事实**：awesome-dsh-plugin 条目其实早已存在（此前记录为 0 是旧快照），PR #17255 更新
    描述与图标，CI pass、等合并。
- 结果：231 测试 / 0 fail；自审 100/100；tag 11；自评 8.6 → 8.8。外部 issue 仍为 0——这条只能
  等真实用户，通道已经降到一键。
- 证据：`docs/COMPATIBILITY.md`、`docs/GAPS.md`、`docs/FEEDBACK.md`、`scripts/release.mjs`、
  `_research/verify/probe-old-actions.mjs`（开发机）。

## 2026-11-22 这一轮（2.3.2：把"没用"的入口重做）

- 起点不是自审表，是本人用完之后的一句「斜杠菜单里的 inject 没用，删掉或升级」。回头核对：
  `/inject` 是宿主文本命令——宿主 `commands` 注册项没有 icon 字段（图标在客户端 presentation 里
  写死），而且它的输出只是把面板已有的数字再打一遍，确实没有存在理由。
- 选中并解决：
  - **形态重做**：删掉宿主命令，改成客户端 `commandUi` 弹层——插件图标、可搜索、四行动作
    （打开面板 / 最小预设 / 全开 / 撤销）+ 按 token 排序的套件开关（最多 8 个）；数据仍
    `GET /summary`，写入仍 `POST /action`，锁不变。
  - **修掉同一次改动里的真 bug**：弹层发给路由的是去掉通道前缀的短 key（`core`），路由按完整
    group id（`tools:core`）匹配，点了等于没点；现在按面板同款 payload，多通道套件走 `parts`。
  - **自审补一条对账**：`commandUi.register` + `name: 'inject'` + ARCHITECTURE 里的 `commandUi`，
    宿主改名导致入口消失会先失败；客户端体积预算 272 KB → 276 KB 并写明原因。
  - **删死代码**：`lib/text.js` 的健康文本渲染（`renderHealthLine` / `renderHealthText` /
    `healthCheckText`）随命令一起去掉，连带 3 条用例；八语言 README、ARCHITECTURE、COMPATIBILITY、
    SECURITY 里过时的四条子命令（health / all / minimal / undo）全部改掉。
- 结果：225 测试 / 0 fail；自审 100/100（7/7）；0.2.2-rc.5 QA 实例探针 12/12（斜杠行带 SVG 图标、
  弹层动作/套件分组、点 `core` 后 `onCount` 23→0、0 console error）；npm 2.3.2 + tag `v2.3.2`。
- 没做：0.2.x 两代宿主上 `commandUi` 是否存在未单独验证（缺失时该入口不出现，已在 COMPATIBILITY
  标注）；2.3.2 未重跑整包干净安装（改动只在客户端与文档）。
- 证据：`_research/verify/desk-dev/probe-inject.mjs`、`shots/inject-232/`（开发机）、
  `CHANGELOG.md` 2.3.2、`docs/ARCHITECTURE.md` 规则 5。

## 下一轮候选（backlog）

- 发布与收录：npm 2.3.0 + GitHub release + 官方精选目录条目（本轮备好 `market-entry.yml`）。
- 会话标签页加一条会话内结论（本会话最大的可关套件 + 跳转管理页）。
- `/summary` 分页参数：会话页只要前 N 行，不再整包轮询 252KB。
- 工具归属到插件：`ToolSchema` 没有 owner 字段，健康检查与套件只能靠命名猜。
- 技能使用频次：技能目录只有体积，没有「上次用到」。
- 会话间差异：两个会话的首轮构成 diff，而不是只看单点。
- 事件筛选：事件时间线只能全量看，不能按 kind / 套件过滤。
- 354 行列表虚拟化：长列表滚动和展开仍有掉帧风险。
- 洞察页去重：趋势、构成、最大套件之间有重复叙述，收敛成一块。
