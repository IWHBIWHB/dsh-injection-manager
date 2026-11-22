# DSH 上下文注入全景（0.2.2-rc.5）

这份文档回答一个问题：**一次 DSH 模型请求里，"上下文"到底从哪里来、怎么进去、谁能改、改到什么程度。**
所有结论都对着运行中的 DSH Desktop 0.2.2-rc.5 源码（从 `app.asar` 解出的只读副本，
`D:\DSH\_dsh-src\dsh\node_modules\@deepseek-ai\`）；引用格式 `包/src/文件.ts:行号`。
文档与源码冲突时以源码为准，并单独列出冲突。

## 1. 一轮请求怎么组装

```
agent/created
  └─ 每步（step）：
       systemPrompt.assemble({ agent, modelSelection, toolSet })
         ├─ sections  （静态/动态文本，按 order 升序，name 决胜）
         ├─ contexts  （动态运行时上下文，按 order）
         ├─ variables （{{model}} 等插值变量）
         └─ tools     （provider 给出的 schema，按 order 规范化）
       agent/pre-step（decision.messages）  → 技能目录、AGENTS.md、时间、提醒等消息级注入
       renderPrompt(assembly)              → 拼成一段 system 文本
       refreshContext(assembly)            → 重新解析 context 提供者（admission；required 会补回）
       systemPrompt.project(renderedPrompt)→ 提交 system/message「表层节点」
       runtimeContext.project(sections)    → 提交 user/message 运行时上下文快照
       buildRequest(assembly.tools)        → 真正发给模型：历史表层 + tools
