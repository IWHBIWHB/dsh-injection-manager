# 参与开发

## 本地跑

```powershell
# 只跑逻辑，不需要 DSH
node --test

# 装到当前 profile（链接安装，改完文件刷新页面即可）
# 在 DSH 里：Plugins → Add plugin → 选这个目录
# 或：dsh plugin add D:/path/to/dsh-injection-manager
```

改宿主机代码（`index.js`、`lib/*`）后需要让插件重新加载：Plugins 里关掉再打开，或重启 DSH。改 `client.js` / `locale/*.json` 刷新页面即可。

## 提交前

```powershell
node --check index.js
node --check client.js
Get-ChildItem lib/*.js | ForEach-Object { node --check $_.FullName }
node --test
npm pack --dry-run   # 确认 locale/docs/icon 都进包
```

## 设计约束（改之前先读）

1. **一份快照**：面板、工具、导出、生效策略都从 `buildSnapshot()` 来；不要在浏览器里重算 token 或策略。
2. **不写 workspace 文件**：任何开关只能是会话作用域注册。
3. **只影响新会话**：策略在 `agent/created`（`startup` / `clear`）应用。
4. **必填上下文不可关**：`working-directory:current`、`subagent:identity`。
5. **段落不能同名 shadow**：agent preset 已占用这些名字，必须走 scoped `system-prompt/assemble`。

更细的时序与通道表见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 发布

版本号写在 `package.json`，CHANGELOG 加一节，然后：

```powershell
git tag v1.3.2
git push origin v1.3.2
```

`.github/workflows/release.yml` 会校验 tag 与版本一致、跑测试、`npm pack --dry-run`，最后用仓库 secret `NPM_TOKEN` 发布到 npm。没有该 secret 时发布会失败，其余步骤照常给出信号。

## 语言

界面词条在 `locale/<code>.json` 的 `client` 段，键集必须与 `locale/en.json` 完全一致；`meta` 段给插件市场展示用。新增语言 = 一个 JSON + 一个 `docs/DETAIL.<code>.md`（一行图片）。
