# ACP Harness Connections Design

Status: proposed

Research snapshot: 2026-09-06
Scope: Grok Build, Cursor, Gemini CLI, Hermes Agent, and OpenCode in Desktop

## Decisions

Codex keeps its existing, always-started App Server integration. Every other harness uses a shared ACP v1 client and a lazy process supervisor.

- First install resolves and installs the latest release available at that moment. Cypheria stores the resolved version as provenance, never as a version constraint.
- Installed, enabled, running, and authenticated/configured are independent states.
- Enable makes a harness selectable but does not start it. ACP starts on demand; disable stops it and prevents new work.
- All binaries, runtimes, caches, configuration, credentials, and sessions live below `$CYPHERIA_HOME/harnesses/<id>`.
- Show the installed version when detectable. Show an update badge only when upstream provides a reliable check; updates remain user-triggered.
- The Connections content area owns a bottom, multi-tab PTY dock. Terminals for multiple agents can remain open while switching connections and are all closed when leaving the Connections route. Only documented local Web UIs are exposed: OpenCode Web and the optional Hermes Web Dashboard.

The official [ACP Registry](https://github.com/agentclientprotocol/registry) is distribution metadata, not an executable remote catalog. Cypheria ships reviewed descriptors defining allowed publishers, packages, hosts, commands, environment variables, and a latest-resolution strategy. The current registry covers Grok Build, Cursor, Gemini CLI, and OpenCode; Hermes needs a Cypheria descriptor.

## ACP and architecture

ACP v1 is newline-delimited JSON-RPC over stdio. A connection calls `initialize`, negotiates capabilities and authentication methods, then uses `session/new`, `session/load`, or `session/resume`. See [initialization](https://agentclientprotocol.com/protocol/v1/initialization), [authentication](https://agentclientprotocol.com/protocol/v1/authentication), and [session setup](https://agentclientprotocol.com/protocol/v1/session-setup). Use stable v1 from [`@agentclientprotocol/sdk`](https://github.com/agentclientprotocol/typescript-sdk) and reject an incompatible major version.

```text
renderer -> typed harness.* IPC
Electron main
  -> HarnessConnectionService
     -> HarnessCatalog
     -> HarnessInstaller / HarnessUpdateService
     -> HarnessSupervisor
     -> HarnessTerminalService
     -> HarnessWebUiService
  -> @cypheria/acp-bridge -> ACP stdio child
```

`packages/acp-bridge` has no Electron dependency and owns ACP transport, initialization, correlation, cancellation, timeouts, event projection, and the AI SDK adapter. Installation, process/PTY/Web-server lifecycle, keychain access, and IPC remain in Electron main. ACP is not a sandbox; Cypheria still enforces workspace, approval, and signing policies.

Descriptors describe behavior, not a pinned release:

```ts
type HarnessDescriptor = {
  id: HarnessId
  protocol: { major: 1; transport: "stdio" }
  latestResolver: LatestResolver
  installer: ManagedInstaller
  executable: string
  serveArgs: readonly string[]
  versionProbe: readonly string[]
  updateCheck: UpdateCheckStrategy
  updateAction: UpdateAction
  homeEnv: Readonly<Record<string, ManagedPath>>
  terminalPresets: readonly TerminalPreset[]
  localWebUi?: LocalWebUiDescriptor
}
```

Never execute arbitrary network-provided commands. Zod-validate metadata, apply the bundled allowlist, and spawn only an absolute managed executable with an argv array.

## Managed installation and homes

```text
$CYPHERIA_HOME/
  harnesses/
    state.json
    <id>/
      runtime/       # active binary/package payload
      home/          # vendor home
      os-home/       # synthetic HOME where required
      staging/       # transactional install/update
  cache/harness-downloads/
  logs/harnesses/<id>/
```

Resolve these paths once in `CypheriaRuntimePaths`. A managed harness never falls back to the user's `PATH`.

| Harness | Managed-home mapping |
| --- | --- |
| Grok Build | `GROK_HOME=<...>/home`, `GROK_BIN_DIR=<...>/runtime/bin`, and synthetic `HOME`; its installer still writes downloads/completions/config through `$HOME/.grok` |
| Cursor | synthetic `HOME=<...>/os-home`; the installer hardcodes `$HOME/.local/share/cursor-agent` and `$HOME/.local/bin`, while CLI config uses `~/.cursor` |
| Gemini CLI | `GEMINI_CLI_HOME=<...>/home`; npm prefix is `<...>/runtime` |
| Hermes | `HERMES_HOME=<...>/home`, `HERMES_INSTALL_DIR=<...>/runtime/hermes-agent`, and synthetic `HOME` for its `$HOME/.local/bin` launcher |
| OpenCode | synthetic `HOME` plus managed `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, and `OPENCODE_CONFIG_DIR` |

Use the identical environment for ACP, login/setup, update checks, updates, the settings terminal, and Web UI. Synthetic `HOME` intentionally isolates real dotfiles. Keep project cwd, `SSH_AUTH_SOCK`, and proxy variables; add explicit import/select flows later instead of reading the real home implicitly.

### Latest-only transactional installation

“Latest” is resolved only when Install or Update is clicked. Do not persist a desired version/range. Persist an immutable receipt with resolved version/commit, source URL, available integrity value, install time, and descriptor revision.

Install into `staging`, verify integrity and executable, run the version probe, complete a bounded ACP `initialize`, then atomically swap the active runtime. Keep one previous payload temporarily for failure recovery; this is not user-facing version selection.

- **Grok:** official latest-stable installer with managed `HOME`, `GROK_HOME`, and `GROK_BIN_DIR`; allowlisted `@xai-official/grok@latest` is a fallback.
- **Cursor:** official installer under synthetic `HOME`.
- **Gemini:** `@google/gemini-cli@latest` in an isolated app-owned npm prefix; run `node_modules/.bin/gemini` directly, never `npx @latest` at startup.
- **Hermes:** official CLI installer only; see its section below.
- **OpenCode:** prefer the ACP Registry platform artifact with SHA-256; otherwise use the official installer under synthetic `HOME` with `--no-modify-path`.

Require HTTPS, size limits, safe extraction, and published integrity checks. Cursor's current official installer and ACP descriptor do not document an artifact checksum; surface that limitation in diagnostics instead of inventing a digest. Never request administrator privileges.

## Version and update matrix

| Harness | Installed version | Update information | Product behavior |
| --- | --- | --- | --- |
| Grok | `grok version` (fallback `--version`) | Official read-only `grok update --check` | Show badge; Update installs latest through the managed installer |
| Cursor | `cursor-agent --version` | Docs describe automatic updates and `update`/`upgrade`, but no stable check-only command/manifest | Show version and “Cursor manages checks”; always offer “Update to latest”; do not fabricate a newer-version badge |
| Gemini | `gemini --version` | Compare official npm `@google/gemini-cli` `latest` dist-tag | Set managed `general.enableAutoUpdate=false`; show badge and reinstall `@latest` on click |
| Hermes | `hermes --version` | Official read-only `hermes update --check` | Show badge; run `hermes update` in PTY because dependency/config migration may need attention |
| OpenCode | `opencode --version` | Compare official GitHub latest release or the verified ACP Registry version | Set `OPENCODE_DISABLE_AUTOUPDATE=true`; show badge and install latest verified artifact |

Check once after startup, on explicit refresh, and after a conservative cache interval (for example 24 hours). Use jitter/timeouts, respect proxy/offline state, and store source plus `lastCheckedAt`. A failed check means “unknown,” never “up to date.”

Updates are user-triggered: block new turns, stop ACP gracefully, update with visible progress, verify version and ACP, then return to `enabled-idle`. Interactive migrations open the PTY with a prefilled command.

## Lifecycle

```text
not-installed -> installing -> installed-disabled
installed-disabled -> enabled-idle
enabled-idle -> starting -> running -> auth-required | ready | failed
running -> stopping -> enabled-idle -> installed-disabled
```

- Codex stays outside this state machine and always starts.
- Install does not imply enable; enable does not imply run.
- Selecting a harness or reopening its chat starts ACP on demand.
- Disable blocks new turns and stops ACP/local Web UI. With an active turn, default to “disable after turn” and offer “stop now.”
- Confirm before closing an open configuration terminal because it may contain interactive work.
- Restart crashed processes only with bounded attempts while a chat is waiting.
- Do not add idle shutdown until cross-process session recovery is verified.

## Authentication, terminal, and Web UI

After ACP `initialize`, render returned `authMethods`. Call ACP `authenticate` for agent-managed methods. Terminal methods use a separate real PTY with the same managed environment/cwd, then reconnect ACP. Keep the legacy terminal-auth `_meta` while OpenCode needs it.

There is no generic Codex-style `account/read`. Show “Verified” only after session creation succeeds. Harness tokens stay in managed homes; API keys entered in Cypheria use the OS credential store and are injected only into child processes.

Every non-Codex detail page has **Open terminal**, but the resulting dock belongs to the Connections route. It expands at the bottom of the content area, supports one tab per open agent terminal, survives connection selection changes, and calls close-all cleanup when the route unmounts. Electron main owns the PTY and typed input/output/resize/close/close-all IPC. It starts a shell with managed runtime first on `PATH`, the managed home environment, and selected workspace cwd. Print:

```text
Cypheria managed <Harness> terminal
Home: <managed path>
Changes here affect only this Cypheria-managed harness.
Useful commands: <vendor presets>
```

Command chips insert commands into the PTY; they do not bypass the CLI. Do not persist scrollback by default and redact secrets from diagnostics.

Expose local Web UI only when documented:

- OpenCode: `opencode web --hostname 127.0.0.1 --port <allocated>`, with an app-generated `OPENCODE_SERVER_PASSWORD`.
- Hermes: first install optional `.[web,pty]` into the same venv, then `hermes dashboard --host 127.0.0.1 --port <allocated> --no-open`.
- Grok's `grok dashboard` is documented as opening Agent Dashboard, not as an owned local server; expose it as an external link.
- Cursor and Gemini have no documented local configuration Web UI.

Open local pages in Cypheria's in-app browser. Bind only loopback, allocate ports dynamically, validate readiness/URLs, and stop owned servers when closed, disabled, or on app exit.

## Harness specifics

### Grok Build

- ACP: `grok agent stdio`.
- Login: `grok login`, device flow `grok login --device-auth`, or `XAI_API_KEY`; logout `grok logout`.
- Terminal presets: `grok login`, `grok inspect`, `grok mcp list`, `grok setup`.
- Update: `grok update --check`; install latest stable on click.

References: [overview/install](https://docs.x.ai/build/overview), [CLI](https://docs.x.ai/build/cli/reference), [settings/`GROK_HOME`](https://docs.x.ai/build/settings), [installer](https://x.ai/cli/install.sh).

### Cursor

- ACP: `cursor-agent acp`.
- Run installer and CLI under synthetic `HOME` because official paths are HOME-relative.
- Prefer returned ACP `cursor_login`; terminal fallback `cursor-agent login`. API options: `CURSOR_API_KEY`/`--api-key`, `CURSOR_AUTH_TOKEN`/`--auth-token`. Status/logout: `cursor-agent status/logout`.
- Show `cursor-agent --version`. Native auto-update is documented; manual `update`/`upgrade` exists, but no official check-only mechanism was found.

References: [ACP](https://cursor.com/docs/cli/acp), [installation/updates](https://docs.cursor.com/en/cli/installation), [authentication](https://docs.cursor.com/en/cli/reference/authentication), [installer](https://cursor.com/install).

### Gemini CLI

- ACP: `gemini --acp`.
- Install `@google/gemini-cli@latest` under the app prefix and set `GEMINI_CLI_HOME`.
- Auth: Google browser login, `GEMINI_API_KEY`, or Vertex AI/ADC; use actual ACP methods, not hardcoded IDs.
- Terminal presets: `gemini`, `gemini mcp`, `gemini extensions`; `/auth` is available inside the TUI.

References: [installation](https://geminicli.com/docs/get-started/installation/), [authentication](https://geminicli.com/docs/get-started/authentication/), [ACP](https://geminicli.com/docs/cli/acp-mode/), [configuration/`GEMINI_CLI_HOME`](https://geminicli.com/docs/reference/configuration/), [version/update FAQ](https://geminicli.com/docs/faq/).

### Hermes Agent

This means Nous Research Hermes Agent.

- Install CLI only. Never use the Desktop installer or pass `--include-desktop`.
- In the official installation documentation and installer source fetched on 2026-09-06, an unmodified per-user install resolves code to `~/.hermes/hermes-agent`, data to `~/.hermes`, and the launcher to `~/.local/bin/hermes`. Treat this as an upstream implementation snapshot, not a permanent assumption.
- Although `--dir`/`HERMES_INSTALL_DIR` and `--hermes-home`/`HERMES_HOME` exist, the launcher still follows `$HOME/.local/bin`; therefore synthetic `HOME` is also mandatory.
- Base install: official latest installer with `--skip-setup --skip-browser --skip-computer-use --non-interactive --dir <runtime>/hermes-agent --hermes-home <home>`. This follows latest `main`, avoids Desktop and heavy optional tools, and does not force official login.
- Every install/update writes a receipt under `$CYPHERIA_HOME/harnesses/hermes/receipts/`: installer identity/URL, argv, non-secret managed environment paths, platform/architecture, detected version, executable path and SHA-256, plus the before/after list of created or changed files (relative path, size, and mtime).
- ACP: `hermes acp`. Provider setup is optional; users may use `hermes model`, `hermes setup`, or the terminal for Nous or third-party providers. Enablement must not require Nous Portal login.
- Update: `hermes update --check` and interactive `hermes update`.
- Web Dashboard is an optional component: install `.[web,pty]` only on request. It is not Hermes Desktop.

References: [installation/default layout](https://hermes-agent.nousresearch.com/docs/getting-started/installation), [installer flags](https://hermes-agent.nousresearch.com/install.sh), [ACP](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp), [providers](https://hermes-agent.nousresearch.com/docs/integrations/providers/), [updates](https://hermes-agent.nousresearch.com/docs/getting-started/updating), [environment](https://hermes-agent.nousresearch.com/docs/reference/environment-variables), [Web Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard).

### OpenCode

- ACP: `opencode acp`.
- Use latest verified registry artifact; synthetic HOME/XDG isolates all state.
- Configure providers with `opencode auth login`; inspect/remove with `auth list/logout` in the PTY.
- Disable native auto-update and let the user install the newest verified release.
- Local Web UI: loopback-only `opencode web` with generated Basic Auth credentials.

References: [CLI/ACP/upgrade/env](https://opencode.ai/docs/cli/), [providers](https://opencode.ai/docs/providers), [config](https://opencode.ai/docs/config), [Web](https://opencode.ai/docs/web/), [server security](https://opencode.ai/docs/server/), [registry descriptor](https://raw.githubusercontent.com/agentclientprotocol/registry/main/opencode/agent.json).

## Renderer, IPC, and acceptance

```ts
type HarnessConnectionView = {
  id: HarnessId
  installedVersion: string | null
  availableVersion: string | null
  versionCheck: "supported" | "native-auto" | "unsupported"
  lastUpdateCheckAt: string | null
  installState: "notInstalled" | "installing" | "installed" | "updating" | "failed"
  enabled: boolean
  runtimeState: "disabled" | "idle" | "starting" | "running" | "stopping" | "failed"
  authState: "unknown" | "required" | "configured" | "verified"
  terminalAvailable: true
  localWebUi: "unsupported" | "componentMissing" | "stopped" | "starting" | "running" | "failed"
}
```

IPC covers list/install/update/uninstall/check, enable/lifecycle/auth, PTY create/input/resize/close, and Web UI component/start/stop/open. Every mutation returns an operation ID. Settings order: install/version, update, enable/runtime, auth/provider, terminal, Web UI, storage, diagnostics, uninstall. Codex says “Built in · Always on.”

Acceptance requires: all five install latest and operate over ACP independently; every owned file stays below `$CYPHERIA_HOME`; real user home remains unchanged; version/update states follow the table; disabled processes are gone; each terminal uses the exact managed environment; OpenCode/Hermes local Web UI is loopback-only and cleaned up; Hermes neither installs Desktop nor forces Nous login; secrets never enter renderer persistence or ordinary logs.

Implement as separate reviewable todos: paths/state/descriptors; ACP bridge; lazy supervisor/chat binding; PTY; one installer at a time (OpenCode, Gemini, Grok, Cursor, Hermes); update UI; local Web UIs; reliability/platform tests.
