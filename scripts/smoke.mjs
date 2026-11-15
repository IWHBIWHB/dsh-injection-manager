// 冒烟脚本
//
// 不用启动 DSH，用一个只实现所需服务的假上下文跑完整快照流水线，然后打印
// 文本报告。用来确认「装之前代码是活的」以及离线排查聚合/预算逻辑。
//
//   npm run smoke
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'injection-smoke-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const { buildSnapshot } = await import('../lib/snapshot.js')
const { renderText } = await import('../lib/text.js')

const ctx = {
  workingDirectory: { ensure: async () => process.cwd(), defaultDirectory: process.cwd() },
  systemPrompt: {
    assemble: async () => ({
      sections: [
        { name: 'harness:identity', order: -1000, text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: 'tools:sdk', order: 5000, text: 'x'.repeat(800) },
      ],
      contexts: [{ name: 'working-directory:current', order: 100, text: `cwd ${process.cwd()}`, required: true }],
    }),
  },
  skills: {
    snapshot: async () => ({
      complete: true,
      skills: [
        { name: 'dsh-doc', description: 'Harness documentation', invocation: { modelInvocable: true, userInvocable: true }, provider: 'preset', source: 'runtime' },
      ],
    }),
  },
  tools: {
    schemas: () => [
      { name: 'mcp__demo__lookup', description: 'demo tool', parameters: { type: 'object' } },
      { name: 'read', description: 'read a file', parameters: { type: 'object' } },
    ],
  },
  get: () => undefined,
}

const snapshot = await buildSnapshot(ctx, undefined, 'smoke', undefined)
const text = renderText(snapshot)
console.log(text.split('\n').slice(0, 24).join('\n'))
console.log(`\n…（完整报告 ${text.split('\n').length} 行，快照 ${snapshot.items.length} 条 / ${snapshot.groups.length} 组）`)
await rm(home, { recursive: true, force: true })
