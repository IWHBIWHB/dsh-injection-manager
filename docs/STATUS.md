# 项目状态与目标对照（2026-11-22，3.0.0）

一页看完：这轮目标做到哪、证据在哪、还剩什么、哪些不在我们控制内。

## 1. 目标五项

| # | 目标 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 目录收录从 0 更正为实际，并让「发现页」有入口 | **完成** | awesome 条目 `data/plugins/IWHBIWHB__dsh-injection-manager.yml`，PR #17255 已 MERGED（2026-11-20）；Discover 索引源 `https://awesome-dsh-plugin.com/index.json` 含本包（6376 条），隔离实例搜 owner/包名/中文均可见卡片；卡片版本 2.1.1 是目录构建缓存滞后（其 scheduled 构建挂起），见 GAPS 第 1 行 |
| 2 | 外部反馈通道 + 首批真实反馈 | **通道完成，邀请已公开** | 设置页「复制诊断 / 报告问题」（脱敏报告 `lib/diagnostics.js`，`/diag?report=1`）；issue 模板；`docs/FEEDBACK.md`、`docs/BETA.md`；已公开 3 个试用邀请：官方 DSH `Show Your Plugins!` #13984、awesome `Show and tell` #17474、本仓库 Discussions #1；截至发帖时 0 条回复（等待中） |
| 3 | 发布 tag 从 9 到有节奏 | **完成** | tag 16（`v3.0.3`）；`scripts/release.mjs` 把 CI 同门槛+bump+tag 收成一条命令；SOP「patch 每周 / minor 2–4 周」见 `docs/DISTRIBUTION.md` §4；npm 2.3.1、2.3.2 + release workflow success |
| 4 | 0.2.0 / 0.2.1 真机验证并修兼容 | **完成** | 0.2.0-rc.1 与 0.2.1-rc.5 从 npm 装进隔离 home：插件激活、`/summary apiVersion 2`、preset 写入落盘、诊断报告、0 console error；修复 `workingDirectory` 硬依赖与旧 CLI 版本识别；矩阵见 `docs/COMPATIBILITY.md` |
| 5 | 自评/GAPS 与诚实数据有据 | **完成** | `docs/SELF-ASSESSMENT.md`（8.9/10，3.0.0 节）；`docs/GAPS.md`（每项现值/目标/证据）；`docs/RSI.md` 2026-11-22 轮；看板 `D:\DSH\差距-诚实-2026-11-21.html` |

## 1.1 使用信号（不是"反馈"，但能说明有人在用）

| 指标 | 值 | 口径/限制 |
| --- | --- | --- |
| npm 周下载 | **1,456**（2026-11-13~19） | `api.npmjs.org/downloads`；含 CI、重复安装与镜像，不等于独立用户数 |
| GitHub 克隆（14 天） | 511 次 / 178 唯一 | 可能含 CI 与自动化 |
| 第三方验证 | dsh.so：**L5 · runtime verified / LowRisk / Gold Trust** | artifact 2.1.1 on dsh 0.2.2-rc.3；2.3.1 复核 ticket #01a1fdf4-2ee5-7a3a-b02d-d64bc6cc3e6e；独立社区站，不等于官方背书 |
| 外部反馈 | **0** | 已公开发 4 个邀请/提问帖 + 1 条兼容性数据回复，等待回复 |

## 1.5 v3.0.0：注入台账与全景图（2026-11-22）

v2 是「能关什么」，v3 补上「实际注入了什么、归谁、边界在哪」：

- **注入台账**：在宿主 `system-prompt/assemble` 装配瀑布现场记录每次请求（offered/admitted 段落、上下文、变量，同次装配的工具 schema），`agent/pre-step` 补全 turn/step 与消息级注入；内容寻址存精确原文（消息级只留预览）。面板第 4 个分区「台账」可回看、看差异、看被策略拦下的项。
- **归属目录** `lib/catalog.js`：每个注入面标注注册包、可控性（plugin/protected/preview/user）与宿主源码行号；没有目录项的来源标 unknown，不假装能关。
- **源码全景** `docs/INJECTION-PANORAMA.md`：六个注入面、段落/上下文 order 全表、消息级 kind 全表、优先级/覆盖规则、可见性渠道、可控边界、未验证项与文档/源码冲突。
- **验证**：159 测试 / 0 fail；0.2.2-rc.5 隔离实例真实请求 → 台账 24 段落 / 8 上下文 / 11 工具 schema / 2 条消息级注入，原文按 hash 精确回读；面板台账页 14/14 探针通过；策略关闭 `tool:jobs` + `job_list` 后，新会话台账列出 blocked 且 schema 消失（10/10）。验证过程中还修了两个真 bug：`names` 批量关闭在默认 all 模式下静默不生效；客户端漏了台账路由表导致 404。

