# 架构

这份文档只讲一件事：一次新会话的首轮上下文，从策略文件到模型请求，中间经过哪些环节、每一环用什么接口、失败时会怎样；v2 新增的只读表面（内容透视、趋势、事件、健康检查）分别从哪来、写到哪去；2.2.0 的两个数字口径（`numbers.session` / `numbers.next`）、策略写入队列，以及 2.3.0 的五个入口槽位也在这里说明。

## 四条注入通道

首轮上下文不是一整块，而是四条互不相同的通道。插件对它们的控制能力也不同，这是整个设计的前提。

| 通道 | 载体 | 产生者 | 本插件的控制方式 |
| --- | --- | --- | --- |
| A. 系统提示词段落 | `system` 角色文本 | `ctx.systemPrompt.section()` | 会话作用域的 `system-prompt/assemble` 过滤器按名字移除/替换 |
| B. 运行时上下文 | 独立 `user` 快照 | `ctx.systemPrompt.context()` | 同一个过滤器；`required: true` 的不动 |
| C. pre-step 用户消息 | 插在 claimed 批次后的 `user` 消息 | 各插件（`dsh-agent-instructions`、`dsh-tool-skill`、`dsh-time-context`） | 只能间接：技能逐条 shadow；工作区规则只读展示 |
| D. 工具 schema | 请求的 `tools` 字段 | `ctx.tools.register()` | `ctx.tools.restrict({ deny })`，只影响该会话 |

没有任何一条通道通过「改文件」实现。旧版曾重命名 `AGENTS.md`、改 `SKILL.md` frontmatter，那会在多会话、多工作目录下改错对象，已废弃。

## 快照流水线

面板、模型工具、导出文件、应用策略、健康检查、内容抽屉，全部来自同一次 `buildSnapshot()`：

```
policy.json ──┐
Config ───────┤
              ├─▶ collectSections/Contexts (assemble)
工作目录 ─────┤   collectSkills (snapshot)
              │   collectTools (schemas)
              │   collectInstructions (固定路径探测)
              │   readContext (tokenMeter + contextBreakdown + llm)
              ▼
         assignGroups()  → 按套件聚类
              ▼
         previewPolicy() → 关掉后剩多少 / 省多少
              ▼
   { items(+preview), groups, channels, totals, context, numbers, policy, undo }
              ├─▶ 面板 / context_injection / /export / applyPolicyForAgent
              └─▶ buildHealth(snapshot) → 健康检查（纯函数，见下）
```

`context` 那一路是唯一不由本插件估算的部分：`window` / `pressure` / `projected` 来自宿主的 `contextPressure` 投影，`breakdown` 来自 `contextBreakdown`，（缺分母时才）用 `ctx.llm.resolveModelInfo()` 的 `contextWindow` 兜底；压缩回执由 `session/event` 监听器从 `compaction/*` 累积。因此面板里的占用百分比与宿主自己的「上下文已用 x%」是同一个数，不会各说各话。

`numbers` 是 2.2.0 新增的两个口径：`session = totals.tokens`（本会话此刻的注入量），`next = effective.totals.tokens`（按已保存策略，之后新建会话的首轮注入量）。两者只在会话中途改过策略时不同；面板 KPI、面板底栏、侧栏脚注、输入框徽标和构成卡标题都读这一对，不再各自从 `totals` / `effective` 推算。`session` 不是「下一次请求」——下一次请求还带着对话历史，占用率那条才是。

关键不变量：**只有一份实现**。浏览器不重算 token、不重算预览；它拿到什么就画什么。这也让「预览数字」和「实际生效」不会打架。v2 只加了两个派生：每个条目的 `preview`（快照阶段切好的前 180 字符纯文本）和 `buildHealth()` 的检查结果——两者都从同一份快照算，不额外读盘。

## 来源分类

2.1.0 起，快照给每个条目与分组打上 `origin: "plugin" | "builtin"`，回答「这条注入来自装进来的插件，还是 DeepSeek 官方」。宿主不给归属：`ToolSchema` 只有 name/description/parameters，段落只有 name/text，所以 2.2.1 起分类由一份维护名单决定（`lib/origin.js`），不再是「名字里带 mcp 才算插件」的启发式：

