# 决策记录

每一条记录：决定、被否掉的替代方案、以及当时能拿到的证据。时间线倒序（最新在上）。

## 2026-11-20 · 2.3.0（RSI 第 6 轮：五入口闭环）

### D26 右侧栏面板迁移到 `sidebarRightTabs`，而不是新建一个面板

- **决定**：右侧栏入口用宿主 0.2.2 的 `ctx.sidebarRightTabs.register()` + `sidebar.right.pane.tab`
  + `sidebar.right.pane.tab.title` 注册，复用既有 `SidePanel`（`Panel compact`）。
- **否掉**：保留旧 `sidebar.panel` 槽。它在 rc.5 已不存在，注册不报错但也永远不渲染——「静默失效」
  比「缺失」更糟。
- **否掉**：为右侧栏另写一个视图。compact Panel 已经是按侧栏场景设计的（KPI、请求条、技能焦点、
  构成、通道开关、套件前 12 行、Esc 关闭），重写只会多一套口径。
- **证据**：本机模板阅读（`research/03-client-cookbook.md` §3.1）；rc.5 实测五个入口 16/16 通过；
  rc.1 上同一注册也渲染成功（旧宿主同时具备该服务，未触发兜底）。

### D27 会话标签页只读，只讲本会话

- **决定**：新增 `conversation.view` 标签「注入」，数据仍走 `GET /summary?session=<id>`；先讲
  `numbers.session`（本会话已注入），再讲 `numbers.next`（新会话将注入），加可关闭占比、窗口占用、
  通道构成；不做任何开关。
- **否掉**：在会话页放开关。策略在 `agent/created` 时一次性应用，运行中的会话不会被改写；在会话页
  放开关会让「关掉」看起来像改变了当前对话，这正是 2.2.0 花一轮修掉的误解。
- **否掉**：新加一条会话级路由。`/summary` 已经接受 `session` 参数并由 `pickAgent` 解析；多一条路由
  就多一份需要保持同口径的数据源。
- **证据**：`lib/routes.js` 的 `summary` handler；`_research/verify/desk/` 的 probe 截图与
  16/16 检查；会话页与面板同一时刻的 `14,580 / 14,580` 数字一致。

### D28 偏好行写 Host Config，三个字段改成 `.volatile()`

- **决定**：`dock` / `refreshOnFocus` / `showRawNames` 三个呈现偏好注册到 `settings.general.item`，
  通过 `configForms.get('injection-manager')` 读写；Config 三个字段声明 `.volatile()`，
  `lib/settings.js` 用 `readField()` 同时接受普通值与 volatile 引用，`getSettings()` 每次重读。
- **否掉**：保持非 volatile。宿主语义是「编辑普通字段会重启插件」，为了隐藏一个徽标重启插件、丢掉
  内存里的快照缓存与策略应用状态，代价与收益不成比例。
- **否掉**：`plugins.bundle.config`（插件详情页配置卡）。它在 rc.1 的插件页里没有稳定入口
  （点击插件行会跳到插件自己的主页面），而 `settings.general.item` 在两代宿主上都稳定渲染。
- **证据**：`docs/COMPATIBILITY.md` 的入口降级表；settings.test.mjs 覆盖普通/volatile 两种形态；
  rc.5 实测：切换 `dock` → `/summary.settings.dock=false`，无重启。

### D29 输入框徽标与模型工具不算「入口」

- **决定**：README 与产品口径写「五个入口」；徽标是常驻读数（`numbers.next` 的环境展示，可在偏好行
  隐藏），`context_injection` 是模型可引用的只读快照。两者都不单独计入入口。
- **理由**：入口的定义是「用户主动打开一个面去回答同一件事」；徽标不打开任何面，模型工具是给人之外
  的读者用的。把它们算进去会让「五入口」变成营销数字，也掩盖不了它们与面板同源的事实。
- **否掉**：为了凑数把徽标改造成可展开的小面板。那会把 ambient 信息变成第六个需要维护的交互面。

### D30 自审脚本加入「五入口契约」硬检查

- **决定**：`scripts/self-audit.mjs` 的 reconcile 项新增：五个槽位名必须同时出现在 `client.js`
  的注册代码与 `docs/ARCHITECTURE.md`；任一侧缺失直接 fail（15 分）。
