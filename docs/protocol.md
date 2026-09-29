---
title: Client/Server Protocol
---

# Client/Server Protocol

`@cypheria/protocol` is the source of truth for the public Cypheria client/server contract. It exports strict TypeScript types, compiled Zod validators, serializers, capability constants, and generated upstream artifacts used inside Server adapters.

## Scope

The public protocol covers Server operations, Agents, Projects, Threads, Sections, Canonical Timeline, integrations, schedules, terminals, Git, and Web3. Agent-native protocols are not public client APIs. They are validated adapter inputs behind `apps/server`.

Generated Codex App Server files live under `packages/protocol/src/generated/codex/`. Their [generated reference](codex-app-server-api.md) is for adapter development, not direct client use.

## Transport

Clients connect to `/api/v1/ws` with WebSocket subprotocol `cypheria.v1`. Every application frame is a WebSocket binary frame; text frames are rejected. Ordinary protocol messages use deterministic CBOR encoded by `cbor2`. The public CBOR profile permits null, booleans, strings, finite numbers, integers represented as either `number` or `bigint`, byte strings as `Uint8Array`, arrays, and maps with string keys. Optional object properties whose value is `undefined` are omitted before encoding; `undefined` is otherwise rejected and never appears on the wire. The profile also rejects custom tagged types, non-string map keys, duplicate keys, and structures deeper than the protocol limit. Every decoded value is still validated by the direction-specific Zod schema.

High-throughput domains may use raw-binary frames whose first byte is an opcode and whose remaining bytes are owned by that domain codec. Opcodes `0x01–0x0f` are reserved for terminal streams and `0x10–0x1f` for file transfer. Receivers check these ranges before CBOR decoding; all other frames enter the ordinary deterministic-CBOR protocol-message path. This is unambiguous because every valid top-level Cypheria protocol message is a CBOR map, whose first byte is in the disjoint map major-type range `0xa0–0xbf`. Raw frames are accepted only after the normal hello handshake, and domain codecs bind their one-byte slot to streams authorized through logical operations. Terminal opcodes are `0x01` output, `0x02` input, `0x03` resize, and `0x04` ANSI restore. Output and input payloads are `[slot, ...UTF-8]`; resize is `[slot, flags, cols:u16be, rows:u16be]` with claim bit `0x01`; restore is `[slot, flags, ...ANSI]` with start bit `0x01` and end bit `0x02`. See [Terminals](terminals.md) for ownership and recovery semantics.

Top-level messages are:

```ts
{ type: "hello", clientId, clientType, protocolVersion, appVersion?, capabilities? }
{ type: "ping" }
{ type: "pong" }
{ type: "session", message: logicalMessage }
```

The first non-ping client message must be `hello`. Supported client kinds are `desktop`, `mobile`, `web`, `cli`, `mcp`, and `hub`. A successful attachment is confirmed by `server.status.notification`; there is no public session identifier or resume token.

The Server rejects incompatible versions, malformed messages, duplicate in-flight request IDs on one source transport, oversized frames, and connections that miss the hello deadline.

## Logical messages

Each logical message has a concrete dotted `type`. Requests carry a `requestId`; correlated responses return the same ID. Domain schemas commonly place arguments in `payload` and represent domain failure as a typed `{ ok: false, error }` result rather than a transport failure. Notifications do not require correlation.

Examples of message families:

```text
server.status.request              -> server.status.response
project.list.request               -> project.list.response
thread.turn.start.request          -> thread.turn.start.response
thread.timeline.appended.notification
schedule.run.request               -> schedule.run.response
web3.signing_intent.create.request -> web3.signing_intent.create.response
```

The exported Zod schemas, not prose examples, are authoritative for exact fields.

Agent management separates the persisted registry from the available harness catalog. `agent.list` returns registered Agents plus currently addable catalog entries, including each entry's installable version; installed Agent views also report the selected distribution kind and source. Registry IDs are constrained by the generated allowlist from the stable ACP snapshot committed with the Cypheria release. `agent.add` persists one catalog entry without installing it. Installation remains an explicit `agent.install` operation, uninstall retains and disables the registry record, and `agent.remove` removes an uninstalled record. Install and update operations report normalized progress from `0` to `1`, are serialized per Agent rather than globally, and preserve active turns during version changes. The Server rejects an update unless the release-pinned catalog version is newer than the installed semantic version.