- **官方**：`OFFICIAL_TOOL_NAMES`（read / pwsh / todo_write / schedule_* / job_* / subagent* / goal* / web_* 等核心工具）与 `OFFICIAL_TOOL_FAMILIES`（core / schedule / job / subagent / workflow / team / web / plugin …）；段落前缀（`harness:` `deployment:` `tools:` `plan:` `team:` `context:` `ui:` `app:` `session:` `runtime:` `tool:` `subagent:`）与少数无前缀名字（`mcp-resource-servers`、`tool-guidance`）；上下文前缀（`working-directory:` `sandbox:` `approval:` `subagent:` `tool:` …）。
- **其他**：`mcp__` / `mcp:` / `plugin:` 开头的一律算其他；带 `provider` 或 `source: 'user'` 的技能算其他；**没列名的工具、段落、上下文一律算其他**——宁可让一个宿主新段落暂时落到「其他」，也不能把一个第三方插件藏进「官方」。
- 组归属按多数票：组内官方条目多于其他条目才是官方，一个插件条目不会把整个 `core` 工具族翻成插件。

`/summary` 的每个 item 带这个字段；`lib/group.js` 的 `summarizeGroups()` 为每个 group 打同样的 `origin`（组内多数票，另附 `pluginCount` / `officialCount`）。同一函数还顺带算出策略生效后的计数：`onCount` / `offCount` / `onTokens` / `offTokens` / `onSavableTokens`，而 `count` / `tokens` 仍是测量时全开的体积。健康检查读 `on*`，所以关掉一套后它自己的告警会消失。

面板的套件清单分两段：**DeepSeek 官方**折成一行、默认收起（展开状态存 localStorage）；**其他插件与 MCP** 默认展开。健康检查条只保留有动作的项，只读提示折成一行。

## 生效时序

```
agent/created (source=startup|clear)
  └─ buildSnapshot()                     ← 读策略、量一遍当前会话
  └─ applySnapshotPolicy()
       ├─ agent.ctx.on('system-prompt/assemble', rewrite)   ← A/B 通道
       └─ agent.ctx.inject(['tools','skills'], scoped => {
              scoped.skills.register(shadow)                ← C 通道（技能）
              scoped.tools.restrict({ deny })               ← D 通道
          })
```

三个时序事实决定了实现方式：

1. `assemble()` 在 `agent/pre-step` **之前**执行，所以 per-session 注册必须发生在 `agent/created`，不能等 pre-step。
2. 段落与上下文不能用「同名空文本再注册一次」的办法关掉：agent preset 已经在**同一作用域**注册了这些名字，再注册会抛 `already registered in this scope`。公开的改写点是 scoped `system-prompt/assemble` 瀑布。
3. `tools.restrict()` 只能在作用域上下文里调用；名单必须来自该会话真实的 `schemas(agent)`，否则未知名字会抛错。

`resume` / `compact` 不处理：它们带着已有历史，中途改写不是「默认策略」该做的事。

## HTTP 面

全部挂在 `/plugins/dsh-injection-manager` 下，共 18 条路由：**15 条 GET + 3 条 POST-only**（`/action` 改策略；`/boot`、`/registrations` 是客户端自报诊断，二者收到 GET 会返回 405）。GET 不改策略、不改工作区；快照路由会刷新本机 `stats.json`，见「安全边界」。

| 路由 | 方法 | 作用 | 响应要点 |
| --- | --- | --- | --- |
| `/ping` | GET | 注册自检 | 路由清单、策略文件路径 |
| `/summary` | GET | 面板快照 | `apiVersion: 3`、`healthSummary {high,warn,info}`、`items[].preview`、`items[].origin`、`groups[].on*`、`numbers {session,next}`、`settings`、`locale`；`?lang=zh｜en｜…` 只回该语言 + en 兜底，不带 `lang` 回全部 8 份（`/locale` 用） |
| `/content` | GET | 单条原文 | `?channel=&id=[&session=]`；`contentType`、`content`、`bytes`、`truncated`、`sourcePath`、`note`；256KB 上限、2 秒预算、404/400 分支 |
| `/trend` | GET | 跨会话趋势 | `?range=all｜30d｜7d&limit=120`（上限 500）；`points[]`、`aggregate`、`coverage {recorded, known}`、`backfilling` |
| `/events` | GET | 事件流 | `?session=&limit=60`（上限 300）；`events[]`、`coverage {from, count, limit}` |
| `/health` | GET | 健康检查 | `?session=`；`summary {high,warn,info,checkedAt}`、`checks[]`（`code`、`severity`、`params`、可选 `action`） |
| `/stats` | GET | 历史与覆盖 | `stats.json` 内容 + `sessions` 头信息（≤60）+ 最近一轮 `backfill` + `backfilling` + `coverage` |
| `/policy` | GET | 策略文件状态 | 策略、路径、是否迁移、最近一次应用 |
| `/verify` | GET | 生效核对 | `?session=`；重新装配后的段落/上下文/工具名 |
| `/diag` | GET | 诊断 | 客户端 boot、最近应用、过滤器调用计数、宿主版本 |
| `/export` | GET | 导出 | Markdown / JSON |
| `/locale` | GET | 八语言字典 | 客户端词条 |
| `/registrations`、`/boot` | **POST** | 客户端自报诊断（仅内存） | 启动表与注册诊断，不落盘；GET 返回 405 |
| `/action` | **POST** | 改策略入口 | 同源 JSON；开关/预设/导入/撤销 |

