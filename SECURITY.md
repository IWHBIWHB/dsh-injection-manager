# 安全

## 报告问题

发现安全问题时，请不要开公开 issue。用 GitHub 的 Security 页面（Security → Report a vulnerability）提交，或在仓库 issue 里先只写「需要私下沟通」，我会回一个私密渠道。请在报告里写：DSH 版本、插件版本、复现步骤、影响面（读取？写入？跨站？）。

## 设计上的边界

这个插件只做三件事：读当前会话的注入构成、把策略写进 `$DSH_HOME/injection-manager/policy.json`、在新建会话的作用域里登记开关。由此得到几条可验证的边界：

- **不执行外部代码**：没有 `eval`、没有动态 `import` 用户内容、没有子进程。
- **不联网**：插件自身不发任何网络请求；面板只访问同源的 `/plugins/dsh-injection-manager/*`。
- **不写 workspace**：`AGENTS.md`、`SKILL.md` 等项目文件只读；所有开关是 Cordis 作用域注册，随会话释放。
- **写接口**：`POST /action` 要求 JSON content-type、`sec-fetch-site` 不是跨站；若带 `Origin`，必须与 `Host` 一致。响应带 `nosniff` / `DENY` / `no-store`。
- **读路由不碰工作区与策略**：快照 GET（`/summary`、`/export`、`/health`）会在本机刷新 `stats.json` 里的一行测量缓存（`lib/snapshot.js` → `lib/stats.js`），`/trend`、`/stats` 的后台回填也只补这份统计。除此之外，读路由不改工作区文件，也不改策略；事件流只由策略保存、压缩等真实事件写入。
- **策略写入串行化**：所有策略读-改-写（`POST /action`、`/inject` 弹层里的动作）走 `lib/lock.js` 的进程内队列，两个窗口同时关两个套件不会丢一个；临时文件名带计数器与随机后缀，写前把当前文件复制成 `policy.json.bak`（有旧文件时）。`policy.json` 解析失败时先读 `.bak` 恢复（返回 `recovered: true`），连备份都没有才回落到全开并在面板明示错误，不会静默删掉一半提示词。

## 已知的、被接受的风险

- `/diag` 会返回本机策略路径与客户端模块地址；这些是本地调试信息，不是凭据。
- 策略文件本身没有加密；能读到 `$DSH_HOME` 的用户本来就能读会话日志。
- 插件的开关只影响**之后新建**的会话；它不能、也不会改变已发生的请求。

## 发布凭据

发布 npm 包需要凭据，但它**不应该出现在对话、issue 或提交里**。约定：

- 发布走 npm 的 **OIDC trusted publishing**（`.github/workflows/release.yml` 用 GitHub Actions 的 `id-token` 换 npm 凭据），不需要长期 token；仓库 secret `NPM_TOKEN` 存在时用它兜底。
- 如果确实要用 token：选 npm 的 **Granular Access Token**，权限只勾 `Read and write`，包范围只选本包，有效期设短（7 天足够），并勾选绕过 2FA（自动化发布）。
- token 只放在仓库根目录的 `.npmrc`（已在 `.gitignore` 里）或本机环境变量里；维护者不会把文件内容读进对话。
- 不要用账号密码、也不要贴 2FA 恢复码。密码与恢复码能接管整个 npm 账号，发布 token 只影响一个包。
- 如果任何凭据曾经出现在聊天/截图/日志里，视为已泄露：立刻在 npm 后台 revoke 并重新生成，再检查 `npm token list`。

## 支持版本

只有最新发布版本会收到修复。兼容性见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。
