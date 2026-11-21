# 项目状态与目标对照（2026-11-21）

一页看完：这轮目标做到哪、证据在哪、还剩什么、哪些不在我们控制内。

## 1. 目标五项

| # | 目标 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 目录收录从 0 更正为实际，并让「发现页」有入口 | **完成** | awesome 条目 `data/plugins/IWHBIWHB__dsh-injection-manager.yml`，PR #17255 已 MERGED（2026-11-20）；Discover 索引源 `https://awesome-dsh-plugin.com/index.json` 含本包（6376 条），隔离实例搜 owner/包名/中文均可见卡片；卡片版本 2.1.1 是目录构建缓存滞后（其 scheduled 构建挂起），见 GAPS 第 1 行 |
| 2 | 外部反馈通道 + 首批真实反馈 | **通道完成，邀请已公开** | 设置页「复制诊断 / 报告问题」（脱敏报告 `lib/diagnostics.js`，`/diag?report=1`）；issue 模板；`docs/FEEDBACK.md`、`docs/BETA.md`；已公开 3 个试用邀请：官方 DSH `Show Your Plugins!` #13984、awesome `Show and tell` #17474、本仓库 Discussions #1；截至发帖时 0 条回复（等待中） |
| 3 | 发布 tag 从 9 到有节奏 | **完成** | tag 11（`v2.3.1`）；`scripts/release.mjs` 把 CI 同门槛+bump+tag 收成一条命令；SOP「patch 每周 / minor 2–4 周」见 `docs/DISTRIBUTION.md` §4；npm 2.3.1 + release workflow success |
| 4 | 0.2.0 / 0.2.1 真机验证并修兼容 | **完成** | 0.2.0-rc.1 与 0.2.1-rc.5 从 npm 装进隔离 home：插件激活、`/summary apiVersion 2`、preset 写入落盘、诊断报告、0 console error；修复 `workingDirectory` 硬依赖与旧 CLI 版本识别；矩阵见 `docs/COMPATIBILITY.md` |
| 5 | 自评/GAPS 与诚实数据有据 | **完成** | `docs/SELF-ASSESSMENT.md`（8.8/10，2.3.1 节）；`docs/GAPS.md`（每项现值/目标/证据）；`docs/RSI.md` 2026-11-21 轮；看板 `D:\DSH\差距-诚实-2026-11-21.html` |

## 1.1 使用信号（不是"反馈"，但能说明有人在用）

| 指标 | 值 | 口径/限制 |
| --- | --- | --- |
| npm 周下载 | **1,456**（2026-11-13~19） | `api.npmjs.org/downloads`；含 CI、重复安装与镜像，不等于独立用户数 |
| GitHub 克隆（14 天） | 511 次 / 178 唯一 | 可能含 CI 与自动化 |
| 外部反馈 | **0** | 已公开发 3 个试用邀请帖，等待回复 |

## 2. 当前发布

| 项 | 值 |
| --- | --- |
| npm | `dsh-injection-manager@2.3.1`（latest，provenance） |
| GitHub | tag `v2.3.1` + Release + tgz；累计 tag 11 |
| CI / release workflow | 均 success（最近文档提交 `f158eb4` 的 CI 亦为 success） |
| 安装验收 | 干净 profile 从 npm 装 2.3.1：五入口 16/16；反馈行实测 550 字符脱敏报告、issue 预填、0 console error |
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
  4 个邀请/提问帖：官方 DSH Show Your Plugins #13984、awesome Show and tell #17474、本仓库 Discussions #1、
  官方 General「大家怎么量一个插件往首轮上下文里塞了多少」#13985；另在「上下文灾难」#12329 留了同口径测量回复。
  截至 2026-11-21 17:00 仍 0 条外部回复；npm 周下载 1,456 说明有人在装，但还没有人回失败样本。
- **上游催办草稿**：`_research/outreach/upstream-issues.md`（Registry PR ping；awesome 构建已自行恢复，
  只剩 Registry 那条），未发。

## 4. 下一轮候选

- 会话标签页加一条会话内结论（本会话最大的可关套件 + 跳转）；
- `/summary` 分页参数，会话页不再整包轮询；
- 工具归属到插件、技能最近使用、会话间 diff、事件筛选、354 行列表虚拟化；
- 0.2.2-rc.2 / rc.4 逐个补测；官方市场落地后复核索引源；
- 收到首批外部反馈后按失败类型排序修复。
