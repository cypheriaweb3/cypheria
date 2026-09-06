# `@cypheria/acp-ai-provider`

Bridge ACP-compatible coding agents to Vercel AI SDK 7 as a native `LanguageModelV4`, while retaining ACP's client callbacks, session lifecycle, control methods, and protocol events for ACP-aware applications.

## Upstream provenance

This package was ported from [`mcpc-tech/mcpc/packages/acp-ai-provider`](https://github.com/mcpc-tech/mcpc/tree/ebe30eeeef62dab831b9a9fbace8b7049eef62bf/packages/acp-ai-provider) at commit [`ebe30eeeef62dab831b9a9fbace8b7049eef62bf`](https://github.com/mcpc-tech/mcpc/commit/ebe30eeeef62dab831b9a9fbace8b7049eef62bf) (`v0.3.50`, package version `0.3.7`). The port is based on the copy in the local `mcpc` checkout and retains the upstream MIT notice in [`UPSTREAM_LICENSE`](./UPSTREAM_LICENSE).

Cypheria currently uses `ai@7.0.87`, `@ai-sdk/provider@4.0.9`, `@ai-sdk/provider-utils@5.0.34`, and `@agentclientprotocol/sdk@1.4.0`. The source package targeted AI SDK 6's LanguageModel V3 and an older ACP SDK. This port directly implements AI SDK 7 `LanguageModelV4` and uses the official SDK's app-style API for stable ACP wire protocol v1; it contains no V3 compatibility layer. `1.4.0` is the TypeScript SDK package version, not the ACP wire version.

When syncing upstream, diff from the commit above, port the relevant changes, preserve Cypheria's AI SDK 7 `LanguageModelV4`/ACP v1 adaptations and tests, then update the source commit and package version in this section. Run `pnpm --filter @cypheria/acp-ai-provider check`, `pnpm --filter @cypheria/acp-ai-provider test`, workspace CI, and the workspace build.

## Language-model usage

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
  prompt: "Explain the Agent Client Protocol.",
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

The AI SDK 7 `LanguageModelV4` adapter supports streaming and non-streaming generation, structured JSON instructions, prompt image/audio/embedded-context capability validation, native HTTP(S) resource links, MCP servers, host-side AI SDK tools through `acpTools()`, cancellation, authentication, modes, typed session configuration (including model and thought-level categories), and persistent or existing sessions. ACP text, reasoning, files, sources, tool calls/results, stop reasons, usage updates, and provider metadata are mapped to `LanguageModelV4` output. Set AI SDK's `includeRawChunks` option to receive ACP-only stream updates; `onEvent()` remains available independently.

Tools passed through `acpTools()` must have an `execute` function. An ACP agent executes these tools through the authenticated per-provider MCP proxy. AI SDK client-side tools without `execute` are rejected because an ACP MCP call cannot be safely suspended and resumed as a separate AI SDK step.

AI SDK 7 sampling fields that ACP does not represent are reported through `LanguageModelV4` `warnings`. ACP `usage_update` describes cumulative session context usage rather than per-call token accounting, so it is preserved in `usage.raw` instead of being misreported as input/output tokens.

## ACP callbacks and controls

`handlers` can implement permission requests, text-file reads/writes, terminals, elicitation, ACP-transport MCP, and an additional session-update observer. Capabilities are advertised only for installed handlers. Permission requests are cancelled by default; file, terminal, elicitation, and ACP-MCP access are disabled unless their handlers are supplied.

The provider exposes negotiated data through `getInitializeResponse()` and `getAgentCapabilities()`. Its control surface includes authentication/logout; list, delete, resume, and close session; modes and typed config options; extension request/notification; and, behind `experimental.controls: true`, fork, provider selection, next-edit suggestions, document synchronization, and ACP-transport MCP. Unsupported controls fail before sending a request when the agent did not advertise the required capability.

NES negotiation is configured explicitly. Basic edit suggestions are always supported; opt into additional kinds and preferred position encodings as needed:

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

Document notifications are rejected unless the agent advertised the corresponding NES document event. The selected position encoding is also checked against the offered list.

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

Stable stdio is the default transport. A custom in-memory stream or the ACP SDK's experimental HTTP and WebSocket transports can be supplied instead:

```ts
import { createACPHttpTransport, createACPProvider } from "@cypheria/acp-ai-provider"

const provider = createACPProvider({
  transport: createACPHttpTransport("http://127.0.0.1:8765/acp"),
  session: { cwd: process.cwd(), mcpServers: [] },
})
```

Set `experimental.sessionUpdates: true` only when the connected agent supports the unstable ACP v1 plan/compaction updates. Experimental features are explicit opt-ins and may change independently of stable ACP v1.

## Draft ACP v2

The separate `@cypheria/acp-ai-provider/experimental/v2` entry point exposes the official SDK's complete draft-v2 `ClientContext`, including typed request, notification, and batch APIs. Its handlers cover permission, session updates, elicitation create/complete, and MCP connect/message/disconnect. It requires `protocolV2: true` and intentionally does not claim to be a stable `LanguageModelV4` adapter:

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

## Lifecycle, security, and tests

Each language-model instance owns its own agent connection and state; calls to `provider.languageModel()` return independent instances. Call `provider.cleanup()` when finished, especially with `persistSession: true`. Custom transports are also closed during cleanup. The package is Node.js-only because the stdio path uses child processes and Node streams.

Spawned agents inherit only a small process-launch environment allowlist by default. Pass required secrets explicitly with `env`; use `inheritEnv: true` only for trusted agents, or `inheritEnv: ["NAME", ...]` for an explicit inheritance list. The host-side tool proxy binds to loopback, authenticates every internal request with a per-instance random token, limits message size, negotiates MCP handshake versions through `2025-11-25`, and forwards the operation abort signal. AI SDK does not expose the original step's `messages` or execution `context` at the `LanguageModelV4` provider boundary, so proxied tool execution receives empty values for those two optional fields. Filesystem and terminal handlers must still enforce the application's workspace and policy boundaries. Client callback activity is observable through `client-operation` events for audit logging.

The test suite includes an in-memory end-to-end connection between official ACP v1 agent and client applications using `@agentclientprotocol/sdk@1.4.0`, plus unit coverage for AI SDK 7 `LanguageModelV4` mapping and controls. Real Codex ACP, Gemini ACP, and Claude ACP process interoperability is intentionally deferred and is not required by the package test command.
