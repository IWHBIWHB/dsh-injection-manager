# 注入前清单（dsh-context-preflight）

侧边栏里的「注入」入口，打开是一个 `main` 键控面板：发车前看清这一轮请求到底往模型里塞了什么、各占多少。也提供同名宿主工具 `context_preflight`，模型可以自己调。

**只读**：不改任何注入内容，没有设置页。

## 面板（`main` keyed slot，key = `context-preflight`）

标题栏 56px：「注入上下文」+ 右上角关闭按钮（只放能点的控件，不放占位）。

- **首卡 + KPI 四联卡**：第一张是 240px 宽的本轮注入卡（数字 34px，脚注「估算」），后面四张等宽分项卡：画像 / 技能 / 工具 / 提示词，各带大数字（30px、等宽、≥10k 转 k）与副标题（`1 文件` / `38 可见` / `280 个` / `25 段`）。四个分项之和与首卡不一致时，显示一条琥珀告警卡而不是硬凑。
- **构成占比（手写 SVG 环形图）**：`viewBox 0 0 120 120`、半径 48、线宽 14、段间 2px 间隙（`stroke-dasharray` 拼接，`stroke-linecap: butt`）；中心两行「大数字 + 估算」；右侧图例：8×8 色块 + 名称 + 百分比（右对齐等宽）。四色只用单色阶 `#18181b → #52525b → #a1a1aa → #e4e4e7`。
- **最大的 8 个工具 schema（横条）**：名称（最多 55%，省略号）+ 6px 圆角横条（最长条 100%，最短 2% 保底）+ 72px 右对齐数值；条底 `#f4f4f5`，填充 `#18181b`。纯 div，不用 canvas。
- **告警卡**：存在但不在加载路径上的画像文件，左侧 2px 琥珀竖线。
- **底注**：`本会话已占用 463.5k（含对话历史，与上方注入量不可直接比较）`——不与注入合计并排比较。
- **三态**：加载中是灰骨架块（不转圈）；就绪是上面那套；失败是一行「读取失败」+ 重试按钮。

视觉令牌：页底色 `#fafafa`、卡片 `#ffffff`、`1px solid #ececec`、圆角 12px、内边距 `18px 20px`、卡片间距 16px、页边距 24px、无阴影、零 emoji；小标题 `12px/500/#71717a`（字距 .02em），大数字 `30px/600/#18181b`（字距 -.02em），列表行 13px、行高 30px、分隔线 `#f4f4f5`；强调色只有 `#18181b` 与告警 `#b45309`。颜色全部走本面板自己的 CSS 变量，深色模式（`body[data-ds-dark-theme]`）换成等价中性灰，不硬编码白底。

响应式：容器查询，`≤1000px` 首卡跨整行、KPI 降两列、图表上下堆叠，`≤560px` KPI 降一列；长名称一律省略号，不产生横向滚动。

## 细条（次要入口）

输入框上方一条 12px 细条，收起只占一行，点开是紧凑列表。它注册在自己的 `try/catch` 里，坏了只写日志，不影响侧边栏面板。

## 默认策略（每个新会话生效）

策略文件：`~/.dsh/context-preflight/policy.json`（插件自己的数据目录，不碰工作区、不碰 `~/.agents/skills`）。目录不存在会创建；文件不存在按全开处理。

```json
{ "version": 1, "skills": { "mode": "all", "names": [] }, "tools": { "mode": "all", "names": [] },
  "runtimeContext": { "enabled": true }, "updatedAt": "…" }
```

`mode`：`all` / `only`（只留 `names`）/ `except`（排除 `names`）。`tools.names` 支持前缀写法 `mcp__rea__`、`前缀*`，技能名按精确匹配。写盘用「临时文件 + rename」原子替换。

生效点：`agent/created`（新会话建立、第一次注入之前），只在 `startup` / `clear` 来源上跑，`resume` / `compact` 不动——**已经在跑的会话不会被改**。三件事都注册在该 agent 自己的作用域里（`agent.ctx.inject(['tools','skills','systemPrompt'])` 拿到的带作用域子上下文）：

- 工具：`scoped.tools.restrict({ allow } | { deny })`，前缀先展开成本次真实存在的工具名（`restrict` 只接受已知全局名）。
- 技能：`scoped.skills.register()` 注册同名的 deny-shadow（`modelInvocable:false`），最近的作用域层覆盖全局层，于是这些技能从该会话的模型目录里消失。
- 运行时上下文：`scoped.systemPrompt.suppressRuntimeContext()`。

