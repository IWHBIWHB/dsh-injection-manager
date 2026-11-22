# GAPS — 差距台账

这份文件回答一个问题：对外那页「差距 / 诚实」上的每个数字，现在是多少、差在哪、下一步谁来做、
证据在哪。数字会变，台账要能跟着变。

更新方式：每次发版或拿到新证据后改这一页；不要只改数字不留证据。

| # | 指标 | 当前值 | 目标 | 收口动作 | 证据 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 官方精选目录收录 | **1，且发现页已实测可见**：Discover 的索引源是 `https://awesome-dsh-plugin.com/index.json`（6376 条），隔离实例里搜 owner / 中文 / 包名都能看到卡片；条目描述与图标为合并后的版本（PR #17255 已于 2026-11-20 合并）；卡片版本已刷新到 **2.3.0**（下一次构建到 2.3.1）。另有第三方独立注册表 **dsh.so** 已收录并给出 **L5 · runtime verified / LowRisk / Gold Trust**（artifact 2.1.1 on dsh 0.2.2-rc.3；2.3.1 的复核已提交，ticket #01a1fdf4-2ee5-7a3a-b02d-d64bc6cc3e6e） | 保持 1，并让条目信息与最新版一致 | 目录侧版本刷新依赖其每日 scheduled `build-site` 的 PROBE_ALL；push/merge 构建只重建文本、不跑 npm 探针。`dsh-pluginmarket/metadata` 收录 PR #8969 仍等维护者 review（非我们可控） | `data/plugins/IWHBIWHB__dsh-injection-manager.yml`（PR #17255 MERGED）；`awesome-dsh-plugin.com/index.json`；dsh.so 插件页；`_research/verify/desk-market/verify-discover.mjs` | 已收录；等目录/注册表刷新 |
| 2 | 外部 issue / PR（真实用户的失败与误解） | **0**（截至 2026-11-21）；已公开发出 4 个邀请/提问帖 + 1 条同口径数据回复，等待首批回复。旁证：npm 周下载 **1,456**（2026-11-13~19，含 CI/重复安装，不等于用户数） | ≥3 条真实反馈 | 反馈入口 + 8 分钟 [BETA 脚本](BETA.md) + [反馈共识](FEEDBACK.md) 已就绪；公开邀请已发：官方 `deepseek-ai/deepseek-harness` Show Your Plugins (#13984)、awesome 目录 Show and tell (#17474)、本仓库 Discussions (#1)、官方 General 测量方法提问 (#13985)；并补了 20 秒低门槛回复；另在 CJK token 估算帖 (#13906) 留了同口径数据回复。下一步：对每条回复先在公开帖里确认，再转 issue 修 | 三个讨论链接；`client.js` 反馈行；`lib/diagnostics.js`；`docs/FEEDBACK.md`；`docs/BETA.md`；npm downloads API | 邀请已发，等待外部回复 |
| 3 | 发布 tag | **14**（v3.0.1 发布后；此前 13） | 有节奏的持续发布（patch 每周、minor 每 2–4 周） | 已加 `scripts/release.mjs`（CI 同门槛 + 版本号 + tag 一条命令）与 `docs/DISTRIBUTION.md` §4 节奏；每次真改动都发 patch，不再攒大版本 | `scripts/release.mjs`；`git tag -l` | 机制完成，按节奏增长 |
| 4 | 真机验过的宿主 | **4 个版本**：0.2.0-rc.1、0.2.1-rc.5、0.2.2-rc.1、0.2.2-rc.5 | 覆盖 0.2.x 各 rc（含 0.2.2-rc.2/3/4） | 0.2.0 与 0.2.1 已从 npm 装进隔离 home 实测（插件激活、`/summary`、preset 写入、诊断报告）；剩余 rc 用同一套脚本逐个跑 | `docs/COMPATIBILITY.md`；`_research/verify/probe-old-actions.mjs`（开发机） | 主要版本已覆盖 |
| 5 | 产品·工程·文档自评 | **8.9 / 10**（3.0.0） | 9.0+ | 这次补了旧宿主真机、反馈通道、发布自动化；未补：客户端单测、列表虚拟化、官方市场未上线（外部） | `docs/SELF-ASSESSMENT.md` | 持续 |

## 3.0.0 发版验证（2026-11-22）

- 新增「注入台账」：装配现场逐请求记录（offered/admitted）、归属目录、第 4 个面板分区、3 条只读路由、模型侧 `{ledger:true}` 模式；`API_VERSION` 2 → 3，路由 15 → 18。
- 真机（0.2.2-rc.5 隔离实例）：真实请求台账 24 段落 / 8 上下文 / 11 工具 schema / 2 条消息级注入；精确原文按内容 hash 回读；面板台账 14/14 探针通过、0 console error。
- 控制闭环：策略关闭 `tool:jobs`（段落）与 `job_list`（工具）后新建会话，台账 `blocked.sections` 列出该段落、admitted 段落不再包含它、schema 集合里 `job_list` 消失（10/10）。
- 过程中修掉两个真 bug：① 批量 `names` 关闭在默认 `all` 模式下保持 mode=all，规范化把名字丢掉，开关静默无效（现改为复用 `toggleItem` 的迁移规则，并加 3 条测试）；② 客户端 ROUTES 漏了 3 条台账路由，页面 404。
- 门槛：测试 159 / 0 fail（修正：此前本地 `node --test` 把 `_research` 下的重复副本也算进来，虚增 75 条；CI 口径一直是 24 个测试文件）；自审 routes/文档/apiVersion 对账通过；客户端体积预算 276 KB → 304 KB（台账页，注明原因）。
- 未做：0.2.x 两代宿主上本轮新代码未实测；消息级注入只预览不提供默认过滤（实验性，未实现）；台账从插件启动后开始记录，之前的历史只能看会话投影估算。

## 2.3.2 发版验证（2026-11-22）

- 起因是本人试用反馈：「斜杠菜单里的 inject 没用」——旧版是宿主文本命令，没有图标，`/inject`
  只重复面板已有的数字。这次改成客户端 `commandUi` 弹层：带插件图标、可搜索，前四行是动作
  （打开面板 / 最小预设 / 全开 / 撤销），后面按 token 排序列出可动套件。
- 实测（0.2.2-rc.5 QA 实例，探针 `_research/verify/desk-dev/probe-inject.mjs`）**12/12**：
  斜杠菜单行 `注入快捷开关 inject` 带 SVG 图标；回车打开弹层（动作组 + 套件组 + 搜索框）；
  点 `core` 后 `onCount` 由 23 → 0（真写 `/action`）；弹层关闭；0 console error。
- 顺手修了同一次改动里的真 bug：弹层发给 `/action` 的是去掉通道前缀的短 key（`core`），
  路由按完整 group id（`tools:core`）匹配，点了等于没点——现已按面板同款 payload 发送。
- 工程门槛：150 测试 / 0 fail（修正后口径），自审 100/100（7/7）；自审新增「客户端 `commandUi` 注册」对账项，
  宿主改名时入口消失会先失败。npm 2.3.2（provenance）+ tag `v2.3.2` + Release。
- 未做：2.3.2 没有重跑整包干净安装（改动只在客户端与文档；release workflow 已对 tag 跑测试与
  打包检查），0.2.x 两代宿主上 `commandUi` 是否存在未单独验证，`COMPATIBILITY.md` 已如实标注。

## 2.3.1 发版验证（2026-11-21）

- npm：`dsh-injection-manager@2.3.1` 已发布（provenance），装进干净 profile（`v2qa-231`）后
  五入口探针 **16/16**；反馈行可用：复制诊断 550 字符、无路径、issue 模板与正文预填、0 console error。
- GitHub：tag `v2.3.1` + Release；CI 与 release 两条 workflow success；release 资产附 tgz。
- 旧宿主：0.2.0-rc.1、0.2.1-rc.5 从 npm 装进隔离 home，插件激活、`/summary`、preset 写入、
  诊断报告均通过（见 COMPATIBILITY）。
- 目录：条目仍在；PR #17255 仍等维护者合并；市场版本字段按夜间探针节奏刷新（当前仍显示旧版，
  属预期滞后，见 DISTRIBUTION「市场可见性验收」）。

## 已知无法靠代码消除的差距

- **官方市场尚未上线**：DSH 官方文档写明 `DSH ships no index source`，目前的市场是 dsh-market
  与社区目录；「被官方推荐」只能等官方市场落地 + 真实使用数据。
- **社区证明**（star、下载、issue 数）需要时间与真实用户，不能伪造；能做的只有降低反馈门槛、
  按节奏发布、把插件放进用户已经在看的目录（已完成）。
- **dsh-context 的 171 个 release** 是两年演进积累，不是一次冲刺能追平的；本项目的对策是
  固定节奏 + 每次发布都带验证，而不是刷版本号。

## 这页不存在时怎么办

如果某天这页没更新：以 `CHANGELOG`、`docs/COMPATIBILITY.md`、`git tag` 和 GitHub Release 为准；
数字以实测命令为准（见 `docs/DISTRIBUTION.md` 的「市场可见性验收」）。
