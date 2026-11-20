# 兼容性

本插件只依赖 DeepSeek Harness 的公开服务与事件，不读内部状态、不写用户文件。

## 已验证

| dsh 版本 | 环境 | 结果 | 验证方式 |
| --- | --- | --- | --- |
| `0.2.2-rc.5` | **Desktop**：独立 QA 实例（profile `v2qa`，49811；直接以 Desktop 自带 CLI 启动，不碰用户 GUI） | 通过 | 2.3.0 五入口探针 **16/16**：面板页、会话标签页、右侧栏面板、设置→通用设置偏好行、配置写入回读；0 console error |
| `0.2.2-rc.1` | **CLI**：临时 profile `v2qa` 起的独立 `dsh web` 实例（49801），不碰 Desktop 实例 | 通过 | 2.3.0 五入口探针 **15/15**（该宿主无 tokenMeter，窗口占用显示「窗口未知」）；Playwright 全流程 + 四条 v2 路由探针 |
| `0.2.2-rc.3` | **Desktop**：用户真实 profile（49711） | 通过 | 真实会话：`/verify` 重新装配、`/diag` 过滤器计数、子智能体实测工具集（2.2.0 轮） |
| `0.2.2-rc.2` | — | 未验证 | — |
| `0.2.1` / `0.2.0` | — | 未验证 | 旧版 `dsh-context-preflight` 曾在早期版本上运行，但注入过滤改用 `system-prompt/assemble` 后未复测；右侧栏入口在这类宿主上走 `sidebar.panel` 兜底，未真机确认 |

运行时自检：插件会读宿主版本（`DSH_INSTALL_DIR` 的 `package.json`，或 profile 里的 `@deepseek-ai/dsh`），低于 `0.2.2` 时面板顶部提示「部分开关可能不生效」；版本读不到时按未知处理，不猜。版本读取在桌面 rc.3/rc.5 与 CLI rc.1 两个真实宿主里都验证过（`hostinfo`），`/diag` 的 `host` 字段给出实际读到的版本与来源。

## 五个入口的宿主依赖（2.3.0）

| 入口 | 依赖 | 缺失时 |
| --- | --- | --- |
| 面板页 | `sidebar.panellist` + `main` 槽、`webServer` | 插件不激活（web 组合必需） |
| 会话标签页 | `conversation.view` 槽（0.2.2 全系） | 该入口不注册，其余四个照常 |
| 右侧边栏面板 | `ctx.get('sidebarRightTabs')` + `sidebar.right.pane.tab`（.title） | 退到旧 `sidebar.panel` 槽（仅当宿主声明了它）；两者都没有时无侧栏入口 |
| 斜杠命令 | 宿主 `commands` | 插件不激活 |
| 偏好行 | `settings.general.item` 槽 + `configForms`（entry id `injection-manager`） | 槽缺失则该行不出现；`configForms` 缺失则该行只读显示生效值 |


## 依赖的接口（缺一个会降级或失效）

| 接口 | 用途 | 缺失时 |
| --- | --- | --- |
| `ctx.systemPrompt.assemble({ scope })` | 取本轮实际装配的段落与上下文并计数 | 清单为空，面板显示错误 |
| `system-prompt/assemble`（scoped waterfall） | 按策略移除段落 / 替换 persona 前缀后记 | 开关无法生效，仅剩展示 |
| `ctx.skills.snapshot({ cwd, scope })` | 技能目录清单与体积 | 技能通道标为读取失败 |
| `ctx.skills.register({ invocation })` | 用同名不可调用技能遮住目录条目 | 技能无法逐个关闭 |
| `ctx.tools.schemas(agent)` / `restrict({ deny })` | 工具 schema 清单与裁剪 | 工具无法关闭 |
| `ctx.agents.get(id)` / `currentInitiator()` | 面板对会话取数 | 退回到最近活跃会话 |
| `ctx.webServer.register({ kind: 'exact' })` | 面板路由 | 面板无数据（工具与命令仍可用） |
| `ctx.connection.requestRejection(req)` | 15 条路由入口的 Host/Origin 准入栅栏（2.0.1 起） | 跳过栅栏，路由保持 2.0.0 的旧行为（可降级，不是硬依赖） |
| `agent/created` 事件的 `source` | 区分新会话与恢复/压缩 | 只按 `startup` / `clear` 兜底 |
| `ctx.get('tokenMeter').contextPressure(session)` | 窗口占用：分子（provider 报的 prompt）与分母（`contextWindow`） | 窗口卡片显示「窗口未知」，其余功能不受影响 |
| `ctx.get('sessionProjections').snapshot(session)` 的 `contextBreakdown` | 系统 / 工具 / 消息构成 | 只显示占用条，不显示构成 |
| `ctx.llm.resolveModelInfo(provider, model)` | 首次请求前拿窗口容量（按路由缓存） | 首个请求之后才有分母 |
| `session/event` 上的 `compaction/summary` / `compaction/prune` / `compaction/end` | 压缩回执与释放的 token | 不显示压缩行；数值来自宿主 `shadowedTokenCount`，缺失时不猜 |

