# 反馈与问题报告

这个文件写给「用着不对，但不知道从哪说起」的人。目标：一次报告就能定位，不用来回问三轮。

## 最快路径（面板可用时）

1. 打开面板 → **设置** → 最下面的 **反馈** 一行。
2. **复制诊断**：把一份脱敏报告放进剪贴板；剪贴板被浏览器拦住时，同一位置会展开一个可选中的
   文本框，手动复制即可。
3. **报告问题**：直接打开 GitHub 的 bug 模板，诊断已经预填进正文；补上复现步骤就能提交。

诊断里有什么：插件版本、宿主版本与是否达到完整体验门槛、客户端槽位注册结果、过滤器调用次数、
最近一次策略应用的计数（各通道 on/total、预估 token）。**没有**路径、会话 id、对话内容、用户名。
它来自 `GET /plugins/dsh-injection-manager/diag?report=1`，生成逻辑在 `lib/diagnostics.js`，可以自己审。

## 面板打不开时

在任意终端收集这两条，连同现象贴进 issue：

```powershell
dsh --version
dsh plugin --profile desktop list | Select-String injection-manager
```

再附上 `$DSH_HOME/logs/` 里最新一个 `startup-*.log` 的**末尾 30 行**（里面可能有本机路径，介意就只贴
错误行）。如果插件在 Plugins 页显示「未激活」，`startup` 日志里的 `pending (waiting for service: …)`
那一行就是关键信息。

## 什么算「有用的一条反馈」

- **数字不对**：截图 + 你预期的数与实际数；是「新会话首轮」还是「本会话」，两者不要混。
- **开关不生效**：哪个套件/哪一行、开关前后、会话是策略保存前还是之后创建的（策略只影响之后新建的会话）。
- **看不到入口**：宿主版本、面板/会话页/右侧栏/设置行分别有没有；`/diag` 里 `clientRegistrations`
  的 8 个槽位结果会直接告诉我们少哪个。
- **旧宿主**：0.2.0/0.2.1 上的已知降级见 [COMPATIBILITY.md](COMPATIBILITY.md)，先对一下表。

## 我们的处理约定

- 收到 issue 先复现；复现不了会问最小环境，不猜着改。
- 修好的问题写进 [CHANGELOG](../CHANGELOG.md)，并在 issue 里回链接。
- 安全/隐私相关不走公开 issue，见 [SECURITY.md](../SECURITY.md)。
