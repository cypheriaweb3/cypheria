# `@cypheria/ai-sdk-provider`

> Status: Current implementation

Browser-safe AI SDK language-model providers backed by Cypheria Threads and `@cypheria/client`.

## Public entry points

```ts
import { createCodex } from "@cypheria/ai-sdk-provider/codex"
import { createClaude } from "@cypheria/ai-sdk-provider/claude"
import { createPi } from "@cypheria/ai-sdk-provider/pi"
import { createOpenCode } from "@cypheria/ai-sdk-provider/opencode"
import { createAcp } from "@cypheria/ai-sdk-provider/acp"

const model = createCodex({ client })("default")
```

Each provider binds to a persistent Cypheria Thread by default. Supply `threadId` to reuse one, or select ephemeral mode to delete a newly created Thread after the call.

## Behavior

Providers convert Canonical Timeline updates into AI SDK text, reasoning, tool, file, custom, error, and finish stream parts. Abort cancels the corresponding Server turn. Cypheria provider metadata preserves Agent, model, native identifiers, Thread identity, and supported extension data.

The persisted Server Timeline remains authoritative history. Streams are a live consumption mechanism, not a second store.

## Dependency boundary

The package depends only on `@cypheria/client`, `@cypheria/protocol`, and public AI SDK types. It cannot launch Agent processes, read provider files, open the database, or import Server internals.

See [Agents](../../docs/agents.md) and [Protocol](../../docs/protocol.md).