## Versioning and capabilities

`CYPHERIA_PROTOCOL_VERSION` controls transport compatibility. A client must reject a Server protocol version it cannot safely consume. `server.status.notification` advertises stable capabilities and optional feature flags. Clients gate optional UI on those values rather than assuming that an application version implies a feature.

Unknown feature-flag names are preserved. Additive optional fields are preferred within a protocol version; incompatible shape changes require a new protocol version.

## Projects, Threads, and Sections

Projects group workspace roots and ordered Thread membership. Threads are the durable Agent conversation identity and carry `agentId`, harness session linkage, state, capabilities, pending interactions, recency, archive state, and optional Project or Section placement. Sections order both Projects and standalone Threads.

The protocol provides create, read, list, update, move, membership, fork, rewind, archive, and delete operations. Ordering uses explicit positions and `before...` placement hints. The fixed Pinned Section is represented by a stable protocol constant; clients do not infer Section membership from harness metadata.

Project and Section membership also have normalized list resources. A Project membership carries `threadId`, `projectId`, position, and timestamps; a Section membership carries an item reference, `sectionId`, position, and timestamps. Project, Section, and membership mutations publish typed created, updated, upserted, and deleted notifications. Clients may therefore maintain normalized local collections without N+1 membership reads or polling. A logical delete notification is published after the tombstone is committed and before deferred physical cleanup; reorder operations publish the canonical positions of every affected record.

`projects.roots` is a Project template, while `threads.roots` is the only authoritative workspace state for a Thread; the first Thread root is its current working directory. Creating a Project Thread copies the current Project roots. Later Project edits do not bulk-update members. `thread.workspace.sync` performs either a silent additive sync, when the primary root is unchanged and the Thread roots remain a subset, or an exact user-confirmed sync. An active turn blocks workspace mutation. Moving between Projects updates membership and roots atomically, while moving to projectless creates a managed directory containing `work/` and `outputs/`. Moving a projectless Thread into a Project deletes its old managed directory only when no other projectless Thread references the same complete roots value.

Agent capabilities report whether cwd and roots may change after Thread creation. Codex and Claude apply the latest Thread roots at turn start; Codex receives `runtimeWorkspaceRoots`, while Claude receives its cwd and additional directories. OpenCode and Pi expose only their creation-time working directory and therefore reject later workspace changes. Agent start, resume, and reconnect always initialize from the current Thread roots. Cypheria does not create provider-native Projects or use provider session IDs as workspace identity.

`thread.files.*` lists one directory level at a time, searches names and paths, reads bounded UTF-8 text or a binary stream, and provides versioned writes, same-root moves, quarantine delete, and conflict-safe restore. Every request names a Thread root exactly and uses a root-relative path. `thread.files.changed.notification` invalidates affected directories. `thread.workspace.cleanup.*` only lists and explicitly deletes unreferenced managed projectless directories; cleanup is never automatic discovery of arbitrary disk content.

List endpoints are bounded and cursor-paginated. Mutation responses return the authoritative Server value so clients can reconcile optimistic updates.

Thread Attachments are shared Server resources, not prompt content blocks or client preferences. `thread.attachment.list/add/remove` manages pull-request and managed-worktree relationships, `thread.attachment.owners.list` performs reverse lookup, and upsert/delete notifications keep clients synchronized. Pull-request URLs are normalized by the Server into a stable provider/repository identity. The contract uses Cypheria Thread IDs and is available to every Agent; it does not depend on a harness session ID.

## Canonical Timeline

The append-only Canonical Timeline is the durable conversation history. Each row has a monotonic sequence number, timestamp, optional turn ID, optional harness item ID, and one discriminated item:

- `message` for user and assistant content;
- `reasoning`;
- `tool`;
- `plan`;
- `command`;
- `diff`;
- `approval`;
- `artifact`;
- `status`;
- `error`;
- `harness` for an Agent-specific event with no common representation.

Common items may include `harnessData` for provenance and diagnostics without changing their shared meaning. Harness-only items retain `agentId`, native type, and validated payload so a client can select a harness extension.