## v2 HTTP 契约（2.0.0 起）

面板与宿主之间多了一层版本协商：`GET /summary` 返回 `apiVersion: 2`。新版面板读到 v1 时显示可关掉的 gate 卡（新版洞察/内容透视/健康检查需要 v2 宿主），管理、设置与开关不受影响；v1 面板连 v2 宿主则照常工作（新增字段都是追加的）。

v2 新增的四条只读路由与它们的宿主侧依赖：

| 路由 | 依赖 | 缺失时 |
| --- | --- | --- |
| `/content?channel=&id=[&session=]` | 快照登记的技能路径、规则文件路径；`node:fs` 读取 | 抽屉显示读取失败，列表与开关不受影响 |
| `/trend?range=&limit=` | `stats.json` + `sessionQuery.listSessions()`（可选） | 无 `sessionQuery` 时只读历史文件，覆盖率 `known: null` |
| `/events?session=&limit=` | `$DSH_HOME/injection-manager/events.json` | 文件不存在时返回空窗口，不报错 |
| `/health?session=` | 与面板同一份 `buildSnapshot()` | 快照失败时返回错误，面板显示「健康检查读取失败」 |

宿主版本无关：这些路由全部由插件自己实现，只用到 `0.2.2` 已有的公开服务（`agents`、`webServer`、`sessionQuery`）。

**准入栅栏（2.0.1 起）**：15 条路由的每个入口先过 `ctx.connection.requestRejection(req)`——DSH 自己的 Host/Origin 准入与浏览器/API 凭据校验，不符直接 401/403 且不执行路由逻辑。`connection` 不是硬依赖：服务缺失（旧宿主/启动早期）、方法缺失或调用抛错时跳过栅栏，路由保持 2.0.0 的行为。

## 明确不可管（不是兼容性问题）

- 工作区规则（`AGENTS.md` / `CLAUDE.md`）：`dsh-agent-instructions` 在 `agent/pre-step` 直接注入 user 消息，0.2.2 没有公开抑制入口；本插件只读展示。
- 时间上下文、技能目录消息本身：同属 pre-step user 消息通道，只能通过逐条遮技能或关掉 `skill` 工具间接影响。
- 必填上下文（当前目录、子智能体身份）：即使策略要求也会保留。

## 升级排查顺序

1. `GET /plugins/<id>/ping` 是否 200（路由注册）。
2. `GET /plugins/<id>/diag` 的 `clientModule` 是否有值（客户端进了 boot 表）、`rewrite.count` 是否随新会话增长（过滤器被调用）。
3. `GET /plugins/<id>/verify?session=<id>` 对比 `sections` 数量与面板预期。
4. 新版表面单独排查：`/health` 是否 200（健康条）、`/trend` 是否返回点（洞察）、`/content?channel=tools&id=tool:<name>` 是否 200（抽屉）；`/summary` 的 `apiVersion` 不是 2 时面板会显示 gate 卡，说明宿主加载的是旧版服务端半包。
5. 仍不对时，先确认该版本是否仍导出上表中的方法（版本 release notes 与包内 README）。