## 1.6 v3.0.1：注入台账的两处诚实修正（2026-11-22）

- **required 上下文不算被拦**：`working-directory:current`、`subagent:identity` 被 waterfall 删掉后宿主 `refreshContext` 会补回，台账改记 `status:"restored"` + 独立计数，不再谎称「被策略拦下」。
- **全景图源码引用修正**：独立核查 29 条，改正此前把 `docs/subsystems/system-prompt.md` 行号误写成 `src/index.ts` 行号的 9 处、4 处文件归属、1 处包路径（contextBreakdown 在 `dsh-token-meter`），并把每步顺序改成 `assemble → agent/pre-step → refreshContext → project`；无法证实的说法标为假设。
- 验证：160 测试 / 0 fail；台账跨宿主重启从 `ledger.jsonl` 重新加载；自审 100/100。

## 1.7 v3.0.2：归属目录补全（2026-11-22）

真实请求截图暴露出 `working_directory`、`present`、`plugin_manager` 被标成 unknown tool provider：补全归属目录里第一方工具（含 agent-team / goal / todo / ask-user / worktree 等）的包映射。160 测试 / 0 fail，自审 100/100。

## 1.8 v3.0.3：让精确原文真的落盘（2026-11-22）

内容寻址目录 `ledger-text/` 之前没有创建，写文件失败被警告吞掉，原文只活在进程内存里、重启后读不到。现在写队列先建目录，并加测试 flush 后从磁盘回读。真机验证：请求后目录里出现文件，重启后同一 hash 仍能取回原文。160 测试 / 0 fail。

## 2. 当前发布

| 项 | 值 |
| --- | --- |
| npm | `dsh-injection-manager@3.0.3`（latest，provenance） |
| GitHub | tag `v3.0.3` + Release；累计 tag 16 |
| CI / release workflow | 均 success（`v3.0.0` 发布时复核） |
| 安装验收 | 干净 profile 从 npm 装 2.3.1：五入口 16/16；反馈行实测 550 字符脱敏报告、issue 预填、0 console error。2.3.2 只改客户端 `/inject` 面与文档：registry 上 2.3.2 的 tarball 已核对（88 文件、含弹层注册代码、无旧命令），0.2.2-rc.5 QA 实例探针 12/12（斜杠菜单行带图标、弹层动作/套件分组、点套件真实写策略 23→0、0 console error）；未重跑整包干净安装 |
| 旧宿主验收 | 0.2.0-rc.1 / 0.2.1-rc.5：激活、路由、preset 写入、诊断报告均通过（证据 `_research/verify/evidence/old0*.json`，开发机） |

## 3. 外部依赖（不是我们的代码问题）

- **awesome 目录的版本字段**：push/merge 构建只重建文本、不跑 npm 探针；每日 scheduled `build-site`
  才 `PROBE_ALL`。2026-11-21T02:28Z 的 scheduled 构建已 **success**，发现页卡片版本从 2.1.1 刷新到
  **2.3.0**；当天 05:27Z 发布的 2.3.1 会在下一次（次日 02:23Z）构建进入索引。
- **发现页的卡片图标**：目录索引生成器目前不输出 `icon` 字段（6376 条里 0 条带 icon），所以发现页
  统一显示默认图标；条目的 `icon` 字段仍供其他消费者使用，不是我们缺字段。
- **DSH Registry（`dsh-pluginmarket/metadata`）**：bot 于 11-16 自动建 issue #8956 与 PR #8969，
  等该仓库维护者 review；不能替对方合并。
- **首批真实用户反馈**：产品内通道、[FEEDBACK.md](FEEDBACK.md)、[BETA.md](BETA.md) 已就绪，并已公开发出
  5 个公开互动：官方 DSH Show Your Plugins #13984、awesome Show and tell #17474、本仓库 Discussions #1、
  官方 General「大家怎么量一个插件往首轮上下文里塞了多少」#13985、官方 CJK token 估算 bug 帖 #13906 的
  同口径数据回复；另向 dsh.so 提交了 2.3.1 数据/兼容性复核（ticket #01a1fdf4…）。
  截至 2026-11-21 20:10 仍 0 条外部回复；npm 周下载 1,456 说明有人在装，但还没有人回失败样本。
- **上游催办草稿**：`_research/outreach/upstream-issues.md`（Registry PR ping；awesome 构建已自行恢复，
  只剩 Registry 那条），未发。

## 4. 下一轮候选

- 会话标签页加一条会话内结论（本会话最大的可关套件 + 跳转）；
- `/summary` 分页参数，会话页不再整包轮询；
- 工具归属到插件、技能最近使用、会话间 diff、事件筛选、354 行列表虚拟化；
- 0.2.2-rc.2 / rc.4 逐个补测；官方市场落地后复核索引源；
- 收到首批外部反馈后按失败类型排序修复。