A canonical user `message` carries the originating `clientMessageId` when it came from a Thread start or steer request. This is the stable public identity used to reconcile optimistic client state and Agent echoes. The corresponding Agent-native message identity is stored internally as `agentMessageId`; it is not part of public Timeline rows.

User messages may also retain the ordered original `input` blocks. Selected `reference` identities and opaque `uploaded-file` IDs are validated and mapped by the Server before Agent submission; plain text is never reinterpreted as a selected reference. The shared suggestion, chunked upload, retrieval, and queue operations are described in [Composer Inputs and References](composer.md).

Timeline cursors contain an epoch and sequence. The epoch detects replacement or rebuilt history. Reads support `tail`, `before`, and `after`, and can request canonical rows or projected display items. Projection folds later rows for the same item into a stable display item while retaining exact source sequence ranges.

Clients subscribe to append notifications and re-read after a replacement notification, cursor gap, reconnect, or epoch mismatch. The persisted Server Timeline remains authoritative for both history and live projection.

`thread.summary.get` is a read-only, rebuildable projection over the **entire** Canonical Timeline, not the client's loaded page. It returns the current epoch and bounded, count-bearing entries for outputs, sources, subagents, and the latest plan. Entries carry stable item IDs and compact metadata, never full diffs, command output, or binary payloads. Clients invalidate this view after Timeline updates or epoch replacement; it is not a second history store. PR attachments, schedules, terminals, and device-local browser tabs remain separate APIs and are composed only by the client surface.

Message rows carry an explicit operation boundary. `turn-user` is eligible for Rewind and user-message Fork, `steer-user` is eligible for neither, and `assistant-final` is eligible only for Fork. Assistant streaming rows have no boundary; after a turn succeeds, the Server appends a completion replacement for the final assistant message. Failed or cancelled turns never gain an `assistant-final` boundary. The Server resolves every requested cursor against the current epoch and validates the stored item instead of trusting a client-supplied message kind.

`thread.fork` has one of three targets. `thread-head` copies the complete provider session; `user-message` branches immediately before that message and returns its complete input blocks for the new Thread composer; `assistant-message` includes the selected completed assistant message and returns an empty composer. A fork inherits the source Project and ordinary Section, is placed after the source, and records `forkedFromId`, but does not inherit pinned, unread, or archived state. `thread.rewind` accepts only a `user-message` target, preserves the Cypheria Thread ID, replaces its provider-session binding and Timeline epoch, and returns the selected input blocks for the same composer. Neither operation reverts workspace files, accepts arbitrary Timeline items, or approximates an unsupported provider boundary by replaying prompts.

Successful branch responses include the authoritative Thread, the complete replacement Timeline snapshot, and composer input blocks. Provider branching, session binding, and Timeline replacement are covered by a durable lifecycle journal. Startup recovery completes a committed binding or compensates an uncommitted provider branch and never resends a user message.

Archive is local-authoritative: the Server cancels an active turn, closes the runtime, persists `archivedAt`, and then attempts the provider-native archive. A native failure is returned as a warning without undoing local archive. Unarchive performs the native restore first and clears `archivedAt` only after it succeeds. Rename is local-first with best-effort native synchronization. `thread.archive_many` applies the single-Thread operation independently and returns successes, failures, and per-item warnings without stopping at the first failure.

## Turns and interactions

Thread input is an ordered list of text, image, audio, resource-link, embedded-resource, selected-reference, or uploaded-file blocks, restricted by advertised Thread capabilities and Server-side validation. Every start and steer request includes a client-generated `clientMessageId`. Within one Thread, retrying the same ID with identical operation and content returns the original turn without resubmitting to the Agent; reusing it for different content fails with `CLIENT_MESSAGE_ID_CONFLICT`.

Message identity, execution identity, and native identity are separate: `clientMessageId` identifies the submitted user message, `turnId` identifies the Agent execution that may contain start and steer messages, and internal `agentMessageId` identifies the corresponding message in the selected Agent runtime.

The Server persists a pending receipt before calling the Agent and marks it completed only after the canonical user row is durable. If a process or connection is interrupted after the Agent may have accepted the message, a later retry fails with `THREAD_MESSAGE_OUTCOME_UNKNOWN` instead of risking a duplicate submission. Clients must keep the same ID for transport retries, but require explicit user action and a new ID after an unknown outcome. Active turns can be cancelled through the Thread API.

