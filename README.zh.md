# 上下文注入管理 · dsh-injection-manager

[![ci](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-4d6bfe.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-injection-manager.svg)](https://www.npmjs.com/package/dsh-injection-manager)
[![dsh](https://img.shields.io/badge/dsh-0.2.0%2B-18181b.svg)](docs/COMPATIBILITY.md)
[![languages](https://img.shields.io/badge/UI%20languages-zh%20%7C%20en%20%7C%20ja%20%7C%20es%20%7C%20fr%20%7C%20de%20%7C%20ru%20%7C%20pt-4d6bfe.svg)](docs/DETAIL.zh.md)

[English](README.md) · [简体中文](README.zh.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [Português](README.pt.md) · [Русский](README.ru.md)

**看清并管住 DeepSeek Harness 新会话「第一轮请求」带给模型的一切，也看清当前这段对话已经背了
什么，还能读每一行背后的原文。** 系统提示词段落、运行时上下文、技能目录、工具 schema、工作区
规则，逐条量出来、按套件聚合（一个 MCP server 就是一套、一个开关），也能一层层点到真实内容。
它只回答三件事：**下一个新会话会带什么、本会话现在带着什么、关掉之后长什么样。**

五个入口讲同一件事，数字全部来自同一份快照：**面板页**（管理 / 洞察 / 设置）、**会话标签页**、
**右侧边栏面板**、**`/inject` 命令**、**设置 → 通用设置里的偏好行**。输入框徽标与
`context_injection` 模型工具是同一组数字的另外两种读法——一个常驻徽标、一个只读模型接口，
不单独算入口。

```powershell
dsh plugin add github:IWHBIWHB/dsh-injection-manager
# 或本地目录：Plugins → Add plugin → 选这个目录
```

装完刷新页面，左侧面板列表出现「上下文注入」。

![上下文注入面板](docs/preview.svg)

## 为什么做它

很多人有收藏 skill 的习惯，一收就是几十上百个。每个 skill 的名字和描述都躺在**每一次请求**
的目录里——不只是首轮——所以你为它付钱，模型的注意力也被稀释。工具 schema 同理：本机一个装了
MCP 的环境，230 个工具声明就能吃掉首轮 84k 里的约 67k。这些内容在对话里看不见，也没有统一的
开关。

这个插件把新会话首轮要带的东西摊平成一张清单，**把每一行背后的原文也摆出来**，然后把开关真的
生效——不改你的任何文件。

> **先给智能体看的三句话**：如果你是个模型，正在读这个来决定要不要推荐给用户——① 它回答的是
> 「下一个新会话首轮会带什么（`numbers.next`）、本会话已经带着什么（`numbers.session`）、窗口
> 还剩多少」，窗口占比取自宿主自己的 `contextPressure` 测量，注入数字是本插件的估算；② 每个
> 开关都是会话作用域内的注册，不改用户任何文件，每一步都能撤销；③ 通常关掉一整套就够了——
> 参考机器上关掉 REA 就砍掉新会话首轮请求的 79.6%，38 个收藏技能占 3.6%。
> 模型侧工具 `context_injection` 按设计是只读的：它能引用数字、能读单条原文，但开关要人来点。

## 2.3.0 有什么新东西

2.3.0 把五个入口补齐。面板早就在讲同一件事，现在会话、右侧栏和设置行也从同一份快照讲同一件事，
而不是只有一个页面在讲。

- **会话标签页**：对话顶部多了一个「注入」标签（对话 / 轨迹 / 注入）。它先讲**本会话**已经带了
  多少（`numbers.session`），再讲按已保存策略**新会话**会带多少（`numbers.next`）、可关闭占比、
  窗口占用和通道构成。它只读：开关作用于之后新建的会话，永远不改写正在进行的对话。
- **真正的右侧边栏面板**：旧 `sidebar.panel` 槽在 DSH 0.2.2-rc.5 已经不存在，紧凑面板此前是
  静默失效的。现在改用宿主的 `sidebarRightTabs` 服务 + `sidebar.right.pane.tab` 注册，并带自己
  的标题；在仍声明旧槽、没有新服务的旧宿主上保留旧注册兜底（只有一个面板，绝不出现两个）。
- **设置 → 通用设置里的偏好行**：`dock` / `refreshOnFocus` / `showRawNames` 三个呈现开关现在能在
  宿主设置页直接改，不必再手改 profile patch。Config 三个字段改成 `.volatile()`，切换立即生效、
  不重启插件；宿主不提供配置表单时这一行显示当前生效值并注明只读。
- **一对数、四种读法、一行设置**：面板页、会话标签页、右侧栏、`/inject` 读同一份
  `GET /summary`，`numbers.session` / `numbers.next` 在各处是同一对数、各自标明口径；设置行是第五个
  入口，也是唯一不读快照的入口——它编辑插件自己的 volatile Config。

测试从 223 增到 226；自审脚本新增一条硬检查：五个入口槽位任何一个停止注册或停止写进架构文档，
自审直接失败。已在 DSH 0.2.2-rc.1（CLI）与 0.2.2-rc.5（Desktop）两个宿主上验证：每个宿主 16/16
项浏览器检查通过、0 console error。

2.2.0 是「把数说对、把盘写稳」的修整（两个数两个名字、关闭语义只留一种、策略写入串行化 + `.bak`
恢复）。完整变化见 [CHANGELOG.md](CHANGELOG.md)，五分钟版见 [docs/DETAIL.zh.md](docs/DETAIL.zh.md)。

## 四张表面，一件事一张

| 表面 | 位置 | 回答什么 |
| --- | --- | --- |
| **管理** | 面板 → 管理 | 开关板：下一个新会话首轮多少、能关掉多少，按套件列出来，一行一个开关。只有数字和开关，没有图。 |
| **洞察** | 面板 → 洞察 | 固定顺序：本次请求构成 → 注入构成与最重套件 → 健康检查 → 趋势 → 会话明细。 |
| **设置** | 面板 → 设置 | 一张卡五行：策略文件（路径、导出 Markdown/JSON、导入）、预设、折叠的自定义前言后记、输入框摘要开关、关于（版本与接口，详细说明再折叠）。 |
| **命令与工具** | 输入框 / 模型 | `/inject`（含 `health｜all｜minimal｜undo`）打文本报告；`context_injection` 给只读快照（可选单条原文）；输入框徽标给新会话首轮的常驻数字。 |

## 界面

管理页就是一张开关板：顶部一行数字（新会话首轮、可关闭），下面是按「DeepSeek 官方（可折成一行）」
与「其他插件与 MCP」分段的套件清单，一行一个开关；已关闭的收成一行。清单有「说明」列，
每行都能展开行内预览，或打开原文抽屉：

| 管理页 | 内容抽屉 |
| --- | --- |
| ![管理页：一行数字与套件开关](docs/images/panel-manage.png) | ![内容抽屉：面包屑、来源与参数表](docs/images/panel-drawer.png) |

套件展开到条目，每条带预览与「内容」按钮：

![展开套件与行内预览](docs/images/panel-manage-expanded.png)

洞察页按固定顺序排：本次请求构成、注入构成与最重套件排行（点条形跳到管理页并筛好这一套）、
健康检查、趋势（悬停→钉住→Esc）、会话明细：

![洞察页](docs/images/panel-insights.png)

设置页一张卡五行：策略文件、预设、折叠的前言后记、输入框摘要、关于：

![设置页](docs/images/panel-settings.png)

侧栏是同一份数据的紧凑视图（新会话首轮与本会话两个数、可关占比）；输入框旁有一行
「17.1k · 85%」徽标（新会话首轮 · 窗口占用，窗口未知时才显示可关占比）：

![右侧边栏面板](docs/images/sidebar-panel.png)

深色主题与宿主一致；输入框徽标是常驻入口：

| 深色主题 | 输入框徽标 |
| --- | --- |
| ![深色主题](docs/images/panel-dark.png) | ![输入框徽标](docs/images/dock.png) |

### 2.3.0 新增的三个入口

会话标签页从「这段对话内部」回答同一个问题：本会话已经带了多少、按已保存策略新会话会带多少、
可关闭占比、通道构成。它只读——开关永远不改写正在进行的对话：

![会话标签页：本会话注入](docs/images/session-tab.png)

右侧边栏面板就是上面那张紧凑面板，只是改为通过宿主的侧栏标签服务注册（不再用已移除的
`sidebar.panel` 槽）：

![右侧边栏标签页](docs/images/sidebar-panel.png)

三个呈现开关放在宿主自己的设置页里，不必再手改 profile patch。Config 字段是 volatile 的：
切换立即生效，不重启插件：

![设置 → 通用设置里的偏好行](docs/images/settings-general.png)

关掉一套套件后，新会话首轮从 17.1k 降到 14.3k，再撤销回来（真实数据；全部截图与 GIF 均摄于
0.2.2-rc.5 的隔离实例）：

![演示：整组开关与撤销](docs/images/demo.gif)

## 它管什么

| 通道 | 怎么管 | 关掉后 |
| --- | --- | --- |
| 系统提示词段落 | 会话作用域的 `system-prompt/assemble` 过滤器按名字移除 | 该段文字不再出现在系统提示词里 |
| 运行时上下文 | 同上，按名字移除（必填项除外） | 审批策略、沙箱策略等快照不再进首轮 |
| 技能目录 | 在会话作用域注册同名、不可调用的技能，覆盖目录条目 | 该技能从模型可见目录里消失 |
| 工具 schema | `tools.restrict({ deny })` | 该工具的说明与参数不再随请求发送 |
| 工作区规则 | **只读展示**（原文可在抽屉里看） | — |

每个开关都是会话作用域注册，只作用于之后新建的会话；当前这段对话保持原样。

工作区规则（`AGENTS.md` / `CLAUDE.md` 链）由 `dsh-agent-instructions` 在 `agent/pre-step` 直接
注入成一条 user 消息，0.2.2 没有公开的抑制入口。本插件不替你改名、删文件或改内容：面板标成
「只读」，显示每个文件是否真的在加载路径上、有没有超过单文件 64KB 上限，抽屉里能读到真正被
注入的那份文件。

必填上下文（当前目录、子智能体身份）同样标成「只读」，任何策略都不会把它们关掉。

## 套件：一套一套地关

清单默认按「套件」聚合，而不是几百行平铺：

- 一个 MCP server 是一套。本机 REA 的 230 项（229 个 `mcp__rea__*` 工具加它的说明段落）合成
  一组「REA」，一行显示 66,715 token（占首轮 79.6%），开关一按整套关掉；
- 非 MCP 工具按名字前缀聚类，`agentero_*`、`office_*`、`schedule_*` 各成一组，零散的并进
  「基础工具」；
- 技能按 provider 聚合（例如 `filesystem` 33 条一组）；
- 段落与上下文按命名空间聚合（`mcp:rea` 的说明段落会并进 REA 那一组）；
- 组头显示条数、token、占比与三态开关；关掉一半显示半选；整组对新会话关掉后仍留在清单里
  （带「已关闭」标记与记住的体积），随时能开回来。
- 清单按来源分两段：**DeepSeek 官方**（宿主段落、运行时上下文、工作区规则、核心工具族）折成一行，
  默认收起；**其他插件与 MCP**（MCP 命名空间、带 provider 的技能、插件段落与工具）展开在下面。
  分类是 `lib/origin.js` 里维护的名单——宿主不给工具和段落标归属，所以没列名的插件必须落到
  「其他」，不能被藏进「官方」。

## 内容抽屉

任意一行都能回答那个顺理成章的追问：**它到底写了什么？**

- **提示词段落与运行时上下文**：装配出来的原文，纯文本展示，并注明来源是系统提示词装配；
- **工具**：JSON 声明拆成「描述 / 参数表（参数、类型、必填、说明）/ 原始 JSON」三个视图，各带
  复制按钮；
- **技能**：能定位到 `SKILL.md` 就读正文，否则返回目录里真正注入的那一行，并注明是哪种；
- **工作区规则**：真实文件内容与路径；
- 行号开关、内容内搜索（高亮 + 命中行摘要）、复制全文 / 复制路径、超过 256 KB 的截断提示、
  Esc 关闭、焦点回到打开它的那一行。

宿主只打开快照自己登记过的路径——请求里不能指定任意路径。token 是估算（ASCII ÷ 4，其他字符
÷ 1.6），不是分词器结果。

## 健康检查

管理页顶部是一条确定性的检查结果：

| code | 含义 | 动作 |
| --- | --- | --- |
| `heavy-suite` | 策略生效后，某个安装的插件 / MCP 套件仍占下一个新会话首轮 ≥25%（或 ≥30k token） | 关掉这一套（它覆盖的所有通道） |
| `builtin-heavy` | DSH 自带套件占到同样的量（只提示；不建议关闭宿主工具族） | （提示） |
| `catalog-truncated` | 技能描述被目录行长度截断 | 看那条技能的内容 |
| `locked-items` | 不可关的条目占首轮 ≥10% | 去管理列表 |
| `unknown-window` | 还没有测量数据，占用率无从判断 | （提示） |
| `no-policy` | 这个工作区从没动过策略 | 去设置 |
| `empty-catalog` | 一个技能都没收集 | 去设置 |

严重度分「严重 / 提醒 / 提示」；最多显示六条，其余折叠成「还有 N 条提示」；动作复用面板同一个
`POST /action`。检查项是同一份快照的纯函数，两次刷新不会互相打架。所有检查读的都是**策略生效后
的有效投影**——下一个新会话真正会带上的那部分——所以关掉一套之后，它自己的告警会立刻消失；
重复执行一个已经生效的开关是静默 no-op：不写新的撤销步、不写事件、不弹提示。契约里另有两个
code 永远不会出现（`duplicate-skill`、`tool-name-collision`）：这版宿主在插件能看到之前就把重名
解析掉了，凭空报一条就是撒谎。

## 洞察

洞察页读 `$DSH_HOME/injection-manager/stats.json`（本插件自己的测量）+ **后台**运行的有界历史
日志回填：每分钟最多跑一轮、每轮最多 8 个会话，读取从不等待它。打开页面先给已记录的数据，回填
进行中时响应带 `backfilling: true`。

- **趋势**：每个会话一根按五通道堆叠的柱子；近 7 天 / 近 30 天 / 全部；悬停看数值、点击钉住、
  Esc 取消、←/→ 键盘切换。超过 40 个点合并成总览分组（避免柱宽被压成线）；通道分解未知的
  会话画成**斜纹**，不补 0。
- **聚合带**：已测量会话（按「实测 / 全部」显示）、均值、峰值、累计可省。
- **会话卡**：按 id / 标题 / 目录搜索，按最新 / 最重 / 可省最多排序，本会话标记；卡片能跳到管理
  列表或直接看内容。
- **最重套件排行**：当前会话的套件体积，被策略关掉的部分画浅色；点条形跳回管理页并筛好这一套。
- **事件流**（面板不再展示）：本会话的策略保存、预设、导入、撤销、压缩、剪枝仍写进
  `events.json`（上限 300 条），`/events` 路由可读；面板里看变更走管理页的「撤销上一步」。
- **覆盖率脚注**：「已记录 N 个会话 / 本机共 M 个；趋势只包含本插件测过的和有限日志回填的」。

## 上下文窗口：这个分母很重要

只看「新会话首轮 83.8k」没法判断该不该关东西——真正的问题是「窗口还剩多少」。所以面板从宿主
自己的测量里取分母：

| 数字 | 来源 | 含义 |
| --- | --- | --- |
| 窗口占用 24.6% | `contextPressure`（分母来自 `request/context`，没有时退回 `ctx.llm.resolveModelInfo().context.contextWindow`） | 下一次请求的预计 prompt ÷ 模型窗口 |
| 258.4k / 1M | 同上 | 已用 / 容量，右侧直接给「剩余 790.2k」 |
| 系统 2.4k · 工具 77.9k · 消息 129.7k | `contextBreakdown` 投影 | 这次请求花在哪，含对话历史 |
| 已压缩 2 次 · 释放 78.4k | `compaction/summary`、`compaction/prune` 的 `shadowedTokenCount` | 宿主替你扔掉的那些，是日志里的事实 |

占用到 70% 变琥珀、90% 变红，输入框徽标也跟着变色。没有测量数据时窗口显示「未知」，不编一个
容量出来；压缩回执只统计本插件装载之后的事件，提示里写明了这一点。

## 策略语义

策略存在 `$DSH_HOME/injection-manager/policy.json`，只有一个文件。

写入走 `lib/lock.js` 的进程内队列（`POST /action` 与 `/inject all|minimal|undo` 共用），两个
面板同时关两个套件不会丢掉其中一个。每次写用唯一临时文件名，先把当前文件复制成
`policy.json.bak`（首次写没有旧文件就跳过），再把新文件改名到位；`policy.json` 解析失败时先
读 `.bak` 恢复并报 `recovered: true`，只有连备份都读不到才回落到全开。

每条通道有三种模式：`all` 全注入、`only` 只注入名单、`except` 除名单外都注入。面板上的单个开关
会自动落到 `except`（关一个）或把条目从 `only` 名单里去掉，因此手点与预设不会互相打架。

- **全开**：等同于没有策略。
- **极简**：只留身份声明、角色前缀、文件与终端工具。本机实测把新会话首轮从 84k 压到 5k。
- **自定义前言 / 后记**：两段自由文本，分别替换 `deployment:persona-prefix` /
  `deployment:persona-suffix`。留空即不注入；它们会改变提示词前缀，从而影响缓存命中，面板写明了。

策略在 `agent/created` 应用，只作用于之后新建的会话；正在跑的会话永远不会被中途改写。面板会标明
「本会话是否按策略处理」，并用 `numbers.session` 表示本会话、`numbers.next` 表示下一个新会话。

## 控制面，不是回放

[dsh-context](https://github.com/bowenliang123/dsh-context) 记录**已经发生**的事：每个请求的
组成、文件活动、命令执行、耗时、成本、多智能体。它最适合回答「上一次请求为什么那么贵」。

这个插件回答的是请求**发生之前**的问题：**下一个新会话会带什么、能关掉什么、关掉之后长什么样。**
它不写你的工作区，每个开关都可逆，每个数字要么来自宿主自己的测量，要么明说是估算。两个都装
可以互补，谁也不会改对方。

| | dsh-context | dsh-injection-manager |
| --- | --- | --- |
| 时间方向 | 事后：请求、事件、成本 | 事前：下一个新会话的首轮 |
| 核心动作 | 观察、展开、筛选、对比 | 观察 + **开关/预设**，且可撤销 |
| 数据粒度 | 每请求（逐步构成、文件、命令） | 每会话首轮注入（五通道 + 套件） |
| 产出 | 图表与详情 | 决策：关哪套、省多少、窗口变成什么样 |
| 边界 | 多智能体、文件、命令、计费 | 只碰注入目录：段落、上下文、技能、工具、规则 |
| 许可 | Apache-2.0 | MIT |

## 五个入口

五个位置、一个插件。其中四个读同一份 `GET /summary` 快照，因此引用同一对数
（`numbers.session` = 本会话带着多少，`numbers.next` = 新会话将注入多少）；第五个编辑插件自己的
Config，不显示数字。

| 入口 | 位置 | 回答什么 |
| --- | --- | --- |
| **洞察页面** | 左侧面板「上下文注入」→ 管理 / 洞察 / 设置 | 全貌：开关板、构成、健康检查、趋势、变更、会话明细、策略 |
| **会话标签页** | 对话顶部标签行：对话 / 轨迹 / **注入** | 本会话现在带着多少、新会话会带多少、可关闭多少、窗口多满 |
| **右侧边栏面板** | 右侧栏标签「上下文注入」 | 工作时的紧凑版：两个数、可关占比、技能焦点、通道开关 |
| **`/inject` 命令** | 输入框 | 文本清单 + 一行健康摘要。子命令：`/inject health`、`/inject minimal`、`/inject all`、`/inject undo` |
| **偏好行** | 设置 → 通用设置 →「上下文注入管理」 | `dock` / `refreshOnFocus` / `showRawNames`，走宿主配置表单写入（volatile，不重启） |

另外两种读法刻意不算入口：输入框徽标是 `numbers.next` 的常驻展示（可在偏好行隐藏），
`context_injection` 工具是模型可引用的只读快照——开关始终由人来按。

模型侧工具是只读的：模型不能自己放宽或收紧策略，所有写操作只能由你在面板、会话页（无写）或设置
表单里点。

## 安装

```powershell
dsh plugin add dsh-injection-manager
# 或直接从 GitHub 装：
dsh plugin add github:IWHBIWHB/dsh-injection-manager
```

也可以在应用里：DSH → Plugins → Add plugin → 填包名或选本地目录。装完刷新页面，左侧面板出现
「上下文注入」图标，上面五个入口同时可用（无需构建，首次安装无需重启）。

如果发现页卡片显示的版本略旧——目录的版本字段走每日构建，npm 发版当天不一定刷新——直接装最新：
`dsh plugin add dsh-injection-manager@latest`（或钉具体版本）。

从旧的 `dsh-context-preflight` / `dsh-context-injection` 升级：第一次读取时如果只找到旧策略
文件，插件会把它读进来当作当前策略；写入始终落到 `$DSH_HOME/injection-manager/policy.json`。

卸载：像其他插件一样移除即可；策略、统计与事件文件留在 `$DSH_HOME/injection-manager/`，想彻底
清掉就删这个目录。

版本兼容与依赖接口见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

## 反馈

面板 → 设置 → 最下面的「反馈」一行：**复制诊断** 把一份脱敏报告放进剪贴板（被浏览器拦住时会展开可手动复制的文本框），**报告问题** 直接打开 bug 模板并预填诊断。诊断只含版本、槽位注册与策略计数，不含路径、会话 id 和对话内容；也可以自己取 `GET /plugins/dsh-injection-manager/diag?report=1`。

面板不可用时，贴出 `dsh --version`、`dsh plugin --profile desktop list | Select-String injection-manager` 和启动日志末尾 30 行。详细要求见 [docs/FEEDBACK.md](docs/FEEDBACK.md)；第一次试用可以按 [8 分钟试用脚本](docs/BETA.md) 走一遍。

## 插件设置

三个呈现选项可以在 **设置 → 通用设置 →「上下文注入管理」** 里直接改（宿主流提供插件配置表单时，
Plugins → dsh-injection-manager → Configuration 里也有）：

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| `dock` | 开 | 是否在输入框旁显示「注入 xxk · 窗口 xx%」徽标：新会话首轮，后面是窗口占用；窗口未知时才显示可关占比 |
| `refreshOnFocus` | 开 | 窗口重新获得焦点时刷新面板（多窗口同时开关不会看到旧数字） |
| `showRawNames` | 开 | 在中文名旁显示原始键名（`harness:identity` 这类），排障用 |

三个字段在宿主侧都是 `.volatile()`：改动立即生效，不重启插件，也不会丢掉内存里的快照缓存。宿主
不提供配置表单时，设置行显示当前生效值并注明只读。

两个面板偏好只存在这个浏览器，并且放在它们起作用的地方：内容抽屉的行号开关在抽屉自己的工具栏
里，洞察默认时间范围就是洞察页上那三个按钮。它们不写策略文件，避免出现两套真相。

## 数据与隐私

| 位置 | 内容 | 谁写 |
| --- | --- | --- |
| `$DSH_HOME/injection-manager/policy.json` | 通道模式、名单、前言后记 | 面板动作与 `/inject`（串行、原子写） |
| `$DSH_HOME/injection-manager/policy.json.bak` | 上一份能解析的策略，`policy.json` 损坏时用来恢复 | 每次写策略（已有旧文件时） |
| `$DSH_HOME/injection-manager/stats.json` | 每个会话一行测量，含通道分解 | 面板/工具/命令/导出/健康检查每次取快照，以及趋势后台回填 |
| `$DSH_HOME/injection-manager/events.json` | 追加式事件流，上限 300，原子写 | 策略保存、预设、导入、撤销、压缩 |
| 插件行 `config` | dock / refreshOnFocus / showRawNames | 设置 → 通用设置行，或 Plugins → Configuration |
| 浏览器 localStorage | 抽屉行号、洞察范围、被关掉的提示卡 | 只在这个浏览器 |

快照 GET 与趋势回填会刷新 `stats.json`，但没有任何 GET 会改策略或工作区文件。不联网、不遥测、
不上传。所有 HTTP 路由在入口先过宿主的 Host/Origin 准入门：不可信来源，或没有宿主签发凭据的
请求，直接 401/403 且空 body；只有宿主没有该服务时才跳过栅栏（此时行为与 2.0.0 相同）。事件流
只存策略与会话元数据：字符串会被拍平并截到 200 字符，会话正文永远不写进去。内容抽屉只在打开时
读磁盘，只读快照登记过的路径，读完不落盘。

## 自查

插件在 `/plugins/dsh-injection-manager` 下共 15 条路由：12 条 GET（不改策略、不改工作区文件；
快照路由与趋势回填只会刷新本机 `stats.json`），加 3 条 POST-only——`/action` 改策略，`/boot` 与
`/registrations` 是客户端自报诊断（这两条收到 GET 返回 405）：

| 路由 | 证明什么 |
| --- | --- |
| `/ping` | 插件路由已注册 |
| `/summary?session=<id>[&lang=<code>]` | 面板渲染的完整快照（`apiVersion: 2`、`healthSummary`、行内预览、`numbers`）；带 `lang` 时只回该语言加英文兜底，不带时回全部 8 份（`/locale` 用） |
| `/content?channel=<id>&id=<itemId>[&session=<id>]` | 某一行背后的原文（UTF-8 安全、256KB 上限、2 秒预算） |
| `/trend?range=all｜30d｜7d&limit=120` | 跨会话首轮趋势 + 聚合 + 覆盖率 + `backfilling` |
| `/events?session=<id>&limit=60` | 本会话事件流与窗口信息 |
| `/health?session=<id>` | 健康检查条显示的同一份检查结果 |
| `/stats` | 历史文件原文 + 覆盖与回填状态 |
| `/verify?session=<id>` | 对活着的会话重新装配一次，返回**生效后**的段落、上下文与工具名 |
| `/diag` | 客户端模块是否进了 boot 表、最近一次应用结果、过滤器调用次数 |
| `/policy`、`/export`、`/locale` | 策略文件状态、导出、全部 8 份字典 |
| `POST /boot`、`POST /registrations` | 客户端自报诊断（仅内存；GET 返回 405） |
| `POST /action` | 唯一改策略入口：开关、预设、导入、撤销（仅同源 JSON） |

`/summary?lang=` 是客户端实际使用的形式：响应只带一份词典加英文兜底，单次从约 267KB 降到约
150KB。

面板里不再放「核对本会话」按钮；要核直接打 `/verify?session=<id>`。

## 文档

- [详细说明](docs/DETAIL.zh.md)：五分钟版，量了什么、能关什么、各表面显示什么
- [架构](docs/ARCHITECTURE.md)：五条注入通道、快照流水线、五个入口槽位、路由与数据文件
- [决策记录](docs/DECISIONS.md)：右侧栏为什么替代 `sidebar.panel`、设置卡片为什么写 volatile
  Config、会话标签页为什么只读
- [RSI](docs/RSI.md)：这个项目在版本之间用的可重复自审循环
- [自评](docs/SELF-ASSESSMENT.md)：对照本项目质量门槛给这一版打分，差距直说
- [差距台账](docs/GAPS.md)：诚实页上的每个数字，现值、目标、证据
- [反馈](docs/FEEDBACK.md)：报告里该带什么、诊断包含什么、我们怎么处理
- [分发 SOP](docs/DISTRIBUTION.md)：标准渠道（GitHub Release、npm、awesome 目录）、每次发版动作、目录自动更新的边界、回滚方式
- [常见问题](docs/FAQ.md)：AGENTS.md 为什么关不掉、内容抽屉会读什么、和 dsh-context 的关系
- [兼容性](docs/COMPATIBILITY.md)：已验证版本（0.2.2-rc.1 CLI、0.2.2-rc.5 Desktop）、依赖接口、升级排查
- [性能](docs/PERFORMANCE.md)：快照、五个入口与趋势回填的实测耗时
- [安全](SECURITY.md)：报告渠道、可验证的边界、已知风险
- [参与开发](CONTRIBUTING.md)：本地循环、提交前检查、发布步骤（`npm run smoke` 可离线跑整条流水线）

完整译文只有 `docs/DETAIL.md` 与 `docs/DETAIL.zh.md`；`de` / `es` / `fr` / `ja` / `pt` / `ru`
的 DETAIL 目前只有一张预览图，是占位，不是完整译文。README 本身提供八种语言（见顶部切换行）。

## 限制

- 技能目录是 pre-step 消息，只有「逐条 shadow」与「关掉 skill 工具」两种粒度。
- 工作区规则、时间上下文这类 user 消息通道不可管，插件只做展示（连原文一起展示）。
- 洞察趋势只包含本插件测过、或从历史日志定价过的会话；更早的记录没有通道分解，画成斜纹。
- 会话标签页只读：开关只作用于保存之后新建的会话，这一点和面板一直说的一致；宿主已经不再持有的
  会话打开时会退回到最近活跃会话。
- 右侧栏入口通过宿主的 `sidebarRightTabs` 服务注册；没有这个服务的旧宿主（0.2.1 时代）保留旧
  `sidebar.panel` 注册，两者都没有时就没有侧栏入口，其余四个入口照常工作。
- 设置行只有在宿主提供配置表单时可写；否则显示当前生效值并注明只读。
- 还没做：工具归属到具体插件（宿主 `ToolSchema` 没有 owner 字段）、技能最近是否被使用、会话间
  差异、事件时间线筛选、354 行列表虚拟化。
- 界面支持简体中文、English、日本語、Español、Français、Deutsch、Русский、Português 八种
  语言；新增语言只需在 `locale/` 加一个同键集 JSON。

## 许可

MIT
