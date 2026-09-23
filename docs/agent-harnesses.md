---
title: Agent Harnesses
---

# Agent Harnesses

Cypheria supports four first-party Agent harnesses—Codex, Claude, Pi, and OpenCode—and registry-backed ACP Agent harnesses. The Server owns every process and native protocol. Clients use the common Agent, Thread, Timeline, and integration APIs.

## Identity and compatibility

`@cypheria/protocol` reserves `codex`, `claude`, `pi`, and `opencode` as native IDs. ACP registry IDs are generated from the reviewed stable registry snapshot committed with each Cypheria release and form a runtime allowlist; a newly published upstream entry is unavailable until Cypheria updates that snapshot. Integrations use the broader compatibility tags `codex`, `claude`, `pi`, `opencode`, and `acp` so one declaration can cover registry Agents.

An Agent descriptor reports source, distribution, installed and available versions, enablement, runtime state, capabilities, compatibility, and diagnostics. Thread identity always uses a Cypheria Thread ID plus an Agent ID; a harness session ID is optional linkage, not the client cache key.

## Registry and installation

The committed, schema-validated stable ACP `registry.json` is the available ACP catalog. Runtime processes never download or merge registry data. Updating it is an explicit maintainer generation step followed by review, and the generated ID allowlist must match the snapshot. Cypheria does not accept source manifests containing `preview` data or consume the preview registry. Native harnesses do not obtain releases from the stable registry: each Cypheria release declares one tested CLI package and exact version for Codex, Claude, Pi, and OpenCode. The persisted `agent_registry` is intentionally not a copy of the ACP catalog: it begins with the four native harnesses and gains a registry Agent only after the user adds it. Each persisted row records `createdAt`. ACP distribution metadata may provide platform binaries, `npx`, and `uvx`; selection is deterministic in that order for the current platform. Platform archives can carry SHA-256 integrity metadata.

Adding, installing, and removing a registry record are separate operations. Adding persists the selected Agent and makes its settings page available; installation and updates are Server operations with operation records and progress notifications. Binary archives are streamed to disk and extracted with byte-based progress instead of being buffered in memory; ZIP, gzip tar, and bzip2 tar distributions declared by the registry format are supported. Archives reject path traversal, symbolic and hard links, devices, and FIFOs, and the declared command must resolve inside the extracted root. A successful install also enables the Agent. Uninstall removes only the managed runtime, keeps the registry record, and always disables the Agent; removing that uninstalled record is a separate action. Agent updates are accepted only when the exact native manifest or committed ACP snapshot contains a newer valid semantic version than the installed version. Operations for different Agents may run concurrently, while operations for the same Agent remain serialized. The toolchain manager installs repository-pinned Node.js, Python, and uv releases beneath the Cypheria home and compares installed versions with that manifest without resolving latest releases at runtime. Node.js and uv archives must match the repository-pinned SHA-256 for the current platform. Registry packages follow FORMAT.md semantics: npm itself performs `npx` executable selection, while uv materializes the same isolated tool and command selected by `uvx`. Per-install uv tool and command directories override the shared toolchain defaults so the activated receipt remains self-contained. The selected distribution kind and source are reported with installed Agent state. Only confirmed upstream release defects use the explicit, exact-version compatibility manifest; normal entries have no override. Clients can list, add, remove, install, update, uninstall, enable, disable, start, and stop Agents without receiving filesystem or process access.

## Catalogs and defaults

The public harness catalog normalizes models, providers, authentication methods, and configurable new-session defaults without exposing a native Agent protocol. `HarnessCatalogManager` keeps one in-memory snapshot per Agent and configuration generation. Catalogs load lazily, concurrent reads share one discovery, and ordinary rendering or navigation does not start another runtime. Explicit refresh, installation changes, authentication changes, registry changes, or a catalog-affecting setting invalidate the snapshot. A failed refresh retains the previous snapshot and marks it stale.

Settings are described as typed `select`, `boolean`, or `number` definitions grouped into stable sections. The Server validates every update against the latest definitions. Non-secret defaults are persisted under the Agent ID and are applied to new sessions; credentials remain in harness-owned credential stores and never enter configuration, protocol responses, or logs. Expired saved values remain visible as invalid until the user replaces them.

