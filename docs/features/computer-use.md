---
title: Computer Use
---

# Computer Use

Computer Use lets an Agent operate UI for the user: tabs of Cypheria's built-in browser, the user's own Chromium browsers, MCP Apps a Desktop window shows, and native desktop apps. Agents reach all four through one MCP server, `cua_repl`, whose JavaScript runtime exposes the same `cua` and `agent` globals as ChatGPT's Computer Use. This page owns that runtime, its hosts, its surfaces, and their trust boundaries; the host messages are in [Protocol](../server/protocol.md#computer-use-hosts), and the built-in browser itself is in [Desktop](../desktop/desktop.md#browser-and-dapp-boundary).

## Runtime

`apps/cua` (`@cypheria/cua`) contains the whole Computer Use runtime:

| Part | Role |
| --- | --- |
| `src/launcher` (`dist/cua-repl.mjs`) | The `cua_repl` MCP server: starts `node_repl` with a banner that imports the runtime, and with tool descriptions assembled for the enabled surfaces, browser backends, and platform from `instructions/` |
| `src/runtime` (`dist/runtime.mjs`) | The `cua` and `agent` globals inside the REPL sandbox. They shape calls, serialize locator chains and `evaluate` functions, render observations as diffs, and show each browser type's guide from `docs/` the first time the model uses it, a capability's guide the first time it uses that capability, and the reference documents (troubleshooting, file uploads, local development, screenshots) when it asks for them with `agent.documentation.get()` |
| `src/browser` | The browser API grammar: every `agent.browsers` member with its argument schema, whether it changes state, and the browser types that support it |
| `src/engine` | The page engine over a `CdpTransport`: accessibility state with numeric element indices, trusted input, Playwright locators on Playwright's vendored injected script, screenshots, dialogs, file choosers, and logs |
| `src/dom-engine` | The DOM-only engine for MCP Apps: Playwright locators and synthetic events through an `evaluate` function |
| `src/host` | `CuaHost`, the Server side: request validation, surface and backend gating, Thread scoping, browser listing and routing, and audit. `CuaDevice`, the device side that Desktop main runs: the `chrome` browsers and the native app backends |
| `src/driver-host` | The embedded cua-driver daemon supervisor that Desktop main runs |
| `plugin/` | The template of the hidden `cua` plugin |

`cua_repl` is the same `node_repl` binary with another banner and other tool descriptions, delivered through `NODE_REPL_JS_BANNER` and `NODE_REPL_TOOL_OVERRIDES`. Codex treats `cua_repl` and `node_repl` alike as REPL servers. The model sees `js` and `js_reset`. The Server ends each Thread's turn in the host itself, for every Agent, so the REPL takes no part in turn ends. Model code is untrusted: the REPL runs in the Codex sandbox and a V8 context without `process`, file system, or child process access, and it reaches the host only through `nodeRepl.rpc("cua", request)`, which `node_repl` forwards to the Thread's host services socket. Every decision is made by the host, never by the runtime.

The kernels of both servers and the `cua_repl` launcher run on Cypheria's managed Node.js (`$CYPHERIA_HOME/toolchains/node`). Until it is installed they run on the Server's own executable; a Desktop-managed Server runs on Electron, so that fallback sets `ELECTRON_RUN_AS_NODE=1` in the server's environment. The Server worker removes `ELECTRON_RUN_AS_NODE` from its own environment at startup, so Agents, terminals, and the commands they run do not inherit it.

## Plugins

The Server generates the hidden `cua` plugin from `apps/cua/plugin` into the bundled marketplace it materializes under `$CYPHERIA_HOME/marketplaces/cypheria-bundled`, with this installation's launcher. The plugin declares `cua_repl` with `js` and `js_reset` exposed directly (`omit_tools_from: ["code_mode", "deferred"]`). Its server stays disabled in the plugin: each Codex Thread starts with a `mcp_servers.cua_repl` override carrying that Thread's host socket, enabled surfaces (`CUA_REPL_ENABLED_SURFACES`), and enabled browser backends (`CUA_REPL_BROWSER_BACKENDS`), and a Claude session receives them through `CYPHERIA_CUA_HOST_PIPE`, `CYPHERIA_CUA_SURFACES`, and `CYPHERIA_CUA_BROWSER_BACKENDS`, which the plugin's Claude configuration references. Plugin lists hide `cua`.

`browser`, `chrome`, and `computer-use` are ordinary bundled plugins with manifests and icons only: they describe each surface to the user and the model and anchor composer mentions. Their behavior lives in `apps/cua`.

## Hosts

