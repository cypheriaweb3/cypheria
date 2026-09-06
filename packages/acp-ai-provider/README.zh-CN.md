# `@cypheria/acp-ai-provider`

把兼容 ACP 的编码代理以原生 `LanguageModelV4` 桥接到 Vercel AI SDK 7，同时为理解 ACP 的应用保留 ACP client 回调、会话生命周期、控制方法与协议事件。

## 上游来源

本包从 [`mcpc-tech/mcpc/packages/acp-ai-provider`](https://github.com/mcpc-tech/mcpc/tree/ebe30eeeef62dab831b9a9fbace8b7049eef62bf/packages/acp-ai-provider) 的 commit [`ebe30eeeef62dab831b9a9fbace8b7049eef62bf`](https://github.com/mcpc-tech/mcpc/commit/ebe30eeeef62dab831b9a9fbace8b7049eef62bf)（仓库标签 `v0.3.50`，包版本 `0.3.7`）移植。移植基于本地 `mcpc` checkout 中的副本，并在 [`UPSTREAM_LICENSE`](./UPSTREAM_LICENSE) 中保留了上游 MIT 许可声明。

Cypheria 当前使用 `ai@7.0.87`、`@ai-sdk/provider@4.0.9`、`@ai-sdk/provider-utils@5.0.34` 与 `@agentclientprotocol/sdk@1.4.0`。源包面向 AI SDK 6 的 LanguageModel V3 和较旧的 ACP SDK；本次移植直接实现 AI SDK 7 `LanguageModelV4`，并使用官方 SDK 的 app-style API 实现稳定 ACP wire protocol v1，不包含 V3 兼容层。`1.4.0` 是 TypeScript SDK 包版本，并非 ACP wire 版本。

后续同步上游时，请从上述 commit 开始比较差异，移植相关变更，保留 Cypheria 的 AI SDK 7 `LanguageModelV4`/ACP v1 适配和测试，然后更新本节中的来源 commit 与包版本。请运行 `pnpm --filter @cypheria/acp-ai-provider check`、`pnpm --filter @cypheria/acp-ai-provider test`、workspace CI 和 workspace build。

## Language model 用法

```ts
import { acpTools, createACPProvider } from "@cypheria/acp-ai-provider"
import { generateText, tool } from "ai"
import { z } from "zod"

const provider = createACPProvider({
  command: "gemini",
  args: ["--experimental-acp"],
  session: { cwd: process.cwd(), mcpServers: [] },
  handlers: {
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  },
})

const result = await generateText({
  model: provider.languageModel(),
  prompt: "解释 Agent Client Protocol。",
  tools: acpTools({
    lookup: tool({
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query }),
    }),
  }),
})

console.log(result.text)
provider.cleanup()
```

AI SDK 7 `LanguageModelV4` adapter 支持流式与非流式生成、结构化 JSON 指令、prompt 图片/音频/嵌入上下文能力校验、原生 HTTP(S) resource link、MCP servers、通过 `acpTools()` 注册宿主侧 AI SDK tools、取消、认证、mode、typed session configuration（包括 model 与 thought-level category），以及持久化或恢复既有 session。ACP 的文本、推理、文件、来源、工具调用/结果、停止原因、usage update 与 provider metadata 会映射为 `LanguageModelV4` 输出。设置 AI SDK 的 `includeRawChunks` 选项可接收 ACP 专属 stream update；`onEvent()` 则始终可以独立使用。

通过 `acpTools()` 传入的工具必须定义 `execute`。ACP agent 会通过每个 provider 各自的、带认证的 MCP proxy 执行这些工具。由于 ACP MCP 调用无法安全地挂起并作为独立 AI SDK step 恢复，因此不带 `execute` 的 AI SDK client-side tool 会被明确拒绝。

ACP 无法表达的 AI SDK 7 sampling 参数会通过 `LanguageModelV4` 的 `warnings` 报告。ACP `usage_update` 描述的是累计 session context 使用量而非单次调用的 token 计量，因此保存在 `usage.raw` 中，不会被错误填入 input/output token。

## ACP 回调与控制面

`handlers` 可实现权限请求、文本文件读写、terminal、elicitation、ACP transport MCP，以及额外的 session-update observer。只有已安装 handler 的能力才会在初始化时声明。默认取消权限请求；未提供对应 handler 时，文件、terminal、elicitation 与 ACP-MCP 均保持禁用。

provider 通过 `getInitializeResponse()` 与 `getAgentCapabilities()` 暴露协商结果。控制面包含认证/logout；session list、delete、resume、close；mode 与 typed config option；extension request/notification；在 `experimental.controls: true` 下还包含 fork、provider selection、next-edit suggestion、document synchronization 与 ACP transport MCP。当 agent 未声明所需能力时，不支持的控制会在发送请求前失败。

NES 能力需要显式协商。基础 edit suggestion 始终支持；额外的 suggestion kind 与首选 position encoding 可按需启用：

```ts
experimental: {
  controls: true,
  nes: {
    jump: true,
    rename: true,
    searchAndReplace: true,
    positionEncodings: ["utf-16", "utf-8"],
  },
}
```

如果 agent 没有声明相应的 NES document event，document notification 会在发送前被拒绝；agent 选择的 position encoding 也必须位于此前提供的列表中。

```ts
const unsubscribe = provider.onEvent((event) => {
  if (event.type === "session-update") console.log(event.value.update)
})

await provider.connect()
console.log(provider.getAgentCapabilities())
const sessions = await provider.listSessions()

unsubscribe()
provider.cleanup()
```

默认使用稳定的 stdio transport，也可以提供自定义内存 stream，或 ACP SDK 的实验性 HTTP/WebSocket transport：

```ts
import { createACPHttpTransport, createACPProvider } from "@cypheria/acp-ai-provider"

const provider = createACPProvider({
  transport: createACPHttpTransport("http://127.0.0.1:8765/acp"),
  session: { cwd: process.cwd(), mcpServers: [] },
})
```

只有在所连接 agent 支持不稳定 ACP v1 plan/compaction update 时才设置 `experimental.sessionUpdates: true`。实验性功能均需显式启用，并可能独立于稳定 ACP v1 发生变化。

## 草案 ACP v2

独立入口 `@cypheria/acp-ai-provider/experimental/v2` 暴露官方 SDK 完整的 draft-v2 `ClientContext`，包括 typed request、notification 与 batch API。其 handlers 覆盖 permission、session update、elicitation create/complete，以及 MCP connect/message/disconnect。它要求 `protocolV2: true`，且不会把草案协议伪装成稳定 `LanguageModelV4` adapter：

```ts
import { createExperimentalACPV2Client } from "@cypheria/acp-ai-provider/experimental/v2"

const client = await createExperimentalACPV2Client({
  protocolV2: true,
  stream,
  initialize,
})

await client.agent.request(/* experimentalV2Methods.agent... */)
client.close()
```

## 生命周期、安全与测试

每个 language-model 实例拥有独立的 agent 连接与状态；每次调用 `provider.languageModel()` 都会返回独立实例。使用完成后应调用 `provider.cleanup()`，尤其是在启用 `persistSession: true` 时。cleanup 也会关闭自定义 transport。由于 stdio 路径依赖子进程和 Node streams，本包仅支持 Node.js 环境。

默认情况下，agent 子进程只继承运行进程所需的一小组环境变量。所需 secret 应通过 `env` 明确传入；只应对可信 agent 使用 `inheritEnv: true`，也可以通过 `inheritEnv: ["NAME", ...]` 指定继承列表。宿主侧 tool proxy 只监听 loopback，使用每实例随机 token 验证所有内部请求，限制消息大小，协商至 `2025-11-25` 的 MCP handshake 版本，并转发本次操作的 abort signal。AI SDK 不会在 `LanguageModelV4` provider 边界暴露原 step 的 `messages` 与 execution `context`，因此 proxy 工具执行时这两个可选字段为空。文件系统与 terminal handler 仍必须自行执行应用的 workspace 和 policy 边界。所有 client callback 活动均可通过 `client-operation` event 观测并写入审计日志。

测试套件包含使用 SDK 1.4.0 的官方 ACP v1 agent/client app 之间的内存端到端连接，以及 AI SDK 7 `LanguageModelV4` 映射和控制面的单元测试。真实 Codex ACP、Gemini ACP 与 Claude ACP 进程的互操作测试明确延后，不属于本包测试命令的前置条件。