约定的响应边界：JSON 单次响应有上限，`/summary` 的条目文本靠 `preview` 控制体积，语言字典靠 `?lang=` 控制（客户端只取自己那份 + en，单次约 267KB → 约 150KB；`/locale` 仍取全部八份）；`/content` 的 256KB 上限和 UTF-8 安全截断在 `lib/content.js` 里实现；`/trend` 的 `limit` 与被回填的会话数都封顶；`/events` 读的是已经封顶 300 条的 `events.json`。

## 数据文件

| 位置 | 内容 | 谁写 | 生命周期 |
| --- | --- | --- | --- |
| `$DSH_HOME/injection-manager/policy.json` | 通道模式、名单、前言后记 | 面板动作与 `/inject`（写队列 + 原子写） | 持久，卸载后保留 |
| `$DSH_HOME/injection-manager/policy.json.bak` | 上一份能解析的策略 | 每次写策略前复制（已有旧文件时） | 持久；`policy.json` 损坏时用于恢复 |
| `$DSH_HOME/injection-manager/stats.json` | 每个会话一行测量：`allOn` / `effective` / `saved` / `peak` / `samples` / `firstAt` / `scope` / `policy` / `compactions` / 新快照才有的 `channels` | 每次 `buildSnapshot()`（面板/工具/命令/导出/健康检查），以及趋势后台回填 | 上限 400 行，原子写，可被日志回填补齐 |
| `$DSH_HOME/injection-manager/events.json` | `{version:1, events:[…]}`，最多 300 条；每条 `id` / `at` / `kind` / `params`（拍平的原始值，字符串 ≤200 字符，≤24 项）/ `tokensDelta` / 可选 `sessionId` / `dedupeKey` | 策略保存、预设、导入、撤销、压缩 | 追加式；tmp+rename；去重键防重放 |
| `$DSH_HOME/injection-manager/` 的旧目录 | `context-injection/`、`context-preflight/` | 只在首次读取时迁移 | 只读兼容 |
| 插件行 `config` | dock / refreshOnFocus / showRawNames | Plugins → Configuration | 持久 |
| 浏览器 localStorage | 抽屉行号、洞察范围、被关掉的 gate 卡 | 面板 | 只在这个浏览器 |
| 内存 | 撤销栈（20 步）、最近一次应用结果、客户端 boot 报告、压缩回执（按会话）、路由窗口容量缓存 | 进程内 | 重启清空 |

不上传、不联网、不写 workspace 文件。读路由会刷新 `stats.json`，但不改工作区与策略。

## 策略写入

`policy.json` 的每一次修改都是读-改-写，2.2.0 起由 `lib/lock.js` 的进程内队列串行化：

- `withPolicyLock(task)` 把任务排在前一个任务之后，前一个失败不会卡住队列，每个调用仍拿到自己的结果或错误；
- `POST /action` 的「读策略 → 应用动作 → 读回状态」整体在队列里，`/inject` 快捷清单里的预设、撤销和单个套件开关也走同一把锁，所以同一个 DSH 进程里两个窗口各关一个套件时两次修改都会保留；
- 锁只覆盖本进程：两个 DSH 进程共享同一个 `DSH_HOME` 不在保证范围内，原子 rename 至少保证不会写出半个文件；
- `lib/policy.js` 的 `writePolicy()` 自己还有一条写链，即使调用方不在队列里也不会并发写同一个文件；
- 临时文件名是 `policy.json.tmp-<pid>-<计数器>-<随机后缀>`，同一毫秒内的两次写不会撞名；
- 写新文件前先复制当前文件为 `policy.json.bak`（首次写或旧文件读不到时跳过）；`readPolicy()` 解析失败时先读 `.bak`，成功则返回 `{recovered: true, error: '...; recovered from .bak'}`，只有备份也不可用才回落到全开并带错误。