Threads are shared: every client shows the same Thread, and any client can send its next turn. What Computer Use acts on is not shared. Tabs, App frames, browsers, and windows exist on one device, so every browser and app runs on a connected Cypheria Desktop that registered as a host, and the Server only routes. Hosts report what they offer by ChatGPT's backend names. The built-in browser (`iab`) and MCP Apps (`mcpapps`) belong to a window: every Desktop window registers its own browser host with those backends, so windows keep separate tabs and Apps. The user's Chromium browsers (`chrome`) and native apps (`computer`) belong to the device: Electron main registers one computer host with those capabilities over its own connection and runs their requests itself, so the host does not depend on any window being open. Electron main and every window connect under the client ID that Desktop creates once per Cypheria home, so the Server joins them into one session. The model sees one host per device, named by client ID, with the union of its windows' and device's capabilities. Host registrations live only in Server memory and are made again after a restart or reconnect; tab state stays in Desktop, which reports its tabs again when asked. Other clients are not hosts. The messages are in [Protocol](../server/protocol.md#computer-use-hosts).

A resource that exists stays on its host: a built-in browser tab follows the window that has it, a `chrome` browser and an app window carry their host, and an MCP App goes to a window that shows it. A new built-in browser tab or app comes from the host the request names, else from the client that sent the Thread's current turn when it is a host, else from the only host that offers it. With several candidates and no current one, the request fails with the list of devices so the model can name one or ask the user. `cua.hosts()` lists the connected hosts and marks the current one. Neither a Thread nor `cua_repl` is bound to a device; the Server tells each device a Thread used when its turn ends and when it closes.

The Server's `computerUse` settings are the user's policy for every device. A device decides only what it can serve and how it serves it, and macOS grants belong to the Desktop that holds them.

## Surfaces

`cua_repl` has ChatGPT's two surfaces: `browser`, through `agent.browsers` and `cua.getBrowser()`, and `computer`, through `cua.getApp()`. Settings → General → Computer Use enables each part separately; all are off by default (`computerUse` in Server configuration). The built-in browser, your browsers, and MCP Apps switches enable the `iab`, `chrome`, and `mcpapps` backends, and any of them enables the `browser` surface; Allowed browsers turns individual families off (`blockedBrowserFamilies`), whose browsers are then neither listed nor reachable. Desktop apps enables `computer`. A disabled surface or backend is left out of the tool description, and calls to it fail.

`agent.browsers.list()` lists browsers with IDs unique across devices. `agent.browsers.get()` and `cua.getBrowser()` also accept `iab`, `mcpapps`, and a browser family such as `chrome` or `edge`, resolved on the device that sent the turn. Each browser's type is its backend, which selects its guide and the API members it supports, and every browser shares the same tab API with numeric element indices:

| Browser | Backend and type | Runs in |
| --- | --- | --- |
| Built-in browser | `iab` | A Desktop window, with each tab's page driven by the engine in Electron main over `webContents.debugger` |
| The user's browsers | `chrome` | Electron main of the device, with pages driven by the engine; see [External browsers](#external-browsers) |
| MCP Apps | `mcpapps` | A Desktop window and the DOM-only engine in the App's sandbox frame |
| Desktop apps | The `computer` surface | [cua-driver](https://cua.ai/docs/cua-driver) hosted by the device's Electron main, or the Computer Use runtime of the user's installed ChatGPT on macOS; see [Desktop apps](#desktop-apps) |

`cua.getState()` reports the hosts, the browsers with the tabs the Thread controls, and the running apps of the host a new request would use. Observations show the changes since the previous observation of the same target when that is shorter. Tabs an Agent opens are temporary and close at the end of the turn unless it marks them deliverable or handoff; tabs it claimed from the user are released and stay open; marks clear when a later turn uses the browser again.

### Built-in browser

The window keeps tab lifecycle and its browser capabilities: `visibility` opens or hides the Thread's browser pane, and `viewport` fixes the size of the Thread's tabs until it is reset. Page members run in Electron main, as described in [Desktop](../desktop/desktop.md#agent-control). A composer mention of a tab is projected as `plugin://browser@cypheria-bundled?mention=tab-v1&source=iab&browserId=iab&tabId=…&title=…&url=…`, which `cua.getTab({ mention })` resolves and rejects when the tab's title or URL changed.

### External browsers

The `chrome` backend covers Google Chrome, Microsoft Edge, Brave, Vivaldi, Opera, and Chromium on macOS, Windows, and Linux, on the host's own device. How the device drives them is its implementation type, a Desktop setting (Settings → General → Computer Use → Browser connection, `chromeImplementationType` in the device's client storage): `extension`, the Cypheria extension and its native host (the default; see [Browser extension](browser-extension.md)), or `cdp`, the Chrome DevTools Protocol. The choice stays inside `@cypheria/cua` on the device. The device reports its `chrome` browsers without saying how it drives them, the Server and `cua_repl` list them with the type `chrome`, and both implementation types offer the same API through the shared engine.

With `extension`, each browser profile that has the Cypheria extension connects to Electron main through the native host and is listed as its own `chrome` browser with the ID `family:instance`. The extension lists and groups tabs and forwards CDP from `chrome.debugger`; every page behavior runs in the shared engine in Electron main. Agent tabs open in the background in a tab group named after the session, and a family name such as `chrome` means the profile that connected last.

With `cdp`, the device attaches to the user's running browsers. It finds each browser's default user data directory, reads the `DevToolsActivePort` file the browser writes while remote debugging is on, checks that the port answers, and connects the engine to that CDP endpoint directly; it also probes ports 9222 and 9229 for browsers started with `--remote-debugging-port`. The person enables remote debugging at the browser's `inspect/#remote-debugging` page and approves the connection when the browser asks; Cypheria never relaunches a browser with debugging flags or copies its profile, so the Agent works with the user's real tabs and sessions.

One connection serves every profile of a browser. Each open profile is a browser context, listed as its own `chrome` browser with the ID `family:profile-directory` and the name the browser shows for it in `Local State`; a hidden `chrome://version` target maps a context to its directory, and a family name such as `chrome` means the profile used last. The person's open tabs of every profile can be mentioned in the composer.

A Thread acts only in tabs it opened or claimed from `browser.user.openTabs()`. Agent tabs open in the background, and the engine emulates focus so they take input without coming to the front. Which Thread controls which tab is kept in Desktop's client storage, so it survives a Desktop restart until the browser restarts. Tabs a Thread controls show the agent's pointer and send `x-browser-agent: Cypheria/<version>` with their requests. Downloads the model waits for, media it saves with `locator.downloadMedia()`, and content it exports with `tab.content` (a Google Docs, Sheets, or Slides document through Google's export, or a YouTube transcript from the player's own captions) go to the Downloads folder. CDP has no tab groups, so with `cdp` the session name a model gives does not group tabs as the extension does. Uploads are limited to the task's working directory.

### MCP Apps

MCP Apps open from many places: a tool call in a Thread's Timeline, an App beside the conversation, a plugin's global page, or a settings layout. The `mcpapps` browser lists, as tabs, the open App instances the calling Thread may act on, its own and those outside any Thread but never another Thread's, from the Server's own instance table, keeping the ones a Desktop window shows. Every window renders its own copy of an instance, so an action goes to a copy on the device that sent the current turn when it shows the App, else to the newest window showing it. The window records each mounted App with its sandbox origin and sends the call to Electron main with that origin. Main finds the App document as the child frame of the matching sandbox proxy inside the requesting window only and runs the DOM-only engine there: Playwright locators, `evaluate`, a DOM snapshot, and clicks, typing, keys, checking, and selection as synthetic events, without `eval`, so the App's content security policy does not block them. Screenshots capture the App frame's rectangle from the window. There is no native input, navigation, or coordinate addressing, and an App closing invalidates its tab.

### Desktop apps

The `computer` surface has two backends, chosen per device in Settings → General → Computer Use → Desktop app control (`computerBackend` in the device's client storage): cua-driver, the default on every platform, and ChatGPT Computer Use, the runtime of the user's installed ChatGPT, on macOS only. Neither the Server nor `cua_repl` sees the choice.

#### cua-driver

Desktop apps use cua-driver on the host's device, which reads accessibility trees and screenshots and acts in the background with its own cursor overlay, without moving the user's pointer or focus. `cua.getApp` binds one window: by name, bundle ID, or path on macOS, opening the app in the background when needed, and by window ID on Windows and Linux. Each Thread uses its own cua-driver session. Actions report a notice when cua-driver could not confirm their effect and recommends another approach.

Cypheria uses cua-driver as an embedded daemon rather than the standalone CuaDriver.app or an in-process SDK:

- On macOS, Accessibility and Screen Recording grants belong to the responsible app of a process. Desktop main spawns the bundled `cua-driver serve --embedded` directly, so the driver acts with Cypheria's grants, never raises its own prompts, and the user grants one app. Launching it from the Server would attribute the grants to whatever started the Server.
- A separate daemon keeps the cursor overlay, which needs the driver's own UI run loop, and isolates driver failures from Electron main.
- Desktop main connects to it through `cua-driver mcp --embedded --socket` at `$CYPHERIA_HOME/run/cua-driver.sock` (a temporary-directory socket when that path is too long, or a named pipe on Windows) and runs the requests the Server routes to this device. The Server keeps policy and audit and never runs a driver itself.

Desktop requests the macOS grants from Settings and restarts the daemon after a change, because macOS caches permission answers per process, then registers the host again. When the daemon is not running, Windows and Linux run `cua-driver mcp` directly, and macOS falls back to an installed CuaDriver.app with its own grants. Cypheria disables cua-driver telemetry and update checks. `pnpm --filter @cypheria/cua fetch:cua-driver` downloads the pinned release and verifies its digest; Server builds copy it into `dist/cua/bin` beside the runtime, where Desktop finds it.

#### ChatGPT Computer Use

Cypheria never bundles, downloads, or modifies OpenAI components; it runs the runtime the user installed, unchanged, and leaves its decisions in force. Desktop main reads `mcpServers.cua_repl` from the newest `~/.codex/plugins/cache/openai-bundled/unified-computer-use/*/.mcp.json` that ChatGPT writes when the user turns on Computer Use, preferring the version that matches ChatGPT.app. It checks only statically that the files the entry names exist, that ChatGPT.app and Codex Computer Use.app pass `codesign --verify --strict` with OpenAI's team `2DC432GLL2`, and that the Codex sandboxing the runtime has the `sandbox` subcommand; compatibility is the runtime's own handshake to decide. Settings shows why the backend is unavailable, such as when Computer Use was never turned on in ChatGPT.

The runtime starts with ChatGPT's command and environment, changed only so that it uses Cypheria's Codex (`CODEX_CLI_PATH`, from the device's Codex installation receipt, or ChatGPT's own Codex when this device has none, such as with a remote Server) and Codex home (`CODEX_HOME`, also in `NODE_REPL_TRUSTED_CODE_PATHS`), serves native apps alone (`CUA_REPL_ENABLED_SURFACES=computer`), and loads only the `sky` service with its audio recording methods (`SKY_ENABLE_AUDIO=1`), without ChatGPT's browser backends or instructions. Each Thread gets its own runtime process, as Codex runs one MCP connection set per thread, started on the Thread's first native app request and stopped when the Thread closes or after ten idle minutes.

Desktop main is the runtime's MCP client. Each request becomes one `js` call against the raw `sky` API (`list_apps`, `get_app_state`, `click`, `type_text`, `press_key`, `scroll`, `set_value`, `select_text`, `perform_secondary_action`, `paste`, `drag`) with the Thread and a per-turn ID in `x-codex-turn-metadata`; screenshots return as image content. The runtime binds apps by name or bundle ID, not by window, and has no menu API. Before Computer Use first operates an app, the runtime asks for approval; Cypheria turns that into a permission question in the Thread that any client can answer, holding the device request's deadline while a person decides, and the runtime's own denied and forbidden apps stay refused. At the end of each turn Desktop calls the runtime's `turn_ended` tool and runs `SkyComputerUseClient turn-ended`. A stop by the user is reported to the model as a stop; a service that rejects the runtime turns the backend off with the reason in Settings. Accessibility and Screen Recording belong to Codex Computer Use.app, which requests them itself.

#### Computer audio

When the Server's environment has `NODE_REPL_ENABLE_AUDIO=1`, the REPLs get `nodeRepl.emitAudio`, which returns audio to the model as MCP audio content, and `cua.computer` gains `start_audio_recording({ max_duration_ms })` and `stop_audio_recording()`, documented to the model with the native app guide. The recording captures the sound the computer plays, not the microphone. Only ChatGPT Computer Use records: `start_audio_recording` maps to the `sky` method of that name, whose approval request becomes a `kind: "audio"` permission question in the Thread, and cua-driver refuses the requests. The recording stays on the device that started it. `stop_audio_recording` returns the size and type of the WAV file the runtime saved, and the runtime reads it back through `apps.audio.read` in 384 KiB pieces, below the Server's message limit, and returns one data URL for `nodeRepl.emitAudio`. Durations run from 100 ms to five minutes, as in ChatGPT.

## Safety

- The runtime's documentation tells the model to treat UI content as untrusted, to confirm consequential actions with the user, and to hand sign-in, CAPTCHA, and wallet steps to the user. Wallet signing from any page still passes Server policy, as described in [Web3](web3.md).
- The Server validates every request with Zod, scopes it to the Thread its socket belongs to, enforces enabled surfaces and backends on every call, checks browser members against the browser's type, routes it to one host, and records state-changing operations in the audit log as `cua.<operation>` events without page or app content. The device validates its share again; device requests reach Electron main over its own connection and never pass through a renderer.
- A state-changing command that times out or loses its host is reported as possibly run, never retried automatically.
- Full CDP access is not exposed to the model, and browsing history, bookmarks, and top sites are not available.
- External browser and native app control act with the user's own sessions and apps. Their switches are off by default; cua-driver acts only with the macOS grants the user gave Cypheria, and ChatGPT Computer Use asks the people in the Thread before it first operates each app.
