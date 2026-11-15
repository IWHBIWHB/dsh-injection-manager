# 安全

## 报告问题

发现安全问题时，请不要开公开 issue。用 GitHub 的 Security 页面（Security → Report a vulnerability）提交，或在仓库 issue 里先只写「需要私下沟通」，我会回一个私密渠道。请在报告里写：DSH 版本、插件版本、复现步骤、影响面（读取？写入？跨站？）。

## 设计上的边界

这个插件只做三件事：读当前会话的注入构成、把策略写进 `$DSH_HOME/injection-manager/policy.json`、在新建会话的作用域里登记开关。由此得到几条可验证的边界：

- **不执行外部代码**：没有 `eval`、没有动态 `import` 用户内容、没有子进程。
- **不联网**：插件自身不发任何网络请求；面板只访问同源的 `/plugins/dsh-injection-manager/*`。
- **不写 workspace**：`AGENTS.md`、`SKILL.md` 等项目文件只读；所有开关是 Cordis 作用域注册，随会话释放。
- **写接口**：`POST /action` 要求 JSON content-type、`sec-fetch-site` 不是跨站；若带 `Origin`，必须与 `Host` 一致。响应带 `nosniff` / `DENY` / `no-store`。
- **GET 无副作用**：`/summary`、`/verify`、`/export`、`/diag` 只读。
- **策略原子写**：同目录临时文件 + rename；解析失败回退到「全开」并在面板明示错误，不会静默删掉一半提示词。

## 已知的、被接受的风险

- `/diag` 会返回本机策略路径与客户端模块地址；这些是本地调试信息，不是凭据。
- 策略文件本身没有加密；能读到 `$DSH_HOME` 的用户本来就能读会话日志。
- 插件的开关只影响**之后新建**的会话；它不能、也不会改变已发生的请求。

## 支持版本

只有最新发布版本会收到修复。兼容性见 [COMPATIBILITY.md](COMPATIBILITY.md)。
