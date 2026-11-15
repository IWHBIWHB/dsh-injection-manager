# dsh-context-preflight

每个新的 DSH 会话开局就被预先塞进工具 schema、技能目录、系统提示词段落和工作区规则。
这个插件把这笔账显示出来，并让你决定"新会话默认带什么"。

在真实 profile 上实测：首条用户消息发出前，注入面已经占 **84,230 token**，
其中 76,202 来自单个 MCP 服务器的工具 schema。

## 它做什么

- **量出注入面**：四类分开统计——系统提示词段落、技能目录、工具 schema、工作区规则，
  并可下钻到最大的若干条。
- **定新会话默认**：选择哪些技能对模型可见、哪些工具不下发（支持**前缀**，一条就能
  摘掉整个 MCP 服务器）、可选运行时上下文是否注入。
- **显示省了多少**：改完立刻给出"新会话首轮 ≈ N k"，以及与当前设置的差额。

策略在会话创建时生效，**不会半路修改正在运行的会话**。

## 安装

```sh
dsh plugin add github:IWHBIWHB/dsh-context-preflight
```

或用发布的 tarball：

```sh
dsh plugin add https://github.com/IWHBIWHB/dsh-context-preflight/releases/latest/download/dsh-context-preflight.tgz
```

## 使用

- 侧边栏「注入」打开面板：总量、四类明细、最大的工具 schema、默认策略。
- 工具 `context_preflight` 返回同一份测量文本，不打开面板也能问模型当前注入构成。

## 默认策略

存放于 `~/.dsh/context-preflight/policy.json`：

```json
{
  "version": 1,
  "skills": { "mode": "all" },
  "tools": { "mode": "except", "names": ["mcp__rexx__"] },
  "runtimeContext": { "enabled": true }
}
```

`mode` 取 `all` / `only` / `except`；`tools.names` 支持精确名与前缀。删除该文件即恢复默认。

## 它不做什么

- **不做延迟加载**。DSH 支持按工具声明 `deferLoading`，但那由注册该工具的插件决定，
  本插件无法事后改写别人的工具。**摘掉工具 = 模型完全看不到它，能力会真的缺失。**
- 不修改技能文件、工作区规则或任何其他插件。
- 不修改已经发出去的请求。
- 不估算整段对话：报的是注入面，不含聊天历史。面板会把"本会话已占用"单独列一行并注明口径。

## 限制

- token 是估算公式 `ASCII / 4 + 非 ASCII / 1.6`，不是分词器结果；实测与厂商计数相差几个百分点。
- 工作区规则文件（`AGENTS.md` 等）只读展示：DSH 在会话启动时加载，无法按会话开关。
- 需要带客户端模块系统（`dsh.client`）的 DSH 版本。

## 许可

MIT
