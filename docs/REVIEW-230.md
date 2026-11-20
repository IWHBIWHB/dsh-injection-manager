# dsh-injection-manager 2.3.0 新增三入口设计评审

评审对象：2.3.0 新增的会话标签页「注入」、右侧栏面板、设置→通用设置偏好行，以及它们与既有面板、`/inject`、输入框徽标的关系。只评这三个入口及其衔接，不评插件整体。只读评审，未改代码。

评审依据：仓库 `4bdb197`（client.js 与三张新截图）；rc.5 QA 实例（`_research/verify/desk/.qa-state.json`，端口 49811）复测；截图 `docs/images/session-tab.png`、`sidebar-panel.png`、`settings-general.png`、`dock.png`，以及 `_research/verify/desk/shots/entries/02-session-tab.png`、`03-right-panel.png`、`05-settings-card.png`。`_research/verify/desk/probe-entries.mjs` 的 16/16 只证明「五个入口能渲染、一个 Config 写入能到宿主」，不覆盖下面任何一条交互或口径问题。

## 总分 33 / 70

低分不在视觉：三个新入口的版面和密度是成立的。扣分集中在「能看但没接上」：两个哑按钮、一处数字口径混用、三个徽标开关，以及几处把设计意图说大了的文案。

| 维度 | 分 | 主要证据 |
| --- | --- | --- |
| 1 五入口分工 | 6 | 四个面读同一份快照（`/summary`，命令里是 `buildSnapshot()`），设置行显示和写入的是宿主 Config（`SettingsCard` 4651-4757；`/summary` 只用于 locale 与只读兜底，4652/4702），却被 README 73-75 包装成「同一份快照的五个读法」，与 `docs/ARCHITECTURE.md` 174-196 自己的入口表矛盾；真正的重复是「输入框徽标」有 3 个开关。 |
| 2 会话标签页 | 5 | 首屏顺序合理（本会话→新会话→可关闭→窗口），只读说明也在；但构成条与「可关闭」卡取自下个会话的 `effective`，页脚取本会话 `totals`（`SessionView` 4594/4622/4643），两数相等时又没有一句解释（`session-tab.png` 两个 16.2k）。 |
| 3 右侧栏面板 | 5 | 648px 宽下 3 个 KPI + 近 10 行开关一屏可达（`sidebar-panel.png`），密度成立；但「去管理」「关闭」实测无反应（见下），右栏内部没有回完整面板的出口，只能改用左侧图标（用户不一定知道两者是同一件事的两档视图）。 |
| 4 设置偏好行 | 5 | 三行开关本身可懂；但 dock 提示把徽标的窗口占用写成「可关 xx%」（`dock.png` 显示 14.6k 83% 占用）；只读降级只覆盖 `status='missing'`；写失败被 `catch` 吞掉（4715-4723）。 |
| 5 设计一致性 | 7 | 全走 `--dsw-alias-*` token，暗色计算样式正确（会话页 #161619、卡片 #1d1d21、文字 #ececf1）；但设置行字号 12.5/11px 比宿主行 14/12px 小一档，并加了宿主没有的行分隔线（`05-settings-card.png` 同屏可对比）。 |
| 6 诚实性 | 5 | 两个数在会话页/侧栏/命令里都有标签；但「same wording」不成立（本会话已注入 / 本会话 / 合计…本会话），会话页混用两套 scope，宿主不持有该会话时 `/summary` 静默退回最近活跃会话（`lib/routes.js` 178-193、499-503），界面没有提示。 |

## 三个最该先修（按伤用户程度）

### 1. 会话标签页把「下个新会话」的数字摆在了「本会话」的标题下

- 现象：会话中途关掉一个套件后再打开「注入」页，顶部「本会话已注入」不变（对），但「可关闭」卡和整条「首轮注入构成」已经换成下个会话的投影，页脚的「可关」却仍按本会话实测；同屏出现两个「可关」值、一条与「本会话已注入」对不上的构成条，且没有任何字说明哪块属于下个会话。只读页里写「可关闭」，用户会先理解成「本会话可关」。
- 证据：`client.js` `SessionView` 4594 取 `snapshot.effective.totals`，4622 用它显示「可关闭」，4643 页脚改用 `snapshot.totals`，4632 把同一份快照交给共用组件 `Composition`；`Composition` 1681 一律读 `snapshot.effective`。截图 `docs/images/session-tab.png` 里两个数相等（16.2k / 16.2k）所以看不出来；`_research/verify/desk/shots/entries/02-session-tab.png` 同理。两数不相等时的问题只在代码里，截图无法自证。
- 建议：本会话页统一用 `totals`（构成条、可关闭卡、页脚同口径），「新会话将注入」只保留 KPI 卡；或反过来把构成条标题改成「新会话首轮注入构成」、可关闭卡改名「新会话可关闭」、页脚把两组数分别标 scope。不要维持现在这种「一半本会话、一半下个会话」的混排。