失败语义：读不到文件（`ENOENT`）仍按旧逻辑找历史目录；坏 JSON 不再静默丢开关。

## 事件埋点

`lib/events.js` 是唯一的写入口，`appendEvent()` 永不抛错（事件流是锦上添花，写失败不能把一次策略保存变成错误）。当前会产生事件的来源：

| 位置 | kind | 说明 |
| --- | --- | --- |
| `index.js` 的 `agent/created` | `session-created` | 新会话建立（`source: startup｜clear`），fire-and-forget，不进首轮关键路径 |
| `lib/apply.js` 的 `savePolicy()` | `policy-saved` / `preset` / `switch` / `import` / `undo` | 由调用方通过 `meta` 指定，缺省 `policy-saved` |
| `lib/compaction.js` 的摘要/剪枝回执 | `compaction` / `prune` | 宿主的 `compaction/summary`、`compaction/prune` 事件 |
| `lib/compaction.js` 的失败回执 | `diagnostic` | 宿主报告 `compaction/*` 带 `error` 时写一条：`params {phase:'compaction', error, compactionId}`，用于解释"这次压缩失败了" |

`model-switch` / `mode-toggle` 目前在枚举里预留、本版本不会主动产生（还没有对应的宿主事件入口）；`/inject` 清单只读快照，也不写事件。也就是说：**写策略、压缩/剪枝、压缩失败、新会话**会留下事件，其余读取不会。

去重键 = `时间戳｜kind｜params 的稳定哈希`（压缩事件可由调用方给显式 `dedupeKey`，如 `seq/compactionId`），因此同一条宿主事件被观察两次不会变成两行。`params` 只收原始值：嵌套对象直接丢弃，数组最多 20 项，字符串截到 200 字符——会话正文没有路径能进这个文件。

## 健康检查

`lib/health.js` 的 `buildHealth(snapshot)` 是纯函数：输入一份快照，输出 `{summary, checks}`；唯一的时钟值是 `snapshot.generatedAt`，所以同一份快照两次调用逐字节一致。面板的健康页、`/health` 路由都调它。

- 固定 9 个 code 的枚举，当前实现实际会产生 7 个：`heavy-suite`（策略生效后，**安装的插件 / MCP 套件**仍占 ≥25% 或 ≥30k token）、`builtin-heavy`（同类阈值但来源是 DSH 自带套件：只报 info、不给 action——关宿主的工具族不是合理默认）、`catalog-truncated`（描述被目录行截断）、`locked-items`（不可关项 ≥10%）、`unknown-window`（无测量）、`no-policy`（从没保存过策略且全开）、`empty-catalog`（目录为空且完整）。来源取自 `group.origin`：`plugin` 才进 `heavy-suite`，`builtin` 进 `builtin-heavy`；没有 `origin` 的旧快照按可行动处理，行为不变。
- 检查一律读**有效投影**（`groups.onTokens` / `groups.onSavableTokens` / `snapshot.effective.totals`），不是当前会话冻结的全量装配：当前会话里已经关掉的套件条目还在（本会话不受新策略影响），但它的有效 token 是 0，所以关掉一套之后它自己的告警立刻消失。快照没有 `on*` 字段时回退到全量口径，旧宿主行为不变。
- `duplicate-skill` 与 `tool-name-collision` **刻意不产生**：这版宿主的技能注册表与工具注册表在插件可见之前就解析掉了重名，报出来就是编造。枚举保留完整，未来宿主能观察到时再加，UI 契约不变。
- `action.kind` 只有三种：`switch-group` / `open-content` / `open-tab`；`payload` 直接是 `POST /action` 能吃下的形状（`{channel, group, enabled, op}` 等），`switch-group` 额外带 `parts[]`（这套覆盖的每个 `channel+group`），面板一次点掉所有通道；旧宿主只给 `channel+group` 时面板按 label 反查。动作不再做二次映射。
- 幂等：`POST /action` 写盘前比较前后策略，相同则返回 `changed:false`，不写 policy、不写 undo、不写事件；面板据此不弹「已关闭」提示，也不会出现同一开关在撤销历史里堆 7 条。
- 排序：严重度 → 涉及 token 数 → code；`summary` 按严重度计数，`checkedAt` 来自快照。

