# Agent Management

Cypheria protocol v2 identifies ACP traffic by a required `agent` field beside `protocolVersion` and `type`. The value is a committed `AgentId`: the native `codex`, `claude`, `pi`, and `opencode` IDs plus a generated static union. The generator downloads the ACP Registry only as transient input and commits only `src/generated/acp/agent-ids.ts`; Registry JSON is not a protocol build artifact. The Registry IDs corresponding to native support (`codex-acp`, `claude-acp`, `pi-acp`, and `opencode`) are excluded. V2 batches require the outer and every inner agent ID to match. The WebSocket subprotocol is `cypheria.v2`.

`@cypheria/client` exposes registry, install, update, uninstall, enable/disable, start/stop, operation, and toolchain APIs through `api.agent.manager`. Install, update, uninstall, and toolchain update are asynchronous operations with progress and terminal notifications. Enabling is deliberately separate from installation: a successful install remains disabled, and disabled agents cannot start or receive business protocol calls.

The server refreshes the ACP Registry at startup and hourly with ETag and Last-Modified validators, a 20-second timeout, a 4 MiB limit, validation aligned with the upstream `agent.schema.json`, and atomic persistence at `$CYPHERIA_HOME/agents/registry.json`. Its validators are stored beside it. Registry entries such as `codex-acp`, `claude-acp`, `pi-acp`, and `opencode` describe ACP wrappers or distributions and are not used as metadata for Cypheria's native agents. Native metadata is maintained in the server catalog from each native agent's official project and documentation. SQLite `agent_registry` rows retain the metadata of the selected or installed agent version: ID, name, version, description, repository, website, icon, native status, installed status, enabled status, and update time. Installing or updating commits both the concrete installation and that metadata. Uninstalling sets `installed` to false and disables the agent, while preserving its version and metadata. `AgentView.version` is therefore always non-null; `installed` independently reports whether that version is physically installed. The downloaded Registry remains the latest upstream view for ACP agents. `AgentView` exposes that candidate as `availableVersion`; clients derive update availability with semantic-version precedence instead of receiving a redundant boolean. `integrity` reports whether the active binary artifact was SHA-256 verified; package-manager installs and agents without a receipt report `not-applicable`. The database has one baseline migration because no previous Cypheria database version has shipped.

## Managed runtimes

Cypheria never installs agents into user-global Node, Python, npm, uv, or package directories. It bootstraps the newest stable Node LTS, uv, and managed non-prerelease CPython under `$CYPHERIA_HOME`. Missing toolchains bootstrap automatically; later upgrades require an explicit protocol call. Versions coexist and activation is atomic, so a running process keeps the absolute executable selected when it started.

```txt
$CYPHERIA_HOME/
  toolchains/
    node/versions/<version>/
    python/versions/<version>/
    uv/versions/<version>/
    python-envs/<fingerprint>/
    current.json
    manifest.json
    staging/
  cache/
    toolchains/
    npm/
    corepack/
    uv/
  agents/
    registry.json
    registry.metadata.json
    <agent-id>/
      versions/
      home/
      staging/
      receipts/
```

Registry distributions prefer a verified platform binary, then an npm package, then a Python package. npm packages are materialized during installation and run from their local entry point without implicit network access. Python packages are resolved by uv to an exact transitive lock with hashes. The shared immutable environment fingerprint includes that lock, indexes, OS, architecture, full CPython build/ABI, and uv version. Equal dependency closures share one environment; incompatible closures remain isolated. Running processes hold leases, and mark-and-sweep GC retains every environment referenced by an installed receipt or lease. An agent that must mutate site-packages receives a dedicated fingerprint.

Native versions are pinned as a compatibility unit: Codex `0.153.4`, Claude CLI `2.1.274` with Claude Agent SDK `0.3.270`, Pi `0.85.1`, and OpenCode Registry binary `1.18.30` with SDK `1.18.31`. Codex and OpenCode are shared server processes. Claude, Pi, and ACP agents are isolated by logical Cypheria session. OpenCode runs on a random loopback port and exposes the stable SDK root plus its two event streams; experimental `/v2` endpoints are rejected.

Shared dependency environments prevent accidental version conflicts and reduce physical storage through uv's cache and same-filesystem linking. They are not a security sandbox for hostile local code; hostile-code isolation requires a later process sandbox or container boundary.