### 2. 输入框徽标：三处开关、两套存储，能互相盖成「开关 ON 但徽标不见」

- 现象：用徽标上的 × 隐藏后，设置→通用设置里的「输入框旁徽标」仍显示 ON（它读 Config，× 写的是 localStorage）；在插件面板「设置」里关掉再打开「在输入框下方显示摘要」，如果 Config 里 `dock=false`，徽标依然不出现。用户感知是「开关骗人」「点了没反应」，而且同一件东西有三个名字。
- 证据：`DockChip` 4765 用 localStorage `dockHidden`，4782 又读 `/summary.settings.dock`，4802-4805 的 × 只写 localStorage；`SettingsCard` 4727/4749 写 Config `dock`；`SettingsPage` 4101-4102 的「在输入框下方显示摘要」写 localStorage；标签见 `locale/zh.json` 152-153 与 420-429。截图 `docs/images/settings-general.png` 里是开关，`docs/images/dock.png` 里是被它控制的徽标。
- 建议：一个真相源。建议以 `Config.dock` 为准，× 也写 `Config.dock=false`；删掉插件面板设置页那个旧开关，或让它读写同一个状态。写入后广播 `injection-manager:changed`（`DockChip` 4773 已经在听），否则徽标最多要等 15 秒轮询才变。顺手把设置卡提示里的「可关 xx%」改成「窗口占用 xx%」（窗口未知时才回退可关占比）。

### 3. 右侧栏最显眼的两个按钮是哑的，右栏内部也没有回完整面板的出口

- 现象：技能卡右上「去管理」是右栏里最像动作的按钮，点了不打开主面板、不改变视图、没有任何反馈；面板头的「关闭」点了右栏不关（宿主 tab 已有 ×）。用户第一次用右栏会以为「这个入口只能看不能操作」，要回到完整面板只能改用左侧图标，而界面没说这两处是同一件事的两档视图。
- 证据：`SkillsFocus` 1455 的 `onClick: () => onFilter('skills')`，而 compact 分支 4378-4381 只把 `setFilter` 交给 `SkillsFocus`/`Composition`，没有任何清单消费它；同类的技能类型 chips、来源按钮、构成图例（1472/1494/1709）也都只改这个无人读的 filter。`Panel` 的 `close` 4310-4316 调的是 `layout.selectPanel(null)`（左侧面板选择器，4313），不是 `sidebarRightTabs`。本次在 rc.5 实例复测：点「去管理」后 `.ci-manage` / `.ci-tabs` 均未出现、右栏不变；点「关闭」后 `[data-sidebar-right-panel][data-sidebar-right-open="true"]` 仍在。
- 建议：「去管理」复用 `DockChip` 4794-4801 的 `layout.selectPanel('injection-manager')`，并关闭右栏；「关闭」删掉或改调宿主右栏关闭接口。若 compact 视图本来就不打算有筛选，就把这些按钮改成纯展示（去掉 pointer/可点样式），别留假动作。

## 快速收益（≤6 条，30 分钟内可改）

1. 改 `settingsCard.dockHint`：第二个数是窗口占用，不是「可关 xx%」（对照 `dock.png`）；并把「输入框旁徽标」与面板的「在输入框下方显示摘要」统一成一个名字。5 分钟。
2. 会话页止血：把「可关闭」卡先改成「新会话可关闭」，页脚与卡片同口径；只读说明从构成条后面移到标题下，并加一个「打开完整面板」按钮。15 分钟。
3. 设置卡的状态收尾：`settingsCard.readOnly` 的触发条件从 `form.status === 'missing'`（4754）扩到 `status !== 'ready' || writable !== true`；加载中不要用默认全 ON 的开关（4747）。15 分钟。
4. `SettingsCard.write()` 成功后 dispatch `injection-manager:changed`，失败时给一条可见错误（现在只有 `.catch(() => {})`，4715-4723），兑现「切换即时生效」。20 分钟。
5. 右栏去重：宿主 tab 已经写了「上下文注入」，面板内 h1 与副标题可以合并成一行（或删掉 h1），首屏给开关多留约 60px（`sidebar-panel.png` 顶部两块重复文字）。15 分钟。
6. 文档口径：README 73-75 的「One snapshot, five readings」「same wording」改成事实（四处读快照、设置行读 Config、措辞不统一）；README 120 行写徽标 `83.8k · 36%`，紧邻的 `dock.png` 是 `14.6k 83%`，两代数据混排，需要注明实例或重录。10 分钟。

## 值得保留的决定（≤5 条）

