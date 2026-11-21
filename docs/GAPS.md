# GAPS — 差距台账

这份文件回答一个问题：对外那页「差距 / 诚实」上的每个数字，现在是多少、差在哪、下一步谁来做、
证据在哪。数字会变，台账要能跟着变。

更新方式：每次发版或拿到新证据后改这一页；不要只改数字不留证据。

| # | 指标 | 当前值 | 目标 | 收口动作 | 证据 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 官方精选目录收录 | **1，且发现页已实测可见**：Discover 的索引源是 `https://awesome-dsh-plugin.com/index.json`（6376 条），隔离实例里搜 owner / 中文 / 包名都能看到卡片；条目描述与图标为合并后的版本（PR #17255 已于 2026-11-20 合并） | 保持 1，并让条目信息与最新版一致 | 目录侧版本刷新依赖其每日 scheduled `build-site` 的 PROBE_ALL；push/merge 构建只重建文本、不跑 npm 探针，所以卡片上的版本会滞后（当前显示 2.1.1，属目录构建缓存，非未收录） | `data/plugins/IWHBIWHB__dsh-injection-manager.yml`（PR #17255 MERGED）；`awesome-dsh-plugin.com/index.json`；`_research/verify/desk-market/verify-discover.mjs` | 已收录；等目录构建恢复 |
| 2 | 外部 issue / PR（真实用户的失败与误解） | **0**（截至 2026-11-21） | ≥3 条真实反馈 | 已把反馈入口做进产品：设置页「复制诊断 / 报告问题」（诊断已脱敏，可直接贴 issue）；issue 模板含 `/diag` 字段要求；下一步：在 DSH 社群发试用邀请（需本人账号与同意），拿到首批报告后按失败类型修 | `client.js` 反馈行；`lib/diagnostics.js`；`.github/ISSUE_TEMPLATE/`；`docs/FEEDBACK.md` | 通道已建，等待外部用户 |
| 3 | 发布 tag | **11**（v2.3.1 发布后；此前 9） | 有节奏的持续发布（patch 每周、minor 每 2–4 周） | 已加 `scripts/release.mjs`（CI 同门槛 + 版本号 + tag 一条命令）与 `docs/DISTRIBUTION.md` §4 节奏；每次真改动都发 patch，不再攒大版本 | `scripts/release.mjs`；`git tag -l` | 机制完成，按节奏增长 |
| 4 | 真机验过的宿主 | **4 个版本**：0.2.0-rc.1、0.2.1-rc.5、0.2.2-rc.1、0.2.2-rc.5 | 覆盖 0.2.x 各 rc（含 0.2.2-rc.2/3/4） | 0.2.0 与 0.2.1 已从 npm 装进隔离 home 实测（插件激活、`/summary`、preset 写入、诊断报告）；剩余 rc 用同一套脚本逐个跑 | `docs/COMPATIBILITY.md`；`_research/verify/probe-old-actions.mjs`（开发机） | 主要版本已覆盖 |
| 5 | 产品·工程·文档自评 | **8.8 / 10**（2.3.1） | 9.0+ | 这次补了旧宿主真机、反馈通道、发布自动化；未补：客户端单测、列表虚拟化、官方市场未上线（外部） | `docs/SELF-ASSESSMENT.md` | 持续 |

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