Permission requests, questions, and MCP elicitation are normalized as pending Thread interactions. Responses use discriminated outcomes such as allow, deny, selection, text, answers, elicitation action, or cancellation. Harness metadata preserves native context while the common lifecycle stays uniform.

Context-window usage is transient Thread runtime state, separate from Timeline history and account or billing quotas. `thread.context.usage.get` returns the latest normalized snapshot and `thread.context.usage.updated` publishes changes. Every snapshot includes used, remaining, and maximum tokens, percentage, observation source, optional model and cost, and an Agent-specific discriminated detail. The Server does not persist these snapshots.

## Harness catalogs and settings

The `harness.management` capability exposes a common catalog without changing the `cypheria.v1` transport version. `AgentModelDefinition` describes a model, provider, thinking choices, and validated metadata. `HarnessSettingDefinition` describes a `select`, `boolean`, or `number` value, and `HarnessSettingSection` groups definitions under a stable route ID. `HarnessCatalogSnapshot` carries models, setting sections, load state, generation time, stale state, and any refresh error. Its `authentication-required` status is a successful protocol outcome with no refresh error: the harness must authenticate before session-scoped catalog entries can be discovered. Thread create optionally accepts the complete `config`; `thread.config.update` accepts a partial patch and returns the resulting authoritative Thread. The fields are `model`, `thinking`, `speed`, and `permissionsMode`. New Threads resolve omitted values from the harness and Server defaults, while existing Threads never fall back to newly changed defaults.

The public Cypheria protocol version is independent of an ACP harness connection version. The Server offers ACP v2 in `initialize`, accepts a v1 downgrade from a v1-only Agent, and binds that connection to the negotiated message schemas for its lifetime. Native ACP details—including the version-specific capability layout, authentication method names, prompt completion semantics, and v2 batches—remain behind the Server adapter. Adapter code imports the generated logical schemas, codec registry, and handshake parser from `@cypheria/protocol/acp-adapter`; they are intentionally absent from the package root and the public WebSocket unions. Logical ACP requests keep native method parameters under `payload`, while the adapter alone translates that envelope to JSON-RPC `params`.

The request families are `harness.get`, `harness.auth.start/respond/poll/cancel/logout/test`, `harness.models.list`, and `harness.settings.get/update`. `HarnessView` declares single- or multiple-provider cardinality, nests mutually exclusive methods under each provider, and returns separately addressable connections. Methods can carry typed, conditional form-field definitions; a login request identifies both provider and method and supplies only that method's validated values. Logout and connection tests identify one connection. These backend operations retain login/logout semantics, while the Desktop presents them as Configure and Disconnect. `refresh: true` is the only client-driven catalog refresh signal. Authentication responses contain presentation state such as an external URL or prompt; credentials are request-only secrets and never appear in snapshots. The Server validates setting updates against the current catalog before persistence or native application.

## Errors and reconnects

Transport and protocol violations close the affected connection. Correlated domain operations return stable error codes and human-readable messages. `@cypheria/client` converts connection, capability, protocol, and timeout failures into dedicated error classes.

A logical session is keyed by authenticated principal and `clientId`. Reconnecting within the configured grace period attaches to the retained logical session, but clients must still reconcile current state and Timeline cursors. Logical sessions are not durable across worker restarts.

## Client facade

`@cypheria/client` is the supported application entry point. `createCypheriaClient()` owns one connection; `createCypheriaApi()` borrows an existing internal connection. Current facades are:

```text
client.agents
client.projects
client.threads
client.sections
client.timeline
client.harnesses
client.harnesses.codex
client.harnesses.claude
client.harnesses.pi
client.harnesses.opencode
client.harnesses.acp
client.schedules
client.web3
client.integrations
client.terminals
client.git
client.artifacts
client.browser
client.settings
client.server
```

The common operations on `client.harnesses` cover installation-adjacent state, authentication, models, and typed settings for every Agent. Named child facades expose only genuine harness extensions. Codex Apps, guardian, and lower-level compatibility operations remain under `harnesses.codex`; common integration operations remain available through `integrations`.

`client.terminals` lists, creates, renames, closes, and captures Thread terminals; watches shared Thread directories; and observes authorized binary streams. Authentication flows expose a private terminal ID that can be observed only by the owning logical client session. The complete contract is in [Terminals](terminals.md).