## 内容透视

`lib/content.js` 回答「这一行到底是什么」。两条硬规则：

1. **路径白名单**：只打开快照自己收集时登记过的路径（技能的注册路径、工作区规则探测到的文件）。接口不接受调用方给的路径，因此不可能变成任意文件读取。
2. **截断安全**：上限按字节卡（HTTP 256KB、模型工具 32KB），在码点边界切，绝不切坏多字节字符；响应里的 `bytes` 描述的是实际返回的前缀。

`sourcePath` 只有在真的来自磁盘时才有；`note` 说明来源：`catalog`（技能没有定位到 SKILL.md，给的是目录行）、`file`（磁盘文件）、`assemble`（系统提示词装配结果，无单文件）、`snapshot`（会话快照）。工具内容做 JSON 格式化后返回（`contentType: json`），面板在抽屉里拆成「描述 / 参数表 / 原始 JSON」三视图。路由层给这次收集套 2 秒预算，超时返回 `timeout` 而不是半个结果。

## 洞察数据

`lib/trend.js` 只合并两种诚实来源：本插件写下的 `stats.json` 行（`measured`）和有界的 durable-log 回填（`log`）。回填在**后台**跑，读取从不 await 它：一个进程内单飞的任务，冷却 60 秒、每轮最多 8 个会话、单轮预算 6 秒；`/trend` 立即返回已有行并带 `backfilling: true`，后续轮询会看到后台补进来的行。这样 671 个会话的语料不会让每次打开洞察页都等 7 秒。

- 老行与日志行没有通道分解：`channels` 报 `null`，不补 0；UI 画斜纹。
- 排序按 `firstAt`（时间轴左→右），`limit` 取最近的 N 个点；`aggregate` 在切 `limit` **之前**算，所以汇总代表整个范围而不是「最近 120 个」。
- 契约修订（2026-11-16）：`scope` 是自由字符串（常见 `startup｜clear｜route.session｜backfill`，未知值原样透传、截到 64 字符），`policy` 允许 `all｜minimal｜custom｜unknown`——不为迎合枚举而改写历史数据。
- `coverage {recorded, known}`：`known` 来自 `sessionQuery.listSessions()` 的头信息数量（可失败为 `null`），`recorded` 是范围内的行数。UI 的覆盖率脚注就是这两个数。

## 五个入口与槽位

2.3.0 起，同一份快照有五个入口，各自落在不同的宿主槽位/服务上。槽位名是宿主契约；自审脚本
（`scripts/self-audit.mjs` 的 reconcile 项）检查这五个名字既在 `client.js` 里注册、也在本文档里
出现——宿主升级后某个槽位改名，自审会先失败，而不是等到用户发现入口消失。

| 入口 | 宿主槽位 / 服务 | 数据来源 | 是否写 |
| --- | --- | --- | --- |
| 洞察页面（管理/洞察/设置） | `sidebar.panellist` + `main` | `GET /summary` | 开关、预设、导入、撤销（`POST /action`） |
| 会话标签页「注入」 | `conversation.view` | `GET /summary?session=<id>` | 只读 |
| 右侧边栏面板 | `sidebarRightTabs.register({id, kind, title, guide})` + `sidebar.right.pane.tab` + `sidebar.right.pane.tab.title` | `GET /summary` | 开关（`POST /action`） |
| 斜杠命令 `/inject` | 客户端 `commandUi` 服务（`ctx.inject(['commandUi'])`） | `GET /summary` | 预设、撤销、逐套件开关（`POST /action`） |
| 设置 → 通用设置偏好行 | `settings.general.item` + `configForms.get('injection-manager')` | 插件行 `Config` | 三个 volatile 字段 |

规则：

1. **一份快照，五个读法。** 五个入口都从 `buildSnapshot()` 出来的同一份 payload 取数；面板显示的
   `numbers.session`/`numbers.next` 与会话标签页、右侧栏、`/inject`、工具卡是同一对数，没有入口
   自己再算。
2. **会话标签页只读。** 策略在 `agent/created` 时应用一次，运行中的会话不会被改写；把开关放进
   会话页会让“关掉”看起来像改了当前对话。会话页只讲它带着什么。