每次应用都会 `console.info('[context-preflight] policy applied', …)`；失败写 `console.error`，并把结果留在 `/policy` 的 `lastApplication` 与工具输出里（面板会显示「应用失败」「策略未保存：<原因>」）。插件卸载时按 agent 记录的 disposer 一并释放。

## 数据与文案

- 数据：`GET /plugins/dsh-context-preflight/summary[?session=<id>]`，面板与细条共用同一份 JSON，前端只排版不重算。
- 策略：`GET /plugins/dsh-context-preflight/policy`（含 `lastApplication`）、`POST /plugins/dsh-context-preflight/policy`（原子写入）。面板改任何一项都在本地即时重算「新会话首轮注入 ≈ N k」，写盘防抖 500ms。
- 文案：`locale/zh.json`、`locale/en.json` 的 `client` 段（45 条，zh/en 对齐），由 `GET /plugins/dsh-context-preflight/locale` 提供给浏览器，再注册进 Client locale 服务；拿不到时用内置兜底文案立即渲染。

## 路由

`webServer` 是 `inject` 的硬依赖，三条 exact 路由在插件的全局层注册：

- `GET /plugins/dsh-context-preflight/ping` — 最小探针；404 说明插件没跑到注册这一步。
- `GET /plugins/dsh-context-preflight/summary[?session=<id>]` — 面板数据。
- `GET /plugins/dsh-context-preflight/locale` — 浏览器文案字典。
- `GET|POST /plugins/dsh-context-preflight/policy` — 默认策略读写（含最近一次应用结果）。

## 客户端加载证据链

manifest 的 `dsh.client` 只有 `{ "platform": "web" }`。浏览器控制台按顺序看：

- `[context-preflight] client module loaded` — 模块被 loader 取到并执行；**没有这行**说明模块没加载（manifest / loader 层）。
- `[context-preflight] 客户端注册失败` / `react 依赖不可用` / `细条注册失败` — 模块跑了但注册失败，带原因。
- `[context-preflight] fetch 失败 <url> ...` — 路由不可达（面板/细条仍用兜底文案渲染）。

## 槽位

| 槽位 | 注册参数 |
| --- | --- |
| `main` | `{ name: 'main', key: 'context-preflight' }` + 面板组件 |
| `sidebar.panellist` | `{ name, id: 'context-preflight', order: 6, label: () => 注入 }` + 图标组件（20×20，`currentColor`） |
| `conversation.composer.dock` | `{ name, id: 'context-preflight', order: 6 }` + 细条组件（可选） |

## 限制

- 只读：不改注入内容、不裁剪、不压缩、不重排。
- 不轮询：挂载、会话切换、点「重试」时各取一次。
- 拿不到会话 id 时路由退回「最近活跃会话」，多会话并排时可能取错。
- 语言切换能否实时生效取决于 `ctx.locale` 是否暴露 `subscribe`：有就接上，没有要等下次数据刷新。

## 验证范围

- 已验证：`install_bundle` 返回 `application: applied`（v0.2.0）；四条路由在实例 37980 均 200；`context_preflight` 在 host/Tool/listTools 可见、真实调用成功、工具名集合与 listTools 一致（280 个，sha1 `f5c5340044ee`）；`/summary` 实测 `total 84,230`，四个分项之和与之相等；**默认策略三组都在真实新会话里测过**（见下表），面板预估与新会话工具输出**逐位一致（0% 偏差）**；客户端模块在 Node 侧按浏览器方式加载成功并渲染出含「默认策略」区的面板。

| 策略 | 新会话工具数 | 技能可见 | 新会话 `context_preflight` 首轮注入 | 宿主/面板预估 | 偏差 |
| --- | --- | --- | --- | --- | --- |
| 全开 | 280 | 38 | 84,230 token | 84,230 | 0% |
| 排除 `mcp__rea__` | 51 | 38 | 18,251 token | 18,251 | 0% |
| 仅 5 个技能 | 280 | 5 | 81,618 token | 81,618 | 0% |
- 未验证：**重启后**客户端模块是否真被加载、侧边栏入口是否出现（本会话 client inspect 桥不可用）；1280×800 与 900×700 的实际观感、深色模式。