The ownership and backend-selection rules behind this capability are in [Local Git design](git.md).

The `git` capability provides local repository discovery and initialization, origin provider classification without exposing the remote URL, status, branch listing and context (current, upstream, default, ahead/behind), branch creation and checkout, diff, stage, unstage, commit, push, and managed worktree listing, creation, deletion, and restoration through the Server Git executor. Each `git.*.request` returns a correlated typed response with a success value or error. Git operations use the Server host's filesystem and Git installation. Managed worktrees live under `CYPHERIA_HOME/worktrees`; Server records their repository identity and uses `refs/cypheria/worktrees/*` to restore the committed HEAD after deletion. Listings include restorable deleted worktrees. Deletion rejects uncommitted changes and the current worktree.
The commit request accepts optional `includeUnstaged` and validated `coAuthors` fields. Including unstaged changes stages all local changes before the commit; an error after staging leaves the index available for recovery. Git process errors classify authentication, rejection, missing upstream, conflict, timeout, and nothing-to-commit cases.
The authenticated `POST /api/v1/git/request` endpoint accepts the same validated Git request envelope for the bundled MCP tool process.
The Server audits the start and outcome of mutating Git requests under their request ID. Audit records contain the operation type and outcome, without request payloads or repository paths. A mutation does not start when its initial audit write fails.
`git.branch-comparison.request` resolves a base and optional head ref to immutable commits, then returns their merge base, ahead/behind commit counts, and per-file line counts for changes from the merge base to the head. It rejects invalid or missing refs and leaves the working tree untouched.
`git.index-entries.request` returns the exact path's index mode, object ID, and conflict stage. `git.submodule-paths.request` lists stage-zero gitlinks from the index, including uninitialized submodules; neither operation opens submodule worktrees.
`git.text-blob.request` reads a file at a pinned commit as UTF-8 text, returning unavailable for non-blobs, binary data, or content over 1 MiB. `git.blame-file.request` returns bounded line attribution for a repository file without returning its contents. Both reject paths outside the repository.
`git.index-info.request` returns the current worktree index modification time in milliseconds, or zero before an index exists, without exposing the index path. Clients can use it to detect index changes.
`git.worktree-job-start/read/cancel/retry` report a bounded in-memory creation state (`queued`, `creating`, `setting-up`, `ready`, `failed`, or `cancelled`) and setup output. Every managed worktree has a stable UUID used by Thread Attachments; unmanaged worktrees report no ID. Creation can copy staged, unstaged, and untracked changes when the selected start resolves to the source HEAD. A remote start attempts a best-effort upstream refresh when enabled. A selected environment config must be a regular JSON file inside the repository with `version: 1`, a nonempty `name`, and `setup.script` (optionally overridden by `setup.darwin.script` or `setup.linux.script`). Server copies that file into the worktree, stores its worktree-local path in Git config, and runs the script in the new worktree with `CODEX_SOURCE_TREE_PATH` and `CODEX_WORKTREE_PATH`. Setup failure preserves the worktree for retry or explicit skip; creation failure removes the newly allocated worktree.
`git.worktree-move-thread.request` can opt into copying local changes when the source and target HEAD match and the target is clean. `git.synced-branch-state/sync/undo` support guarded synchronization from a detached managed worktree to its selected local branch. Sync can include uncommitted worktree files through a temporary index and synthetic commit without changing the worktree index. It rejects dirty or externally moved branch checkouts, saves the old branch commit under `refs/cypheria/worktree-sync/*`, and updates the checkout and metadata; Undo requires the synchronized branch to remain unchanged. Setup captures only changes to a small allowlist of toolchain environment variables, writing `codex-shell-environment.json` in the worktree Git directory. Server passes the captured values to Codex thread start, resume, and fork through `shell_environment_policy.set` and retains them for restoration.
`git.availability`, `git.remotes`, `git.branch-exists`, and `git.branch-commits` expose bounded local queries; remote identities omit URL credentials. `git.apply-patch` supports staged, unstaged, and combined targets, reverse and binary patches, optional atomic checks, and three-way application with a temporary index for unstaged changes. `git.apply-changes` applies a source tree against a pinned destination HEAD after finding their merge base. Both return applied, skipped, and conflicted paths. `git.clone-state.request` reports shallow and partial clone state. `git.worktree-starting-ref.request` resolves a selected branch or revision to an immutable commit. The config read and write requests are limited to `codex.localEnvironmentConfigPath` in worktree-local Git config; reads return null before worktree config is enabled. `git.apply-review-sections.request` applies up to 100 revision-pinned Review actions in order and returns each action's applied, skipped, stale, conflict, or failed result, so callers can retain successful actions and refresh only failed sections. Server briefly caches repository discovery and invalidates it on Git mutations or filesystem watcher events. It broadcasts `git.repository-changed.notification` so Desktop refreshes Git and PR queries; periodic reads remain a fallback when native watching is unavailable.
GitHub PR availability, listing, detail, creation, title/body editing, and merge use the Server host's `gh` installation and active `gh` account. Availability reports CLI, account, and current repository access separately; PR reads use fixed JSON fields and validate the result before returning it to clients. Creation checks for an existing PR on the head branch and passes the body through a private temporary file. Merge requires the displayed head commit SHA and uses `gh --match-head-commit`.
GitHub App availability is reported per operation: list, account-scoped search, detail, diff, comments and reviews, checks, review threads, media, and creation. Each available group must belong to the repository's selected account link. The Desktop enables only supported App reads; PR mutations other than creation use `gh`. The PR form can create and switch to a new branch, optionally commit local changes with a generated message, push the branch, generate PR title and body using saved instructions, and create through the selected provider. The CLI also offers a cross-repository PR board with state, involvement, text, and repository filters. After an uncertain creation response, it refreshes PR data and asks the user to check GitHub before retrying.
GitLab MR detail, branch lookup, discussions, reviewer and approval status, project member search, reviewer management, pipeline jobs and bridges, creation, title updates, and ordinary comments use the connected GitLab App's `codex_apps` tools for a local Codex thread. `git.gitlab-mr-availability.request` reports each action group separately. Server checks that the thread belongs to the requested repository, its origin is GitLab.com, the project and MR URLs match that origin, and the required tools share one connector account link. Creation requires the current branch to match its pushed `origin` head; the browser-form URL uses the same check and works without a connector call. Server rechecks the tool resource URI after read calls; write calls validate the link before sending and confirm the response without retrying. The Desktop disables unavailable connector actions while retaining the browser form and local branch push path.

