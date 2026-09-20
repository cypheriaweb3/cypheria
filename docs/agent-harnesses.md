# Agent Harnesses

Cypheria supports four first-party Agent harnesses—Codex, Claude, Pi, and OpenCode—and registry-backed ACP Agent harnesses. The Server owns every process and native protocol. Clients use the common Agent, Thread, Timeline, and integration APIs.

## Identity and compatibility

`@cypheria/protocol` defines stable Agent IDs. `codex`, `claude`, `pi`, and `opencode` are native IDs; generated registry IDs identify ACP Agents. Integrations use the broader compatibility tags `codex`, `claude`, `pi`, `opencode`, and `acp` so one declaration can cover registry Agents.

An Agent descriptor reports source, distribution, installed and available versions, enablement, runtime state, capabilities, compatibility, and diagnostics. Thread identity always uses a Cypheria Thread ID plus an Agent ID; a harness session ID is optional linkage, not the client cache key.

## Registry and installation

The Server loads the pinned ACP registry document as the available ACP catalog, validates it, and exposes refresh and inspection operations. Native harnesses do not obtain releases from that registry: each Cypheria release declares one tested CLI package and exact version for Codex, Claude, Pi, and OpenCode. The persisted `agent_registry` is intentionally not a copy of the ACP catalog: it begins with the four native harnesses and gains a registry Agent only after the user adds it. Each persisted row records `createdAt`. ACP distribution metadata may select a platform binary, `npx`, or `uvx`; preview releases remain explicit. Platform archives can carry SHA-256 integrity metadata.

Adding, installing, and removing a registry record are separate operations. Adding persists the selected Agent and makes its settings page available; installation and updates are Server operations with operation records and progress notifications. A successful install also enables the Agent. Uninstall removes only the managed runtime, keeps the registry record, and always disables the Agent; removing that uninstalled record is a separate action. Native harness versions are part of the Cypheria release, so their settings pages do not offer a separate update action. Registry harness updates are offered only when both versions are valid semantic versions and the registry version is newer. Operations for different Agents may run concurrently, while operations for the same Agent remain serialized. The toolchain manager discovers or installs managed Node and Python tooling beneath the Cypheria cache. Clients can list, add, remove, install, update, uninstall, enable, disable, start, and stop Agents without receiving filesystem or process access.

## Catalogs and defaults

The public harness catalog normalizes models, providers, authentication methods, and configurable new-session defaults without exposing a native Agent protocol. `HarnessCatalogManager` keeps one in-memory snapshot per Agent and configuration generation. Catalogs load lazily, concurrent reads share one discovery, and ordinary rendering or navigation does not start another runtime. Explicit refresh, installation changes, authentication changes, registry changes, or a catalog-affecting setting invalidate the snapshot. A failed refresh retains the previous snapshot and marks it stale.

Settings are described as typed `select`, `boolean`, or `number` definitions grouped into stable sections. The Server validates every update against the latest definitions. Non-secret defaults are persisted under the Agent ID and are applied to new sessions; credentials remain in harness-owned credential stores and never enter configuration, protocol responses, or logs. Expired saved values remain visible as invalid until the user replaces them.

## Runtime lifecycle

The Agent manager serializes lifecycle transitions per Agent, reports health, and separates installed, enabled, and running state. Uninstalled Agents are always disabled, and enablement can change only while an Agent is installed. A disabled Agent cannot start. A stopped Agent can still own durable Threads; resuming a Thread starts or reuses the appropriate runtime. Before updating a running harness, the Server prevents new turns, waits for active turns to finish, suspends its sessions, stops the old runtime, activates the new version, and resumes the sessions. Install subprocesses are terminated during Server shutdown, and startup removes interrupted staging directories, temporary downloads, atomic-write remnants, and incomplete version activations.

Each runtime implements the common harness adapter used by the Thread manager:

- create, resume, fork, configure, and close a session where supported;
- start, steer, and cancel a turn according to advertised capabilities;
- emit Canonical Timeline rows and normalized interactions;
- retain harness metadata needed for diagnostics or harness UI extensions.

Capabilities are discovered per Agent and Thread. Clients must not expose unsupported prompt content, steering, configuration, or fork actions.

## First-party harnesses

### Codex

The Codex harness owns a Cypheria-managed Codex App Server process and validates messages with generated artifacts in `@cypheria/protocol`. It maps Codex turns, reasoning, plans, commands, file changes, approvals, artifacts, account state, models, and permissions into Cypheria contracts. API key, ChatGPT browser, and ChatGPT device-code authentication are available through the common harness facade. Codex Apps remain a Codex/OpenAI harness extension.

### Claude

The Claude harness uses the pinned Claude Agent SDK. The Server owns callback-bearing hooks, permissions, abort control, MCP server objects, session storage, process factories, subscription and Console-account authentication, and logout. Serializable prompts and SDK output are normalized into Thread input, Timeline items, interactions, and harness events.

### Pi

The Pi harness uses the pinned Pi coding-agent package and its RPC session model. It discovers provider models and each provider's account, OAuth, device-code, or API-key authentication methods, and maps message streaming, tool activity, configuration, session lifecycle, and extension metadata into the common Thread contract. Pi extensions are represented as Pi-ecosystem plugins, not as Cypheria-native plugins.

### OpenCode

The OpenCode harness supports OpenCode v2 only. Dynamic installation uses the pinned `@opencode/cli` package rather than an ACP registry distribution, and Server integration uses the matching `@opencode/client` v2 API. Cypheria disables OpenCode self-updates, supervises its local service, consumes the v2 event stream, and maps sessions, messages, forms, permissions, models, integrations, and credentials into the common Thread, Timeline, catalog, and authentication contracts. No OpenCode v1 compatibility path is retained.

### ACP

ACP runtimes use the official ACP SDK and the protocol version declared by the selected Agent. Cypheria normalizes stable v1 and draft v2 calls, notifications, responses, cancellation, agent and terminal authentication, and v2 batches inside the Server. Catalog discovery uses a temporary session, reads model and configuration options, deletes the session, and closes the runtime in a `finally` path. ACP connection headers and transport details never become public Cypheria message fields.

## Canonical adaptation

Harnesses prefer a common Timeline item whenever semantics match. Agent-specific data belongs in `harnessData`; only events without a faithful common representation use a `harness` item. Permissions, questions, and MCP elicitation become common Thread interactions.

The persisted Canonical Timeline is authoritative. Native events may be retained or logged for debugging, but Desktop, Expo, CLI, and AI SDK providers do not rebuild history from a harness process.

## AI SDK providers

`@cypheria/ai-sdk-provider` exports `acp`, `codex`, `claude`, `pi`, and `opencode` subpaths. Each provider depends on `@cypheria/client` rather than an Agent SDK, binds to a persistent Cypheria Thread by default, streams Timeline changes, maps tool and reasoning parts, and cancels the Server turn on abort.

Provider metadata preserves Agent kind, model, native identifiers, and supported extension data. The package is browser-safe: it cannot spawn processes, read files, or access the database.

## Security and failure handling

- Treat Agent output, tool requests, file paths, and integration metadata as untrusted input.
- Keep credentials, callbacks, process handles, and native connection identifiers in the Server.
- Route every approval through the Thread interaction lifecycle.
- Terminate child processes on Server shutdown and surface crash state without losing durable history.
- Validate registry documents, platform selection, archives, checksums, and native messages before use.

Multi-Agent orchestration is not implemented. Each Thread selects one Agent runtime.
