# 兼容性

本插件只依赖 DeepSeek Harness 的公开服务与事件，不读内部状态、不写用户文件。

## 已验证

| dsh 版本 | 结果 | 验证方式 |
| --- | --- | --- |
| `0.2.2-rc.3`（Desktop） | 通过 | 真实会话：`/verify` 重新装配、`/diag` 过滤器计数、子智能体实测工具集 |
| `0.2.2-rc.2` | 未验证 | — |
| `0.2.1` / `0.2.0` | 未验证 | 旧版 `dsh-context-preflight` 曾在早期版本上运行，但注入过滤改用 `system-prompt/assemble` 后未复测 |

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
| `agent/created` 事件的 `source` | 区分新会话与恢复/压缩 | 只按 `startup` / `clear` 兜底 |

## 明确不可管（不是兼容性问题）

- 工作区规则（`AGENTS.md` / `CLAUDE.md`）：`dsh-agent-instructions` 在 `agent/pre-step` 直接注入 user 消息，0.2.2 没有公开抑制入口；本插件只读展示。
- 时间上下文、技能目录消息本身：同属 pre-step user 消息通道，只能通过逐条遮技能或关掉 `skill` 工具间接影响。
- 必填上下文（当前目录、子智能体身份）：即使策略要求也会保留。

## 升级排查顺序

1. `GET /plugins/<id>/ping` 是否 200（路由注册）。
2. `GET /plugins/<id>/diag` 的 `clientModule` 是否有值（客户端进了 boot 表）、`rewrite.count` 是否随新会话增长（过滤器被调用）。
3. `GET /plugins/<id>/verify?session=<id>` 对比 `sections` 数量与面板预期。
4. 仍不对时，先确认该版本是否仍导出上表中的方法（版本 release notes 与包内 README）。