## Browser hosts and Agent browser tools

The `browser` capability lets a Desktop session act as a browser host. `client.browser.registerHost()` sends `browser.host.register.request` with the host kind and supported commands, repeats it after each reconnect, and releases it with `browser.host.unregister.request`. Only `desktop` sessions may register; closing the session removes the host.

The Server sends one `browser.automation.command.notification` per command with an automation ID, the command, and the calling Thread ID and working directory. The host answers with `browser.automation.result.request`, whose payload is either a typed result or a typed error. Commands are `list_tabs`, `new_tab`, `close_tab`, `resize`, `snapshot`, `screenshot`, `logs`, `wait`, `click`, `fill`, `type`, `keypress`, `hover`, `select`, `drag`, `upload`, `scroll`, `navigate`, `back`, `forward`, `reload`, and `evaluate`. Errors include `browser_disabled`, `browser_no_host`, `browser_tab_not_found`, `browser_stale_ref`, `browser_timeout`, `browser_denied`, and `browser_unsupported`; handled page dialogs are reported with both.

The Server broker remembers which host owns each tab, aggregates `list_tabs` across hosts, fails pending commands with a retryable `browser_no_host` when a host disconnects, and times commands out after 15 seconds. Agents reach the broker through Codex dynamic tools named `browser_<command>`; tool calls carry the Cypheria Thread, which limits them to that Thread's tabs. Every tab belongs to a Thread, so hosts reject commands that carry none. Browser tools are off until `browserTools.enabled` is set in Server configuration. State-changing commands are audited under the automation ID with the Thread and command name, without arguments; a command does not start when its initial audit write fails.

## Validation rules

- Validate every inbound and outbound boundary with the exported schema for its direction.
- Never hand-write or copy generated Agent protocol types.
- Never expose a harness-native message union as durable client state.
- Keep request IDs unique while in flight on one transport.
- Treat cursors as opaque outside the owning domain.
- Use capability and feature negotiation for optional behavior.
