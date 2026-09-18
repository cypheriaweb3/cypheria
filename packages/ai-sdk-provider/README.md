# Cypheria AI SDK Provider

`@cypheria/ai-sdk-provider` exposes AI SDK v4 language models for Codex, Claude, Pi, OpenCode, and ACP agents. Every provider is browser-safe and delegates execution to a connected `@cypheria/client`; it never launches an agent process or reads local agent configuration.

```ts
import { createCodex } from "@cypheria/ai-sdk-provider/codex"

const codex = createCodex({ client })
const model = codex("default")
```

Providers create persistent Cypheria Threads by default. Set `threadMode: "ephemeral"` to delete a newly created Thread after the call finishes, or supply `threadId` to bind a persistent model to an existing Thread. Canonical Timeline notifications are converted to AI SDK text, reasoning, tool, file, custom, error, and finish stream parts; provider provenance remains in `providerMetadata.cypheria`.
