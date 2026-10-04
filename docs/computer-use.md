---
title: Computer Use
---

# Computer Use

Computer Use lets an Agent operate UI for the user: tabs of Cypheria's built-in browser, the user's own Chromium browsers, MCP Apps a Desktop window shows, and native desktop apps. Agents reach all four through one MCP server, `cua_repl`, whose JavaScript runtime exposes a `cua` API. This page owns that runtime, its hosts, its surfaces, and their trust boundaries; the host messages are in [Protocol](protocol.md#computer-use-hosts), and the built-in browser itself is in [Desktop](desktop.md#browser-and-dapp-boundary).

## Runtime

`apps/cua` (`@cypheria/cua`) contains the whole Computer Use runtime:

| Part | Role |
| --- | --- |
| `src/launcher` (`dist/cua-repl.mjs`) | The `cua_repl` MCP server: starts `node_repl` with a banner that imports the `cua` runtime, and with tool descriptions assembled for the enabled surfaces and platform from `instructions/` |
| `src/runtime` (`dist/runtime.mjs`) | The `cua` global inside the REPL sandbox. It shapes calls, renders observations as diffs, and shows each surface's guide from `docs/` the first time the model enters it |
| `src/host` | `CuaHost`, the Server side: request validation, surface gating, Thread scoping, host routing, and audit. `CuaDevice`, the device side that Desktop main runs: the external browser and native app backends |
| `src/driver-host` | The embedded cua-driver daemon supervisor that Desktop main runs |
| `plugin/` | The template of the hidden `cua` plugin |

`cua_repl` is the same `node_repl` binary with another banner and other tool descriptions, delivered through `NODE_REPL_JS_BANNER` and `NODE_REPL_TOOL_OVERRIDES`. Codex treats `cua_repl` and `node_repl` alike as REPL servers. The model sees `js` and `js_reset`; the hidden `turn_ended` tool is for hooks. Model code is untrusted: the REPL runs in the Codex sandbox and a V8 context without `process`, file system, or child process access, and it reaches the host only through `nodeRepl.rpc("cua", request)`, which `node_repl` forwards to the Thread's host services socket. Every decision is made by the host, never by the runtime.

## Plugins

The Server generates the hidden `cua` plugin from `apps/cua/plugin` into the bundled marketplace it materializes under `$CYPHERIA_HOME/plugins/cypheria-bundled`, with this installation's launcher. The plugin declares `cua_repl` with `js`, `js_reset`, and `turn_ended` exposed directly (`omit_tools_from: ["code_mode", "deferred"]`) and Codex `Stop`, `Interrupt`, and `SubagentStop` hooks that call `turn_ended`. Its server stays disabled in the plugin: each Codex Thread starts with a `mcp_servers.cua_repl` override carrying that Thread's host socket and enabled surfaces, and a Claude session receives them through `CYPHERIA_CUA_HOST_PIPE` and `CYPHERIA_CUA_SURFACES`, which the plugin's Claude configuration references. Plugin lists hide `cua`.

`browser`, `chrome`, and `computer-use` are ordinary bundled plugins with manifests and icons only: they describe each surface to the user and the model and anchor composer mentions. Their behavior lives in `apps/cua`.

## Hosts

Threads are shared: every client shows the same Thread, and any client can send its next turn. What Computer Use acts on is not shared. Tabs, App frames, browsers, and windows exist on one device, so every surface runs on a connected Cypheria Desktop that registered as a host, and the Server only routes. Surfaces split by who owns them. The built-in browser and MCP Apps belong to a window: every Desktop window registers its own browser host, so windows keep separate tabs and Apps. External browsers and native apps belong to the device: Electron main registers one computer host for them over its own connection and runs their requests itself, so the host does not depend on any window being open. Electron main and every window connect under the client ID that Desktop creates once per Cypheria home, so the Server joins them into one session. The model sees one host per device, named by client ID, with the union of its windows' and device's surfaces. Host registrations live only in Server memory and are made again after a restart or reconnect; tab state stays in Desktop, which reports its tabs again when asked. Other clients are not hosts. The messages are in [Protocol](protocol.md#computer-use-hosts).

A resource that exists stays on its host: a tab follows the host that has it, an external browser tab and an app window carry their host in their handle, and an MCP App goes to a host that shows it. A new tab, an external browser, or an app comes from the host the request names, else from the client that sent the Thread's current turn when it is a host, else from the only host that offers the surface. With several candidates and no current one, the request fails with the list of devices so the model can name one or ask the user. `cua.hosts()` lists the connected hosts and marks the current one. Neither a Thread nor `cua_repl` is bound to a device; the Server tells each device a Thread used when its turn ends and when it closes.

The Server's `computerUse` settings are the user's policy for every device. A device decides only what it can serve, and macOS grants belong to the Desktop that holds them.

## Surfaces

Settings → General → Computer Use enables each surface separately; all are off by default (`computerUse` in Server configuration). A disabled surface is omitted from the tool description and its API throws. Each surface has its own API because their element models and capabilities differ:

| Surface | API | Runs in | Elements |
| --- | --- | --- | --- |
| Built-in browser | `cua.iab` | A Desktop window and its browser guests | `@eN` refs from accessibility snapshots, trusted CDP input |
| External browsers | `cua.browsers` | [agent-browser](https://github.com/vercel-labs/agent-browser), started by the host's Electron main and attached to the user's browser over CDP | `@eN` refs from agent-browser snapshots |
| MCP Apps | `cua.mcpApps` | The host's Electron main, inside the App's sandbox frame | `@eN` refs, synthetic DOM events only |
| Desktop apps | `cua.getApp` | [cua-driver](https://cua.ai/docs/cua-driver), hosted by the host's Electron main | Numeric indices mapped to element tokens of the latest window snapshot |

`cua.getState()` reports the hosts and the inventory of every enabled surface, with external browsers and apps from the host a new request would use. Observations show the changes since the previous observation of the same target when that is shorter.

### Built-in browser

`cua.iab` drives the Thread's built-in browser tabs through the host described in [Protocol](protocol.md#computer-use-hosts). A composer mention of a tab is projected as `plugin://browser@cypheria-bundled?mention=tab-v1&tabId=…&title=…&url=…`, which `cua.iab.getTab({ mention })` resolves and rejects when the tab's title or URL changed. Tabs an Agent opens are temporary and close at the end of the turn unless it marks them deliverable or handoff.

### External browsers

`cua.browsers` supports Google Chrome, Microsoft Edge, Brave, Vivaldi, Opera, and Chromium on macOS, Windows, and Linux, on the host's own device. The host finds each browser's default user data directory, reads the `DevToolsActivePort` file the browser writes while remote debugging is on, checks that the port answers, and runs agent-browser with `--cdp` on that endpoint and one session per Thread and browser. The person enables remote debugging in the browser's `inspect/#remote-debugging` page and approves the connection when the browser asks; Cypheria never relaunches a browser with debugging flags or copies its profile, so the Agent works with the user's real tabs and sessions.

A Thread acts only in tabs it opened (`newTab`) or claimed from the browser's current tab list (`claimTab`). At the end of a turn, unmarked tabs it opened close and unmarked claimed tabs are released and stay open. Marked tabs stay; their marks clear when a later turn uses that browser again. agent-browser renumbers refs when the session switches tabs, so an action that fails after a switch reports that the tab needs a fresh snapshot. Uploads are limited to the task's working directory.

### MCP Apps

MCP Apps open from many places: a tool call in a Thread's Timeline, an App beside the conversation, a plugin's global page, or a settings layout. `cua.mcpApps` lists the open App instances the calling Thread may act on, its own and those outside any Thread but never another Thread's, from the Server's own instance table, keeping the ones a Desktop window shows. Every window renders its own copy of an instance, so an action goes to a copy on the device that sent the current turn when it shows the App, else to the newest window showing it. The window records each mounted App with its sandbox origin and forwards the `mcp_app` command to Electron main with that origin. Main finds the App document as the child frame of the matching sandbox proxy inside the requesting window only, takes snapshots with the built-in browser's snapshot engine, and performs clicks, typing, keys, selection, checking, and scrolling with synthetic events. Screenshots capture the App frame's rectangle from the window. There is no native input, navigation, or coordinate addressing, and an App closing invalidates its handle.

### Desktop apps

Desktop apps use cua-driver on the host's device, which reads accessibility trees and screenshots and acts in the background with its own cursor overlay, without moving the user's pointer or focus. `cua.getApp` binds one window: by name, bundle ID, or path on macOS, opening the app in the background when needed, and by window ID on Windows and Linux. Each Thread uses its own cua-driver session. Actions report a notice when cua-driver could not confirm their effect and recommends another approach.

Cypheria uses cua-driver as an embedded daemon rather than the standalone CuaDriver.app or an in-process SDK:

- On macOS, Accessibility and Screen Recording grants belong to the responsible app of a process. Desktop main spawns the bundled `cua-driver serve --embedded` directly, so the driver acts with Cypheria's grants, never raises its own prompts, and the user grants one app. Launching it from the Server would attribute the grants to whatever started the Server.
- A separate daemon keeps the cursor overlay, which needs the driver's own UI run loop, and isolates driver failures from Electron main.
- Desktop main connects to it through `cua-driver mcp --embedded --socket` at `$CYPHERIA_HOME/run/cua-driver.sock` (a temporary-directory socket when that path is too long, or a named pipe on Windows) and runs the requests the Server routes to this device. The Server keeps policy and audit and never runs a driver itself.

Desktop requests the macOS grants from Settings and restarts the daemon after a change, because macOS caches permission answers per process, then registers the host again. When the daemon is not running, Windows and Linux run `cua-driver mcp` directly, and macOS falls back to an installed CuaDriver.app with its own grants. Cypheria disables cua-driver telemetry and update checks. `pnpm --filter @cypheria/cua fetch:cua-driver` downloads the pinned release and verifies its digest; Server builds copy it, and the platform's agent-browser binary, into `dist/cua/bin`, where Desktop finds them.

## Safety

- The runtime's documentation tells the model to treat UI content as untrusted, to confirm consequential actions with the user, and to hand sign-in, CAPTCHA, and wallet steps to the user. Wallet signing from any page still passes Server policy, as described in [Web3](web3.md).
- The Server validates every request with Zod, scopes it to the Thread its socket belongs to, enforces enabled surfaces on every call, routes it to one host, and records state-changing operations in the audit log as `cua.<operation>` events without page or app content. The device validates its share again; device requests reach Electron main over its own connection and never pass through a renderer.
- A state-changing command that times out or loses its host is reported as possibly run, never retried automatically.
- External browser and native app control act with the user's own sessions and apps. Their switches are off by default, and cua-driver acts only with the macOS grants the user gave Cypheria.
