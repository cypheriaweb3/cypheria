# Agents

> Status: Current implementation

Cypheria supports four first-party Agent kinds—Codex, Claude, Pi, and OpenCode—and registry-backed ACP Agents. The Server owns every process and native protocol. Clients use the common Agent, Thread, Timeline, and integration APIs.

## Identity and compatibility

`@cypheria/protocol` defines stable Agent IDs. `codex`, `claude`, `pi`, and `opencode` are native IDs; generated registry IDs identify ACP Agents. Integrations use the broader compatibility tags `codex`, `claude`, `pi`, `opencode`, and `acp` so one declaration can cover registry Agents.

An Agent descriptor reports source, distribution, installed and available versions, enablement, runtime state, capabilities, compatibility, and diagnostics. Thread identity always uses a Cypheria Thread ID plus an Agent ID; a provider session ID is optional linkage, not the client cache key.

## Registry and installation

The Server loads the pinned ACP registry document, validates it, and exposes refresh and inspection operations. Distribution metadata may select a platform binary, `npx`, or `uvx`; preview releases remain explicit. Platform archives can carry SHA-256 integrity metadata.

Installation and updates are Server operations with durable operation records and progress notifications. The toolchain manager discovers or installs managed Node and Python tooling beneath the Cypheria cache. Clients can list, install, update, uninstall, enable, disable, start, and stop Agents without receiving filesystem or process access.

## Runtime lifecycle

The Agent manager serializes lifecycle transitions, reports health, and separates installed, enabled, and running state. A disabled Agent cannot start. A stopped Agent can still own durable Threads; resuming a Thread starts or reuses the appropriate runtime.

Each runtime implements the common provider adapter used by the Thread manager:

- create, resume, fork, configure, and close a session where supported;
- start, steer, and cancel a turn according to advertised capabilities;
- emit Canonical Timeline rows and normalized interactions;
- retain provider metadata needed for diagnostics or provider UI extensions.

Capabilities are discovered per Agent and Thread. Clients must not expose unsupported prompt content, steering, configuration, or fork actions.

## First-party adapters

### Codex

The Codex adapter owns a Cypheria-managed Codex App Server process and validates messages with generated artifacts in `@cypheria/protocol`. It maps Codex turns, reasoning, plans, commands, file changes, approvals, artifacts, account state, models, and permissions into Cypheria contracts. Codex Apps remain a Codex/OpenAI provider extension.

### Claude

The Claude adapter uses the pinned Claude Agent SDK. The Server owns callback-bearing hooks, permissions, abort control, MCP server objects, session storage, and process factories. Serializable prompts and SDK output are normalized into Thread input, Timeline items, interactions, and provider events.

### Pi

The Pi adapter uses the pinned Pi coding-agent package and its RPC session model. It maps message streaming, tool activity, configuration, session lifecycle, and extension metadata into the common Thread contract. Pi extensions are represented as Pi-ecosystem plugins, not as Cypheria-native plugins.

### OpenCode

The OpenCode adapter uses the pinned OpenCode SDK, supervises its server connection, and maps sessions, messages, parts, permissions, and provider configuration into the same Thread and Timeline model.

### ACP

ACP runtimes use the official ACP SDK and the protocol version declared by the selected Agent. Cypheria normalizes stable v1 and draft v2 calls, notifications, responses, cancellation, and v2 batches inside the Server. ACP connection headers and transport details never become public Cypheria message fields.

## Canonical adaptation

Adapters prefer a common Timeline item whenever semantics match. Agent-specific data belongs in `providerData`; only events without a faithful common representation use a `provider` item. Permissions, questions, and MCP elicitation become common Thread interactions.

The persisted Canonical Timeline is authoritative. Native events may be retained or logged for debugging, but Desktop, Expo, CLI, and AI SDK providers do not rebuild history from a provider process.

## AI SDK providers

`@cypheria/ai-sdk-provider` exports `acp`, `codex`, `claude`, `pi`, and `opencode` subpaths. Each provider depends on `@cypheria/client` rather than an Agent SDK, binds to a persistent Cypheria Thread by default, streams Timeline changes, maps tool and reasoning parts, and cancels the Server turn on abort.

Provider metadata preserves Agent kind, model, native identifiers, and supported extension data. The package is browser-safe: it cannot spawn processes, read files, or access the database.

## Security and failure handling

- Treat Agent output, tool requests, file paths, and integration metadata as untrusted input.
- Keep credentials, callbacks, process handles, and native connection identifiers in the Server.
- Route every approval through the Thread interaction lifecycle.
- Terminate child processes on Server shutdown and surface crash state without losing durable history.
- Validate registry documents, platform selection, archives, checksums, and native messages before use.

Multi-Agent orchestration is not part of the current implementation. Threads currently select one Agent runtime.