3. **右侧栏是迁移不是新增。** 旧 `sidebar.panel` 槽在 0.2.2-rc.5 已不存在，2.3.0 迁到
   `sidebarRightTabs`；在既没有该服务、又声明了旧槽的旧宿主上才保留旧注册（同一屏只出现一个面板）。
4. **偏好行走宿主配置表单。** `Config` 三个字段是 `.volatile()`，写后原地更新、不重启插件；
   `configForms` 是可选客户端服务，缺失时偏好行只读显示生效值并在文案里说明。
5. **`/inject` 走客户端 `commandUi`，不是宿主 `commands`。** 宿主命令只有一个 name/description 加
   handler、返回纯文本，没有 icon 字段（图标是客户端 presentation 里写死的），所以 2.3.2 起 `/inject`
   注册在 `client.js`：带图标、可搜索的弹层，前四行是动作（打开面板 / 最小预设 / 全开 / 撤销），
   后面按 token 排序列出可动套件（最多 8 个），点一角即写 `POST /action`。数据和面板同源
   （`GET /summary`），宿主没提供 `commandUi` 服务时这个入口不出现，其余入口不受影响。

## 包结构

```
index.js            插件入口：Config、工具（含单条内容模式）、路由、agent/created
lib/snapshot.js     快照、套件聚类、来源分类、行内预览、策略预览
lib/apply.js        四通道生效 + 策略保存（含事件埋点）
lib/group.js        套件聚类
lib/policy.js       策略 schema、串行原子写、`.bak` 恢复、旧目录迁移
lib/lock.js         策略读-改-写队列（进程内，POST /action 与 /inject 共用）
lib/routes.js       HTTP 面（18 条路由、同源写校验、安全头）
lib/content.js      内容透视：白名单读取、UTF-8 安全截断
lib/events.js       事件流：校验、去重、封顶、原子写
lib/trend.js        跨会话趋势：stats + 有界日志回填合并
lib/health.js       健康检查：纯函数、固定 code 集
lib/stats.js        历史记录、通道分解、日志定价回填
lib/history.js      撤销栈
lib/settings.js     Config 归一化
lib/catalog.js      注入面归属与可控性目录（按宿主源码包/行号标注）
lib/ledger.js       注入台账：内容寻址原文、每请求记录、只读 API
lib/ledger-capture.js 装配瀑布与 pre-step 的采集层（记录 offered/admitted）
lib/text.js         模型卡片、文本报告
lib/instructions.js 工作区规则只读探测
lib/pressure.js     窗口占用（tokenMeter / contextBreakdown / llm 容量）
lib/compaction.js   压缩回执（session/event 上的 compaction/*）
client.js           浏览器半包：面板三页、侧栏、输入框徽标、内容抽屉、`/inject` 弹层
locale/*.json       八语言字典（宿主展示用 meta + 客户端词条）
```

## 注入台账（3.0.0）

面板第 4 个分区「台账」回答的是**每次请求实际注入了什么**，数据不是从服务再推一遍，而是装配现场
直接采下来的：

| 采集点 | 拿到的内容 | 证据 |
| --- | --- | --- |
| 插件级 `system-prompt/assemble` waterfall（先注册，先跑，`await next()` 之后记录） | `offered`（其它监听器之前）与 `admitted`（本插件策略过滤之后）的 sections / contexts / variables；同一次装配的 `ctx.tools.schemas()` | `dsh-system-prompt/src/index.ts:125-134,205-233`；`dsh-agent-loop/src/agent.ts:300` |
| 插件级 `agent/pre-step` waterfall（`await next()` 之后） | 该步的 turn/step 与决定注入的消息级内容（技能目录、AGENTS.md、时间、计划/目标/提醒等 `source.kind`） | `dsh-agent-loop/src/agent.ts:302,448-483`；`dsh-tool-skill/src/index.ts:281` |

边界与诚实说明：

- 装配 waterfall 拿到的是 `PromptPresentation`（sections/contexts/variables），**不含 tools**；
  工具 schema 是另取 `ctx.tools.schemas(agent)`，与 `buildRequest(assembly.tools)` 同一个来源。
- 没有 `agent` 字段的装配（面板自己的快照、诊断）**不记录**，所以打开面板不会污染台账。
- 段落/上下文的原文写进内容寻址的 `ledger-text/<sha1>.txt`（同文只存一份，512KB 上限）；
  消息级内容与变量**只留预览不落盘**，因为那是对话内容。