1. 会话页只读：不在会话语境里放开关，避免「关掉=改写当前对话」的误解（`docs/DECISIONS.md` D27；`SessionView` 全页没有 Switch，文案明说开关只作用于之后新建的会话）。
2. 右栏迁移复用 compact Panel，而不是另写一套：`sidebar-panel.png` 里 3 个 KPI、技能焦点、前 10 行开关一屏可达，窄栏密度和开关可达性成立，口径也不必再分叉。
3. 设置行走宿主 `settings.general.item` + volatile Config：位置是宿主的原生设置流，写入不重启插件，「只读降级」的思路也对，只差状态和反馈的收尾。
4. 五入口契约进自审：`scripts/self-audit.mjs` 574-610 把「五个槽位名同时出现在 client.js 与 ARCHITECTURE.md」变成硬检查，能先于用户发现宿主升级导致的入口静默消失。
5. 同一对 `numbers.session` / `numbers.next` 的分工：会话页先本会话、后新会话，面板/命令各用自己的主数，这个口径本身是对的（`lib/snapshot.js` 704-706 是唯一来源）。

## 如果只允许再改一处

改会话页的 scope：构成条和「可关闭」卡统一回本会话实测（或全部明确标成「新会话」），页脚同口径。理由：这是三个新入口里唯一直接违背产品「数字诚实」承诺的地方，而数字诚实是这个插件全部价值的根；修它只需动 `SessionView` 的两个取值、`Composition` 的一个入参和两三句文案。按钮坏了只损失一次点击，数错了会让人不再相信这块面板。

---

## 作者回应（2026-11-20，发布前）

评审按 `4bdb197` 所做；下面每一条都在评审后修改，并在 rc.5 实例上复测（`_research/verify/desk/probe-review.mjs`，10/10 通过；开发机脚本，不随包发布）。

| 项 | 处理 | 证据 |
| --- | --- | --- |
| 1 会话页 scope 混用 | 已修：`SessionView` 的可关闭卡、构成条、页脚统一读本会话 `totals`；「新会话将注入」只保留一张 KPI 卡；构成条用 `effective: null` 的会话快照喂 `Composition` | `client.js` `SessionView`；复测：可关闭 `13.7k / 84.7%` 与页脚 `13,740` 一致，构成条各段之和等于「本会话已注入」 |
| 2 徽标三处开关 | 已修：以 `Config.dock` 为唯一真相源；×、面板设置页开关、设置→通用设置行全部写同一个字段，删除 localStorage `dockHidden`；写入成功广播 `injection-manager:changed`，徽标立即刷新；设置行支持失败提示，写失败不再被吞 | `DockChip` / `SettingsPage` / `SettingsCard`；复测：设置行关掉 `dock` 后 `/summary.settings.dock=false`，再开恢复 |
| 3 右栏哑按钮 | 已修：「去管理」在 compact 视图隐藏；面板头删除「关闭」；新增「打开面板」按钮，调 `layout.selectPanel('injection-manager')` 回完整面板；标题去重（右栏只留一行说明 + 刷新 + 打开面板） | 复测：右栏 `.ci-head h1=0`、无「关闭」、无「去管理」，`slim=1` |
| 快速收益 1（dockHint 文案） | 已修：8 语言 `settingsCard.dockHint` 改为「注入 xxk · 窗口 xx%」 | `locale/*.json` |
| 快速收益 2（会话页止血 + 打开完整面板） | 已修（见第 1、3 条） | — |
| 快速收益 3（状态收尾） | 已修：只读提示条件扩到 `status !== 'ready' || writable !== true`；开关在非 ready 状态禁用 | `SettingsCard` |
| 快速收益 4（写失败反馈 + 广播） | 已修（见第 2 条），并新增 `settingsCard.writeFailed` 本地化 | `SettingsCard` |
| 快速收益 5（右栏标题去重） | 已修（见第 3 条） | `sidebar-panel.png` 已重拍 |
| 快速收益 6（文档口径） | 已修：README 八语言的「five readings / 同一份快照」改为「一对数、四种读法、一行设置」，并注明设置行不读快照 | `README*.md` |
| 设计一致性（设置行字号/分隔线） | 部分修：字号提到 13.5/11.5/13px；行分隔线保留——General 分区本身用分隔线分组，去掉后三行会连成一块 | `client.js` `.ci-cfg-*` |
| 诚实性（措辞不统一） | 未改 UI 措辞（改动会牵动 8 语言与大量既有测试）；已在 README 里把「same wording」换成「各自标明口径」，不宣称统一 | `README*.md` |

保留未做：会话页加「打开完整面板」大按钮（右栏已有；会话页一行提示足够），以及把宿主不持有会话的静默回退做成可见提示（需要新增一条 `/summary` 返回字段，留待下一轮）。

