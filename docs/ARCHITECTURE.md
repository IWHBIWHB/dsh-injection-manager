# 架构

这份文档只讲一件事：一次新会话的首轮上下文，从策略文件到模型请求，中间经过哪些环节、每一环用什么接口、失败时会怎样。

## 四条注入通道

首轮上下文不是一整块，而是四条互不相同的通道。插件对它们的控制能力也不同，这是整个设计的前提。

| 通道 | 载体 | 产生者 | 本插件的控制方式 |
| --- | --- | --- | --- |
| A. 系统提示词段落 | `system` 角色文本 | `ctx.systemPrompt.section()` | 会话作用域的 `system-prompt/assemble` 过滤器按名字移除/替换 |
| B. 运行时上下文 | 独立 `user` 快照 | `ctx.systemPrompt.context()` | 同一个过滤器；`required: true` 的不动 |
| C. pre-step 用户消息 | 插在 claimed 批次后的 `user` 消息 | 各插件（`dsh-agent-instructions`、`dsh-tool-skill`、`dsh-time-context`） | 只能间接：技能逐条 shadow；工作区规则只读展示 |
| D. 工具 schema | 请求的 `tools` 字段 | `ctx.tools.register()` | `ctx.tools.restrict({ deny })`，只影响该会话 |

没有任何一条通道通过「改文件」实现。旧版曾重命名 `AGENTS.md`、改 `SKILL.md` frontmatter，那会在多会话、多工作目录下改错对象，已废弃。

## 快照流水线

面板、模型工具、导出文件、应用策略，全部来自同一次 `buildSnapshot()`：

```
policy.json ──┐
Config ───────┤
              ├─▶ collectSections/Contexts (assemble)
工作目录 ─────┤   collectSkills (snapshot)
              │   collectTools (schemas)
              │   collectInstructions (固定路径探测)
              ▼
         assignGroups()  → 按套件聚类
              ▼
         previewPolicy() → 关掉后剩多少 / 省多少
         planBudget()    → 目标预算下的关闭建议
              ▼
   { items, groups, channels, totals, policy, undo }
              ▼
   panel · context_injection 工具 · /export · applyPolicyForAgent
```

关键不变量：**只有一份实现**。浏览器不重算 token、不重算预览；它拿到什么就画什么。这也让「预览数字」和「实际生效」不会打架。

## 生效时序

```
agent/created (source=startup|clear)
  └─ buildSnapshot()                     ← 读策略、量一遍当前会话
  └─ applySnapshotPolicy()
       ├─ agent.ctx.on('system-prompt/assemble', rewrite)   ← A/B 通道
       └─ agent.ctx.inject(['tools','skills'], scoped => {
              scoped.skills.register(shadow)                ← C 通道（技能）
              scoped.tools.restrict({ deny })               ← D 通道
          })
```

三个时序事实决定了实现方式：

1. `assemble()` 在 `agent/pre-step` **之前**执行，所以 per-session 注册必须发生在 `agent/created`，不能等 pre-step。
2. 段落与上下文不能用「同名空文本再注册一次」的办法关掉：agent preset 已经在**同一作用域**注册了这些名字，再注册会抛 `already registered in this scope`。公开的改写点是 scoped `system-prompt/assemble` 瀑布。
3. `tools.restrict()` 只能在作用域上下文里调用；名单必须来自该会话真实的 `schemas(agent)`，否则未知名字会抛错。

`resume` / `compact` 不处理：它们带着已有历史，中途改写不是「默认策略」该做的事。

## 数据

| 位置 | 内容 | 谁写 |
| --- | --- | --- |
| `$DSH_HOME/injection-manager/policy.json` | 通道模式、名单、前言后记、预算 | 面板动作（原子写） |
| `$DSH_HOME/injection-manager/` 的旧目录 | `context-injection/`、`context-preflight/` | 只在首次读取时迁移 |
| 插件行 `config` | dock / refreshOnFocus / showRawNames / budgetTokens | Plugins → Configuration |
| 内存 | 撤销栈（20 步）、最近一次应用结果、客户端 boot 报告 | 进程内，重启清空 |

不上传、不联网、不写 workspace 文件。

## 包结构

```
index.js            插件入口：Config、工具、/inject、路由、agent/created
lib/snapshot.js     快照与策略预览/预算
lib/apply.js        四通道生效 + 撤销之外的注册
lib/group.js        套件聚类
lib/policy.js       策略 schema、原子读写、旧目录迁移
lib/routes.js       HTTP 面（面板、导出、诊断、校验）
lib/history.js      撤销栈
lib/settings.js     Config 归一化
lib/text.js         模型卡片与文本报告
lib/instructions.js 工作区规则只读探测
client.js           浏览器半包：侧栏图标、主页面、输入框徽标
locale/*.json       八语言字典（宿主展示用 meta + 客户端词条）
```

## 测试

| 文件 | 覆盖 |
| --- | --- |
| `test/policy.test.mjs` | 模式语义、必填锁定、预算贪心、计划回写 |
| `test/group.test.mjs` | MCP/前缀/provider 聚类、汇总 |
| `test/settings.test.mjs` | 配置归一化与默认值 |
| `test/text.test.mjs` | 工具卡片与文本报告的数字/告警 |
| `test/apply.test.mjs` | 假 ctx 下四条通道端到端、幂等、resume 跳过 |
| `test/routes.test.mjs` | 动作/撤销/导出/同源校验（假 req/res） |