Authentication is modeled as providers containing mutually exclusive methods rather than as a flat method list. Codex, Claude, and ACP Agents expose one logical provider; Pi and OpenCode expose multiple providers and allow one active connection per provider. OpenCode method forms are normalized into typed conditional fields and validated against the latest discovered definitions. A provider with an active or in-progress connection cannot start another method until that connection is disconnected or the flow is cancelled. Login, interactive responses, polling, cancellation, targeted logout, and connection tests run in the Server; the Desktop labels the corresponding user actions Configure and Disconnect. Browser, device-code, command, and terminal flows retain cancellable resources owned by the requesting client session. Closing that session or stopping the Server aborts the flow and releases its process, terminal, and reservation. Connection tests use the least invasive adapter-specific authenticated operation: refreshed account discovery for Codex and Claude, a minimal provider request for Pi and OpenCode, and an ACP handshake plus temporary session probe for registry Agents. Pi and OpenCode API-key configuration performs that provider request before accepting the credential and removes the credential again if validation fails.

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

ACP runtimes use the official ACP SDK and keep stable v1 and v2 protocol surfaces separate inside the Server. Every connection starts with a v2 `initialize` request containing v2 `info` and `capabilities`. The Agent returns v2 when supported or v1 when that is its latest version; Cypheria then uses exactly that negotiated version for the rest of the connection and disconnects on any unsupported version. It never reinitializes or mixes v1 and v2 messages on one connection. Initialize and discovery requests allow a bounded cold-start window for Agents that prepare local state before replying. Google Antigravity 1.1.1 reports version 2 while returning the otherwise valid v1 initialize shape; Cypheria recognizes only this exact hybrid, closes the invalid connection, and starts a fresh connection that explicitly negotiates v1. Authentication discovery is initialization-only: the Server records advertised methods and logout support without creating a session. Protocol-driven authentication uses v2 `auth/login` and `auth/logout`, or v1 `authenticate` and capability-gated `logout`; terminal authentication runs the advertised interactive invocation and reconnects lazily through a newly initialized runtime. Catalog discovery is a separate operation that creates a temporary session and reads model and configuration options. An ACP authentication-required error becomes the normal `authentication-required` catalog state rather than a failed refresh. The Server calls `session/delete` only when the negotiated surface advertises it and always closes the temporary runtime in a `finally` path.

Formal Thread sessions follow the negotiated lifecycle as well. On v2, the presence of `capabilities.session` enables the baseline session methods, resume uses `session/resume`, prompt acceptance is not treated as completion, and the turn finishes only on an idle `state_update`. On v1, Cypheria continues to use the v1 capability layout, `session/load`, prompt response semantics, and mode methods. V2 mode/model defaults are applied through typed configuration options. ACP connection headers and transport details never become public Cypheria message fields.

## Canonical adaptation

Harnesses prefer a common Timeline item whenever semantics match. Agent-specific data belongs in `harnessData`; only events without a faithful common representation use a `harness` item. Permissions, questions, and MCP elicitation become common Thread interactions.

The persisted Canonical Timeline is authoritative. A submitted user row is keyed publicly by `clientMessageId`; when an Agent echoes that message, the adapter reconciles the echo into the existing row and durably enriches its internal `agentMessageId` instead of appending a duplicate. Native events may be retained or logged for debugging, but Desktop, Expo, CLI, and AI SDK providers do not rebuild history from a harness process.

## Client conversation consumers

Conversation clients use `@cypheria/client` directly. Desktop's common controller owns pagination, subscriptions, epoch and gap recovery, send, steer, queue, cancel, and interaction responses without converting the data into a second message format. The Codex controller surface additionally reads goal, native queue, usage, permissions, model settings, review, and background-terminal state through `client.harnesses.codex`. Other Agents use the common Thread surface until they receive a dedicated workspace.

## Security and failure handling

- Treat Agent output, tool requests, file paths, and integration metadata as untrusted input.
- Keep credentials, callbacks, process handles, and native connection identifiers in the Server.
- Route every approval through the Thread interaction lifecycle.
- Terminate child processes on Server shutdown and surface crash state without losing durable history.
- Validate registry documents, platform selection, archives, checksums, and native messages before use.

Multi-Agent orchestration is not implemented. Each Thread selects one Agent runtime.