- **理由**：宿主升级（rc.3 → rc.5 就删掉了 `sidebar.panel`）会让入口静默消失；文档与代码对不上时，
  下一个维护者只能靠肉眼发现。自审是这一轮唯一能自动拦住它的地方。
- **证据**：自审 100/100（测试 226）；`docs/RSI.md` 本轮日志。

## 2026-11-18 · 2.2.x（RSI 第 1–4 轮：减法与口径）

### D20 一个数只有一个来源：`numbers.session` / `numbers.next`

- **决定**：`/summary` 返回 `numbers: {session, next}`，所有表面（面板首行、侧栏脚注、徽标、构成卡标题、
  工具卡）读同一对；措辞固定为「本会话」与「新会话首轮」。
- **否掉**：各表面各自从 `totals`/`effective.totals` 取值。曾经同一个屏幕上出现四个数（徽标读全开、
  面板读生效值），用户无法判断哪个是真的。
- **证据**：`docs/RSI.md` 2026-11-18 轮；自审护栏 (a)「DockChip 不得读 `data.totals.tokens`」。

### D21 「关闭」只有一种含义，另一个叫「新会话关闭」

- **决定**：`closedBadge`（已关闭）= 已不在装配里；`offNextSession`（新会话关闭）= 本会话还有、下次
  新建会话不再注入。两个状态不再共用同一个词。
- **理由**：开关只对新会话生效是产品语义；混用「关闭」会让用户以为当前对话被改写了。

### D22 策略写入串行化 + 写前 `.bak`

- **决定**：`lib/lock.js` 进程内读-改-写队列；临时文件名带计数器与随机后缀；写前复制上一份为
  `policy.json.bak`；解析失败先恢复 `.bak`。
- **否掉**：直接 `writeFile`。两个窗口同时开关会互相覆盖；坏文件会让策略静默回到全开。
- **证据**：`test/policy-write.test.mjs`、`test/policy.test.mjs`；2.2.0 发布说明。

### D23 减法优先：管理页只留「开关板」，洞见不重复叙述

- **决定**：2.2.1–2.2.9 连续删掉重复 KPI、已关闭列表、撤销历史、核对按钮、事件时间线卡，把设置页并成
  一张五行卡。每一条删除都在 CHANGELOG 里有理由。
- **理由**：信息密度不是把所有东西都放上去；用户要的是「下一个会话多少、关什么最划算」，重复图表只会
  稀释判断。

## 2026-11-15 之前 · 立身之本

### D1 四条通道，分别用最弱够用的机制

- **决定**：系统提示词段落与运行时上下文用会话作用域 `system-prompt/assemble` 过滤器按名字移除；
  技能用同名不可调用技能 shadow；工具用 `ctx.tools.restrict({deny})`；工作区规则只读展示。
- **否掉**：改文件（重命名 `AGENTS.md`、改 `SKILL.md` frontmatter）。多会话、多工作目录下会改错对象，
  旧版实现已废弃。
- **证据**：`docs/ARCHITECTURE.md` 四条注入通道；`lib/apply.js`。

### D2 只影响新会话，当前会话永不改写

- **决定**：策略在 `agent/created` 时应用一次；面板与命令明确写「只影响之后新建的会话」。
- **理由**：改写正在进行的对话会破坏 prompt 缓存、让同样的对话在不同时刻看到不同上下文，也无法解释。

### D3 只读工具，写只能由人点

- **决定**：`context_injection` 模型工具只返回快照与单条原文（≤32KB），不提供写入；所有写操作来自面板
  或设置表单。
- **理由**：放宽/收紧上下文是用户的决定；让模型自己改策略等于让被观察者改观察规则。

### D4 不碰用户文件，数据只落在 `$DSH_HOME/injection-manager/`

- **决定**：策略、统计、事件三个 JSON 都放在插件自己的目录，原子写、可删除；不写工作区、不写 profile。
- **证据**：`docs/ARCHITECTURE.md` 数据文件表；README Data & privacy。

### D5 数字诚实：估算标 ≈，未知显示未知

- **决定**：注入 token 是估算（ASCII/4 + 非 ASCII/1.6）就标 ≈；窗口未知显示「窗口未知」；趋势里没有
  通道分解的老行报 `null` 并画斜纹，不补 0。
- **证据**：2.2.0 快照与工具卡文案；`docs/PERFORMANCE.md` 的测量口径。