```

证据：`dsh-agent-loop/src/agent.ts:300,302,448-485`；`dsh-system-prompt/src/index.ts:125-134,205-233`。

关键事实：

1. **系统提示词不是请求里的 system 字段**，而是被渲染成派生历史里的 `system/message` 表层节点
   （首步是节点 0；文本变了就原地替换，`systemPromptUpdate:'in-history'` 时追加到缓存历史之后）。
   证据 `dsh-system-prompt/src/index.ts:46`、`dsh-agent-loop/src/agent.ts:459-470`。
2. **运行时上下文是 user/message**，按 `required` 与 suppression 决定是否保留；
   `refreshContext` 会把缺失的 required 项按注册顺序补回来。证据 `dsh-system-prompt/src/index.ts:537-543`（suppress）、`:589-609`（refresh）。
3. **工具 schema 与提示词文本是两条路**：waterfall 只能改提示词文本，工具声明归 provider
   （`PromptPresentation` 没有 tools，`PromptAssembly` 才有）。证据 `dsh-system-prompt/src/index.ts:125-134`。
4. 每一步都重新 assemble；`assemble()` 在 `agent/pre-step` **之前**，所以 pre-step 改不了
   system/tools，但能看到并改写该步要注入的消息。证据 `dsh-agent-loop/src/agent.ts:300,302`。

## 2. 六个注入面（完整清单）

| # | 面 | 进入方式 | 内容来源 | 插件能做什么 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S1 | 系统提示词段落 `sections` | 渲染成 system/message 表层节点 | 宿主/插件注册的 `PromptSection` | 在 `system-prompt/assemble` waterfall 里看到逐段原文、删除或改写 | `dsh-system-prompt/src/index.ts:52-76`、`:621-696` |
| S2 | 动态运行时上下文 `contexts` | user/message 快照 | `PromptContext` 提供者 | waterfall 删除；`required:true` 会被 `refreshContext` 还原；`suppressRuntimeContext()` 关可选 runtime context | `dsh-system-prompt/src/index.ts:78-90`、`:537-543`、`:589-609` |
| S3 | 工具 schema `tools` | `buildRequest(assembly.tools)` | 工具 provider（内置工具、MCP、PTC） | `ctx.tools.restrict({allow,deny})` 按 agent 作用域增删可见性；waterfall 改不了 | `dsh-tools/src/index.ts:99-226,316`；`dsh-agent-loop/src/agent.ts:485` |
| S4 | 消息级注入 | 每条 user/message 的 `source.kind` | 技能目录、AGENTS.md、时间、tmux、计划/目标/提醒、压缩摘要 | 预览（`agent/pre-step` 的 decision.messages）；删除属实验性、宿主可能下一步再发 | `dsh-agent-loop/src/agent.ts:456-483`；各注入者行号见 §3 |
| S5 | 插值变量 `variables` | 渲染 `{{var}}` 时 | `ctx.systemPrompt.variable()` | 可注册/覆盖；变量本身不是内容 | `dsh-system-prompt/src/index.ts:568-577` |
| S6 | 请求参数 | 请求头 | 会话模型选择（provider/model/reasoningEffort/maxTokens） | 只读展示（台账记录每次的 model/provider） | `dsh-agent-loop/src/agent.ts:661-727` |

## 3. 注入点逐条清单（谁在写、写在哪个面、什么顺序）

### S1 系统提示词段落（order 值来自 `dsh-system-prompt/src/index.ts:136-189`）

| 段落名 | order | 注册者 | 文本来源 | 证据 |
| --- | --- | --- | --- | --- |
| `harness:identity` | -1000 | dsh-system-prompt | 固定一句 | `dsh-system-prompt/src/index.ts:458` |
| `deployment:persona-prefix` / `-suffix` | 0 / 10200 | dsh-persona、agent preset | 配置或预设，可标 `complete` | `dsh-persona/src/index.ts:65-71` |
| `plan:policy` | 500 | dsh-plan-mode | 计划模式规则 | `dsh-plan-mode/src/index.ts:199` |
| `team:policy` | 600 | dsh-tool-agent-team | 团队协作规则 | `dsh-tool-agent-team/src/index.ts:114` |
| `tools:ptc-only` / `tools:sdk` | 800 / 5000 | dsh-tool-executor-ptc | PTC 模式说明 | `dsh-tool-executor-ptc/src/index.ts:36-37` |
| `context:file-reference` | 900 | dsh-file-reference-local | `@` 文件引用说明（没有 read 工具时为空） | `dsh-file-reference-local/src/index.ts:73` |
| `tool:bash` / `tool:pwsh` | 1000 / 1010 | dsh-tool-bash / dsh-tool-pwsh | 工具使用提示 | `dsh-tool-bash/src/index.ts:272` |
| `tool:read` / `write` / `edit` / `apply_patch` | 1100-1350 | dsh-tool-fs | 工具提示（工具不存在时为空） | `dsh-tool-fs/src/read.ts:69-71`、`write.ts:63-65`、`edit.ts:77-79`、`apply-patch.ts:18-19` |
| `tool:glob` / `grep` | 1400-1500 | dsh-tool-fs-search | 同上 | `dsh-tool-fs-search/src/glob.ts:314`、`grep.ts:279` |
| `tool:jobs` / `tool:pty` / `tool:pty-panel` | 1600-1710 | dsh-tool-jobs / dsh-tool-terminal / dsh-terminal-panel | 同上 | 各自 `index.ts` |
| `tool:web-search` / `web-fetch` / `lsp` / `session-query` / `goal` / `schedule` / `workflow` / `ralph` / `subagent` / `report` / `computer-use` | 2000-3000 | 对应工具包 | 同上 | 各自 `index.ts` |
| `mcp:<server>` | 3100 | dsh-mcp-client | MCP `initialize.instructions` 或资源提示 | `dsh-mcp-client/src/server-context.ts:33-38` |
| `mcp-resource-servers` | 3100 | dsh-mcp-resources | MCP resources 说明 | `dsh-mcp-resources/src/index.ts:64` |
| `ui:deliverable-file-references` | 9000 | dsh-deliverable-file-references | 交付物引用说明 | `dsh-deliverable-file-references/src/index.ts:27` |
| `harness:source` / `app:web-surface` | 10000 / 10100 | dsh-harness-dev-context | 本地 checkout 与 Web 表面事实 | `dsh-harness-dev-context/src/index.ts:134,146` |
| `computer-use:dsh-cua` | 3000 | dsh-cua | 电脑操作说明 | `dsh-cua/src/index.ts:365` |
| `tool:<structured_output>` | 9900 | dsh-subagent | 结构化输出要求（子智能体） | `dsh-subagent/src/structured.ts:109` |

### S2 动态运行时上下文

| 上下文名 | order | required | 注册者 | 证据 |
| --- | --- | --- | --- | --- |
| `working-directory:current` | 100 | **是** | dsh-working-directory | `dsh-working-directory/src/index.ts:109-113` |
| `sandbox:policy` | 110 | 否 | dsh-sandbox-policy | `dsh-sandbox-policy/src/index.ts:183` |
| `approval:policy` | 115 | 否 | dsh-user-approval | `dsh-user-approval/src/index.ts:190` |
| `subagent:delegation` | 120 | 否 | dsh-subagent（子代理作用域） | `dsh-subagent/src/child-agent.ts:206` |
| `harness:source` / `app:web-surface` | 200 / 210 | 否 | dsh-harness-dev-context | `dsh-harness-dev-context/src/index.ts:140,152` |

### S3 工具 schema

- 注册：`ctx.tools.register(ToolDefinition)`；每步由 provider 给出本次 assembly 可见集合
  （`ToolProviderResult{schemas,knownNames}`）。证据 `dsh-tools/src/index.ts:99-160`。
- 限制：`ctx.tools.restrict({allow,deny})` 必须挂在 agent 作用域（全局限制会抛错）；未知名字抛错。
  证据 `dsh-tools/src/index.ts:162-187`。
- MCP 工具命名 `mcp__<server>__<tool>`，MCP 连接/断开直接改变 schema 集合。
  证据 `dsh-mcp-manager`、`dsh-mcp-client`。

### S4 消息级注入（`user/message.source.kind`）

| kind | 谁发 | 何时 | 证据 |
| --- | --- | --- | --- |
| `runtime-context` | agent-loop | 每步，S2 的渲染结果 | `dsh-agent-loop/src/agent.ts:452-477` |
| `agent-instructions` | dsh-agent-instructions | 首请求、文件变化、会话恢复 | `dsh-agent-instructions/src/state.ts:88`、`src/index.ts:197,236` |
| `skill-catalog` | dsh-tool-skill | 目录变化时重发 | `dsh-tool-skill/src/index.ts:281-320` |
| `time-context` | dsh-time-context | 时间变化 | `dsh-time-context/src/index.ts:238` |
| `tmux-context` | dsh-tmux-context | tmux 面板内容变化 | `dsh-tmux-context/src/index.ts:265` |
| `repeat-tool-reminder` | dsh-repeat-tool-reminder | 同一工具连续重复 | `dsh-repeat-tool-reminder/src/index.ts:212` |
| `plan-mode` | dsh-plan-mode | 模式切换 | `dsh-plan-mode/src/index.ts:478` |
| `goal` | dsh-goal-round-driver | 目标轮次续跑 | `dsh-goal-round-driver/src/index.ts:194` |
| 压缩摘要（compact checkpoint，`source.kind='compact-checkpoint'`） | dsh-compaction-basic | 压缩发生时 replace 一段历史 | `dsh-compaction-basic/src/region.ts:412-509`、`dsh-compaction/src/checkpoint.ts:19-25` |

其他用户内容（附件、`@` 文件引用、引用消息、工具结果）同样是消息，但由用户按输入/工具自然产生，
不在"注入器"之列。

### S5/S6

- 变量：`model`/`provider` 由 agent-loop 注册（`dsh-agent-loop/src/index.ts:336-337`），
  预设/插件可注册更多；引用不存在的变量会让渲染失败。
- 请求参数：模型选择来自会话头（`requestHeader().config`），影响窗口预算与缓存，不属于注入文本。

## 4. 优先级与覆盖规则

1. **scope 遮蔽**：scoped 的 section/context 与全局同名时遮蔽全局；同一层重复注册直接抛错。
   证据 `dsh-system-prompt/src/index.ts:627-658`；同名重复注册抛错见 `:414-422,486-488,521-523`。
2. **order 排序**：section 升序后按 name 决胜；context 只按 order。证据 `:254-257,:678-681`。
3. **complete 段落**：恰好一个 `complete` 段落会成为唯一提示词段落，waterfall 之后再被还原；
   多于一个装配失败。所以"被标 complete 的 persona"插件改不动。证据 `:660-695`。
4. **required 上下文**：`suppressRuntimeContext()` 只压可选上下文；required 会被 `refreshContext`
   按注册顺序补回。证据 `:155-163,184-194`。
5. **waterfall 文本权威**：`system-prompt/assemble` 返回的文本是权威的，但工具声明仍归 provider。
6. **失败语义**：注册期（重名、非有限 order）、装配期（complete 冲突、未知工具名）、渲染期
   （变量缺失）全部 fail loud，不会静默降级。证据 `:215-247,346-384,660-663`。

## 5. 可见性：现在能看见什么

| 渠道 | 内容 | 口径 | 证据 |
| --- | --- | --- | --- |
| 面板/`GET /summary`（本插件） | 段落/上下文/技能/工具/规则的行内预览与估算 token | 估算 | `lib/snapshot.js` |
| `ctx.tokenMeter.contextPressure(session)` | 窗口占用：provider 实测 prompt + 增量 | 实测（占主导） | `dsh-token-meter/src/index.ts:161-196` |
| `sessionProjections.contextBreakdown` | 系统/工具/消息构成 | 纯估算 | `dsh-token-meter/src/projection.ts:52-68` |
| 对话页 usage | 每次请求 provider 计费 token | 实测 | `dsh-client-ui-chat` |
| `agent/pre-step` decision.messages | 本步将注入的消息级内容 | 原文，可预览 | `dsh-agent-loop/src/agent.ts:456-483` |
| `system-prompt/assemble` waterfall | 本步将注入的段落/上下文原文（含 offered/admitted） | 原文 | `dsh-system-prompt/src/index.ts:18-31`、`:621-696` |

## 6. 可控 / 不可控边界（本插件的判定）

| 边界 | 内容 | 依据 |
| --- | --- | --- |
| **插件可管** | S1 段落（除 complete 段落）、S2 上下文（除 required）、S3 工具 schema、技能目录条目（同名不可调用技能遮蔽）、persona 前后缀替换 | 上述 APIs |
| **宿主保护** | `working-directory:current` 等 required 上下文；被 preset 标 `complete` 的 persona | `refreshContext` / complete 语义 |
| **只能预览（插件不可控）** | S4 消息级注入（时间、tmux、计划/目标/提醒、AGENTS.md、技能目录消息、压缩摘要） | 由各自包在 pre-step 注入；「用 pre-step 过滤是否会被宿主下一步重发」**未在源码层面证实**，属设计假设，默认不做 |
| **用户内容** | 附件、`@` 文件引用、引用消息、工具结果、用户消息 | 用户输入/工具执行产生 |
| **宿主配置（用户改）** | AGENTS.md 文件、技能文件、模型/预设/推理档位、MCP 服务器配置、压缩阈值 | 文件或宿主 UI |

## 6.1 required 上下文的特殊说明

`required: true` 的上下文（`working-directory:current`、`subagent:identity`）即使被 waterfall 删掉，
`refreshContext` 也会按注册顺序补回（`dsh-system-prompt/src/index.ts:589-609`）。所以策略里「关掉」
它们不会改变实际请求；台账把它们记成「宿主还原」，不计入「被策略拦下」。

## 7. 已知未验证项

- `agent/pre-step` 多个监听器的相对顺序（同一 step 有模型切换、指令协商、压缩等多个监听器）。
- `systemPromptUpdate:'in-history'` 路由在真实会话里的形态（哪些请求会走追加而不是原地替换）。
- 压缩后 runtime-context 的重发时序（压缩会移除旧 runtime-context 节点，下一步重新注入）。
- provider `usage` 与估算 token 的稳定映射（不同模型/内容类型偏差不同）。
- 0.2.0 / 0.2.1 宿主上 `commandUi` 与 waterfall 行为（未装两代旧宿主实测本轮新代码）。

## 7.1 核查记录

本文件经过一次独立核查（29 条抽查）：机制结论成立；修正了 9 处把同目录 `docs/subsystems/system-prompt.md`
行号误写成 `src/index.ts` 行号、4 处文件归属（tool-fs 四文件、fs-search 两文件、mcp-client server-context、
agent-instructions state）、1 处包路径（contextBreakdown 在 `dsh-token-meter`）、以及每步顺序
（`assemble → agent/pre-step → refreshContext → project`）。无法证实的说法已标成假设。

## 8. 文档与源码冲突（以源码为准）

| 文档说法 | 源码事实 | 证据 |
| --- | --- | --- |
| 上游文档把 plan 段落的 order 写作 50 | `PLAN_POLICY = 500` | `dsh-system-prompt/src/index.ts:139` |
| "系统提示词是 system 字段"（常见直觉） | 实际是派生历史里的 `system/message` 表层节点 | `dsh-system-prompt/src/index.ts:46` |
| "waterfall 能改工具声明" | waterfall 只拿 `PromptPresentation`，工具归 provider | `dsh-system-prompt/src/index.ts:125-134` |