- token 是估算（ASCII÷4 + 其他÷1.6），不是 provider 计费口径；provider usage 是另一个数。
- 「插件能不能管」由 `lib/catalog.js` 的静态归属表给出，每条都写宿主源码包与行号；目录里没有的
  来源一律标 `preview`，不假装能关。

## 安全边界

- **所有 18 条路由入口先过宿主的准入栅栏。** `webServer.register` 前统一包一层
  `makeFencedHandler(ctx, handler)`：每个请求先问 `ctx.connection.requestRejection(req)`
  （DSH 自己的 Host/Origin 准入 + 浏览器/API 凭据）。宿主返回 `401/403` 时由栅栏直接应答
  （空 body + `nosniff`/`no-referrer`/frame-deny/`no-store`），路由逻辑、文件与策略都不执行；
  返回 `undefined` 才放行；只有宿主明确返回 401/403 时才拒绝（失败开放：缺服务、缺方法、抛错、异常返回值都放行）。
- **栅栏可降级，不是硬依赖。** `connection` 没有加进 `inject`：宿主缺少该服务（旧版本、或启动
  早期）、没有 `requestRejection` 方法、或调用抛错时，栅栏跳过，路由保持 2.0.0 的行为——安全
  栅栏不能把面板变砖。
- 写操作（`POST /action`）在此基础上仍要求 `content-type: application/json`，且
  `sec-fetch-site` 不是跨站；带 `Origin` 时还要求 host 与页面一致。
- 所有 JSON 响应带 `x-content-type-options: nosniff`、`x-frame-options: DENY`、`cache-control: no-store`。
- **GET 路由不改策略、不改工作区**：`/summary`、`/export`、`/health` 会重新 `buildSnapshot()`，因此会刷新本机 `stats.json` 的一行统计（`lib/stats.js` 的 `recordSnapshot()`）；`/trend`、`/stats` 的后台回填也只写这份统计。除此之外，`/content`、`/events`、`/verify` 只读各自的文件与内存快照，没有任何 GET 会写 `policy.json` 或 workspace 文件。
- `/content` 是唯一读磁盘内容的接口，但路径来自快照登记，不接受外部路径；有 2 秒预算与 256KB 上限。
- 策略、统计、事件写入都是同目录临时文件 + rename；策略写还串行化并保留 `.bak`，崩溃或坏文件都能退回上一份好策略。
- 插件不发起网络请求，不上传策略或会话内容；`events.json` 只收策略与被截断的原始值。

## 测试

| 文件 | 覆盖 |
| --- | --- |
| `test/policy.test.mjs` | 模式语义、必填锁定、自定义人设替换 |
| `test/policy-write.test.mjs` | 并发写不丢、临时文件名唯一、坏 JSON 从 `.bak` 恢复 |
| `test/group.test.mjs` | MCP/前缀/provider 聚类、汇总 |
| `test/settings.test.mjs` | 配置归一化与默认值 |
| `test/text.test.mjs` | 工具卡片、文本报告与健康摘要的数字/告警 |
| `test/apply.test.mjs` | 假 ctx 下四条通道端到端、幂等、resume 跳过 |
| `test/routes.test.mjs` | 动作/撤销/导出/同源校验、新路由的分支 |
| `test/pressure.test.mjs` | 占用分子/分母、容量兜底与缓存、缺数据不瞎猜、阈值档位 |
| `test/compaction.test.mjs` | 摘要/剪枝/失败回执、未知会话、事件转发 |
| `test/content.test.mjs` | 白名单、UTF-8 截断、四种 `note`、404/400、超时 |
| `test/events.test.mjs` | 去重、封顶、参数拍平、原子写、读窗 |
| `test/trend.test.mjs` | 范围切分、`channels: null`、聚合先于 limit、覆盖率 |
| `test/health.test.mjs` | 每个 code 的触发条件、排序、summary、不产生的 code |
| `test/tool-content.test.mjs` | 模型工具单条模式：参数校验、32KB 上限、错误 JSON |
| `test/command.test.mjs` | `/inject` 子命令（含 health）与错误分支 |
| `test/fence.test.mjs` | 准入栅栏：缺服务/无方法/undefined/抛错放行，401/403 拒绝且 handler 不执行，18 条路由全包，旧宿主路径仍可用 |
