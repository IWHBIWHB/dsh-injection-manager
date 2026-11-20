# 分发 SOP（标准渠道 · 每次发版做什么）

一句话：**两个源头 + 一个目录**。GitHub 是源码、版本与发布说明的源头；npm 是安装与版本事实的源头；
`awesome-dsh-plugin` 是发现与市场的目录。其余渠道都是这三样的下游缓存，**不需要单独提交**。

## 1. 渠道矩阵

| 层级 | 渠道 | 用户怎么用 | 每次发版要做什么 | 机制（已核实） |
| --- | --- | --- | --- | --- |
| 0 源头 | **GitHub 仓库** | `dsh plugin add github:IWHBIWHB/dsh-injection-manager`；读 README / release notes | 只推代码；tag 触发发布 | 仓库带 `dsh.bundle` + `dsh-plugin` topic |
| 0 源头 | **npm 包** | `dsh plugin add dsh-injection-manager` | CI 自动发布（OIDC trusted publishing + provenance） | 用户版本/下载量的唯一事实源；别人不镜像版本号 |
| 0 源头 | **Git tag + GitHub Release** | 看更新说明、下载 tgz | 推 `vX.Y.Z` tag，release workflow 自动校验并建 Release | `release.yml`：校验 tag=版本 → 测试 → npm publish → gh release |
| 1 目录 | **awesome-dsh-plugin** | dsh-market、目录站、catalog index 都从它读 | **首次收录要一次 PR（已完成）**；之后版本/星/下载/截图/更新说明全自动；只有改**描述/分类/url/name/icon/移除**才提 PR，且只改自己那一行 | 条目在 `data/plugins/<owner>__<repo>.yml`；`probe-npm` 每晚刷最新 npm 版本，`probe-updates` 刷 Release notes + commit tail，`probe-stars/downloads` 每日，`probe-screenshots` 从**你仓库的** `screenshots.json` 每晚抓 |
| 2 下游 | **dsh-market**（DSH 里的可视化市场插件） | 装 `dshmarket` 后在市场里搜/装/更新 | 什么都不用做 | 官方 README：列表来自 awesome registry，安装源限制在 registry 内；实时读 `awesome-dsh-plugin.com/plugins.json` |
| 2 下游 | **catalog index（官方 Discover 可订阅）** | Plugins → Discover → Add index source 填 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` | 什么都不用做 | awesome 生态发布的 `plugins.json`/index.json；官方 DSH 本身不提供索引（`DSH ships no index source`） |
| 3 可选 | 自建 index.json（format 1） | 用户把我们的索引 URL 加进 Discover | 仅在想脱离第三方市场、自己控索引时做：静态托管 + 官方 generator | 官方 `docs/user/guide/plugin-market.md`：index 是 UTF-8 JSON，`format: 1`，≤128MiB，用户手动加 URL |
| 3 可选 | 其他 awesome 列表 | 额外曝光 | 可选 PR，不算标准渠道 | 生态里有多个次级列表，受众小于主目录 |
| 不做 | 自建插件商店、独立站、公众号分发 | — | — | 与 npm + 目录重复，维护成本归我们 |

结论：**「标准分发」= GitHub Release + npm 包 + 主目录条目**。三者都做完，dsh-market、目录站、
官方 Discover（通过 catalog index）都会自动跟上；不存在一个需要单独提交的「官方插件市场」入口
（官方文档明确 `DSH ships no index source`，官方市场在路线图里，落地前以上面三件为准）。

## 2. 每次发版 SOP

### T-3 天：准备

- [ ] 语义版本号：修 bug → patch；新入口/功能 → minor；策略文件/路由契约破坏 → major。
- [ ] `CHANGELOG.md` 写一节（用户能读懂的「改了什么 + 为什么」）。
- [ ] `node --test`、`node scripts/self-audit.mjs --strict`、`node scripts/smoke.mjs` 全绿。
- [ ] UI 变了：连拍 README 截图 → 更新 `screenshots.json`（**1-8 张**、仓库内相对路径、不能 `..`）；
      目录/市场的截图只会从这份清单抓，多一张少一张都会被整份忽略。
- [ ] 入口/API/配置变了：同步 README 八语言、`docs/ARCHITECTURE.md`、`docs/COMPATIBILITY.md`、
      `docs/PERFORMANCE.md`；必要时更新 `engines.dsh` 与 `dsh.compatibility`。
- [ ] 图标变了：`docs/images/icon-180.png`（180×180 光栅，GitHub 托管）并确保 awesome 条目里的
      `icon` URL 指向 **master** 分支（本仓库默认分支是 master，不是 main）。

### T-0：发布（约 15 分钟，CI 为主）

```powershell
cd D:\DSH\dsh-injection-manager
git add <显式文件>
git commit -m "feat: ... (X.Y.Z)"
# 本机 github.com:443 不通时用 Git Data API 推送：node _research/release/push-via-api.mjs
git push origin master
git tag vX.Y.Z
git push origin vX.Y.Z          # 触发 release workflow
```

CI 会：校验 tag 与 `package.json` 版本一致 → 跑测试 → `npm publish --provenance` → 建 GitHub Release。

### T+0 验证（缺一不可）

- [ ] `npm view dsh-injection-manager version` = 新版本；注意 registry 元数据与 tarball 有 1–5 分钟
      传播差，刚发布时 `npm install` 可能 404，属正常。
- [ ] GitHub Release 存在、notes 正确、tgz 附件在；CI 两条 workflow 均 success。
- [ ] 干净 profile 从 npm 安装 → 五入口探针 16/16 → `node --test` 仍绿。
- [ ] 若 UI 变了：把重拍后的截图与 README 推上 master（市场夜间抓，不用 PR）。
- [ ] 若元数据变了：提一个只改自己条目的 awesome PR（见第 3 节）。

### T+1 起：观察与回滚

- 看 issues、npm 周下载、dsh-market 详情页的 trust-check 结果、目录统计（每日刷新）。
- 坏版本：`npm deprecate dsh-injection-manager@X.Y.Z "reason"` 提示用户，随后发 patch；
  **不 unpublish**（除非凭据泄露/恶意代码），GitHub Release 保留并追加说明。
- 安全：tarball 不含凭据；`npm publish` 走仓库 OIDC；npm 账号与 GitHub 账号开 2FA
  （GitHub 已提示 2026-12-31 前必须开启）。

## 3. 元数据变更 SOP（不影响发版，但影响市场）

| 改了什么 | 要不要 awesome PR | 多久生效 |
| --- | --- | --- |
| 版本号、下载量、星数、Release 内容、更新说明 | 不要 | 每晚/每日自动 |
| 截图 | 不要（改自己仓库 `screenshots.json` 后推送） | 下一次夜间构建 |
| 描述 / 分类 / 仓库 url / name / icon / 移除条目 | 要，一个只改 `data/plugins/IWHBIWHB__dsh-injection-manager.yml` 的 PR | 合并后下一次构建 |
| 包名或安装方式 | 要（条目里的 npm/发行包字段） | 合并后 |

## 4. 版本与节奏（建议固定）

- **patch**：修 bug/文档也能周一发；**minor**：功能攒 2–4 周一次；**major**：尽量少，提前在 CHANGELOG
  写迁移说明。
- 目录元数据每季度审计一次（描述是否还准、分类是否还贴切、图标/截图是否过期）。
- 每次发版后在 `docs/RSI.md` 记一行（本轮固定动作），发版记录就是下一轮自评的输入。

## 5. 当前状态（2026-11-20）

| 项 | 状态 |
| --- | --- |
| npm | `dsh-injection-manager@2.3.0` 为 latest（provenance 已签） |
| GitHub | tag `v2.3.0` + Release + tgz 附件；CI/release 两条 workflow success |
| 目录条目 | 已在 `data/plugins/IWHBIWHB__dsh-injection-manager.yml`（分类 usage）；描述/图标更新 PR #17255 已开、CI pass、等维护者合并 |
| 截图 | 8 张已重拍（0.2.2-rc.5 隔离实例），`screenshots.json` 合法（1-8 张） |
| 图标 | `docs/images/icon-180.png`（180×180 PNG，raw 200） |
| 待办 | 自建 index.json（可选）、次级学习列表（可选）、官方市场落地后复核 |

## 6. 需要拍板的三件事

1. **要不要自建 index.json**：做了的话用户可以在官方 Discover 里直接加我们的索引；不做就依赖
   dsh-market + catalog index。默认建议：先不做，等官方市场正式发布再评估。
2. **次级 awesome 列表要不要投**：曝光有限，建议不做，除非有人主动收录。
3. **发布节奏**：建议 patch 随时、minor 每 2-4 周；确认后写进本文件第 4 节并当作约定。
