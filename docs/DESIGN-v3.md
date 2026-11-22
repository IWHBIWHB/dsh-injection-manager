# 上下文注入管理 v3 设计（3.0.0）

v2 的定位是「首轮注入的开关板」：从宿主的服务里读快照，按段落/上下文/技能/工具四个通道开关。
v3 把它扩成**一次请求级别的完整账本**：每个注入面都能看到、能追溯来源、能说清哪一部分不由插件控制。
设计依据是 [INJECTION-PANORAMA.md](INJECTION-PANORAMA.md) 的源码事实，不新造宿主能力。

## 1. 范围：六个注入面，一个都不能漏

| 面 | v2 状态 | v3 状态 |
| --- | --- | --- |
| S1 系统提示词段落 | 快照估算 + 可关 | **装配现场原文**（offered/admitted）+ 逐项归属 + 可关 |
| S2 运行时上下文 | 快照估算 + 可关 | 同上；标出 required（宿主会还原） |
| S3 工具 schema | 快照 + 可关 | 台账记录每次请求的实际 schema 集合（名称/描述/字符/估算 token） |
| S4 消息级注入（技能目录/AGENTS.md/时间/提醒/计划/目标/压缩摘要） | 基本看不见 | **逐类预览**（`agent/pre-step` 的 decision.messages），标注来源与改法；不谎称可关 |
| S5 插值变量 | 不可见 | 台账记录变量名与预览（不落盘） |
| S6 请求参数 | 面板显示档位 | 台账记录每次请求的 model/provider |

## 2. 台账（ledger）：数据从装配现场来

- 采集点 1：插件级 `system-prompt/assemble` waterfall。先注册、`await next()`，拿到
  `offered`（其它监听器之前）与 `admitted`（本插件策略过滤之后）的段落/上下文/变量；
  同一装配里用 `ctx.tools.schemas(agent)` 取本次工具集合。
- 采集点 2：插件级 `agent/pre-step` waterfall。`await next()` 后拿到本步 `turn/step` 与
  `decision.messages`（消息级注入的来源 kind、字符数、预览），把同一条记录补全。
- 过滤：没有 `agent` 字段的装配（面板自己的 `assemble({scope})` 快照、诊断）不记录。
- 存储：`$DSH_HOME/injection-manager/ledger.jsonl`（每条记录两行：装配时 + 补全时，加载时后写覆盖）
  + `ledger-text/<sha1>.txt`（段落/上下文的精确原文，内容寻址去重，512KB 上限）。
  **消息级内容与变量只留预览不落盘**。
- 只读接口：`GET /ledger`（列表/单条）、`GET /ledger-text?hash=`、`GET /ledger-catalog`；
  模型侧工具 `context_injection {ledger:true, entry?, limit?}`。
- 估算口径：`ASCII÷4 + 其他÷1.6`；provider usage 是另一个数，台账明确写"估算"。

## 3. 归属目录（catalog）：每一条都有出处

`lib/catalog.js` 是静态表：段落名/上下文名/工具名前缀/消息 kind → 注册包、类型、可控性
（`plugin` / `protected` / `preview` / `user`）、用户改法、源码证据（包:行号）。
目录里没有的来源一律 `preview`，不猜可关。

- 段落：`harness:identity`、`deployment:persona-*`、`plan:policy`、`team:policy`、`tool:*`、
  `mcp:<server>`、`mcp-resource-servers`、`harness:source`、`app:web-surface`、
  `context:file-reference`、`ui:deliverable-file-references`、`computer-use:*`、`tools:sdk` 等。
- 上下文：`working-directory:current`（required → protected）、`sandbox:policy`、
  `approval:policy`、`subagent:delegation`、`harness:source`、`app:web-surface`。
- 消息：`runtime-context`、`agent-instructions`、`skill-catalog`、`time-context`、`tmux-context`、
  `repeat-tool-reminder`、`plan-mode`、`goal`、压缩摘要、用户内容。

## 4. 预览与清晰度

- 台账列表 → 单条明细 → 条目原文（内容寻址，面板按需取，不整包进请求）。
- 与上一次请求的差异：新增/消失条目名；被策略拦下的项单列（offered − admitted）。
- `unchanged / changed` 不额外推断：只报事实（本次记录里有什么、上次记录里有什么）。
- 不可控项在台账页底部常驻一张参考表：来源、可控性、用户改法（文件路径 / 宿主 UI / 预设）。

## 5. 不做什么（边界）

- 不写工作区文件、不改 AGENTS.md / SKILL.md / 项目配置。
- 不拦截用户消息、附件、工具结果（S4 用户内容）；消息级宿主注入只预览，不默认过滤。
- 不把估算当计费；不承诺"完整覆盖"——目录里没有的来源会标 unknown。
- 不改宿主代码；全部通过公开扩展点（waterfall、tools.restrict、skills.register、webServer、slots）。

## 6. 验证

- 单测：`test/ledger.test.mjs`（归属分类 + offered/admitted/blocked + 原文回读 + 只存预览）。
- 真机：0.2.2-rc.5 隔离实例，一次真实请求后 `/ledger` 返回记录（段落 24 / 工具 11 / 上下文 7），
  原文按 hash 精确回读，面板「台账」页渲染并通过探针。
- 自审：`node scripts/self-audit.mjs`（路由/文档/契约对账，含新增 3 条路由与 apiVersion 3）。

## 7. 未解与下一步

- 消息级注入的**可控化**（实验性 `agent/pre-step` 过滤）需要逐类评估是否会被宿主下一步重发，
  默认不做。
- 历史轮次的精确还原：台账从插件启动后开始记录；启动前的请求只能看会话投影的估算。
- 跨会话汇总（哪类注入最贵、变化最大的来源）留给下一版。
