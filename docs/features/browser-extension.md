---
title: Browser Extension
---

# Browser Extension

The Cypheria extension is the `extension` implementation of the `chrome` backend: it lets the Agents of a Cypheria Desktop work in the person's own Chromium browser profiles. This page owns the extension, its native messaging host, the Desktop endpoint they connect to, and the protocol between them. What Agents can do with the browsers, and how the `chrome` backend scopes them to Threads, is in [Computer Use](computer-use.md#external-browsers).

## Components

| Part | Workspace | Role |
| --- | --- | --- |
| Extension | `apps/browser-extension` (`@cypheria/browser-extension`) | Manifest V3 service worker built with WXT. It keeps a native messaging port open, lists and groups tabs, attaches `chrome.debugger`, forwards CDP commands and events, and reports downloads. It exports the protocol schemas and the request peer that Desktop uses. |
| Native host | `apps/browser-extension-host` (Go) | Started by the browser per extension connection. It checks the caller, finds Desktop through the discovery file, answers `hello`, and relays every other message in both directions. |
| Desktop endpoint | `apps/desktop/main/src/browser-extension` | Electron main's local socket, the discovery file, host installation and registration, one session per connected profile, and the `chrome` drivers that run the shared engine over each session's forwarded CDP. |

The extension stays thin. Thread scoping, tab leases, turn-end cleanup, and every page behavior (accessibility state, input, locators, screenshots, dialogs, downloads, the agent's pointer, and the `x-browser-agent` header) run in Electron main, the same code that serves the `cdp` implementation. The extension never injects a wallet provider and does not read history, bookmarks, or top sites. There is no side panel.

## Connection

```text
extension service worker ⇄ native messaging (stdio) ⇄ cypheria-browser-host ⇄ local socket ⇄ Electron main
```

1. On start, after a restart of the browser, and on an alarm while it is disconnected, the service worker calls `chrome.runtime.connectNative("app.cypheria.browser_extension")` and sends `hello` with its ID, version, and protocol version. The open port keeps the service worker alive.
2. The browser starts the host with the caller's origin. The host refuses any origin whose extension ID is not compiled into it, resolves `CYPHERIA_HOME` as the parent of its own `bin/` directory, and reads `$CYPHERIA_HOME/run/browser-extension.json`.
3. The host connects to the endpoint the file names and sends `connect` with the file's token, the origin, and the extension's hello. Desktop checks the token in constant time, checks the extension ID against the allowed IDs, compares protocol versions, and answers with its version or `unauthorized`, `extension_update_required`, or `app_update_required`. The host answers `hello` with that result.
4. Without Desktop, the host answers `desktop_not_running` and keeps the port open, looking for Desktop every two seconds; when it connects, or when Desktop goes away later, the host sends `desktopStatus`. A version or token error closes the port, and the extension retries with backoff.
5. Desktop asks the new connection for `getInfo` and adds the profile to the device's `chrome` browsers. A profile that reconnects replaces its earlier connection.

The extension's action badge shows `!` while it is not connected, and its connection state is kept in `chrome.storage.session` for diagnostics.

## Protocol

Every hop carries the same JSON messages: requests with an `id`, responses with a `result` or an `error` (`code` and `message`), and notifications without an `id`. The browser frames them on the host's standard input and output as a 32-bit little-endian length followed by UTF-8 JSON; the host uses the same framing on Desktop's socket. Messages toward the browser are limited to 1 MB, and the host answers a larger request from Desktop with an error. `PROTOCOL_VERSION` changes whenever a message changes incompatibly. The Zod schemas live in `apps/browser-extension/src/protocol.ts`.

| Direction | Message | Purpose |
| --- | --- | --- |
| Extension → host | `hello` | Versions; answered by the host with Desktop's version or an error |
| Host → extension | `desktopStatus` | Desktop connected or went away |
| Host → Desktop | `connect` | Token, origin, and the extension's hello |
| Desktop → extension | `getInfo` | Family, extension version, and the profile's instance ID |
| Desktop → extension | `listTabs` | Open tabs of normal windows with last access and group title, without browser pages or incognito tabs |
| Desktop → extension | `openTab`, `nameGroup` | A background tab in a Thread's tab group, created in the last focused window; renaming that group |
| Desktop → extension | `closeTab`, `attach`, `detach` | Closing a tab; attaching and detaching `chrome.debugger` |
| Desktop → extension | `cdp` | One CDP command on an attached tab, attaching first when needed |
| Extension → Desktop | `cdpEvent`, `cdpDetached` | CDP events of attached tabs; the debugger leaving a tab |
| Extension → Desktop | `downloadChanged` | A download starting, completing with its file, or failing |

A Thread's tab group is keyed by a hash of the Thread ID, so the extension learns nothing about the Thread. Browser pages (`chrome://` and other browser schemes, other extensions) and incognito tabs are never listed or attached.

## Desktop endpoint

Electron main listens on a Unix socket at `$CYPHERIA_HOME/run/browser-extension.sock`, in an owner-only directory, falling back to a private temporary directory when that path is too long; on Windows it listens on a named pipe derived from the home. At each start it generates a token and writes the endpoint, token, protocol version, Desktop version, and process ID to the owner-only `$CYPHERIA_HOME/run/browser-extension.json`, replacing the file atomically. On quit it removes the file only if it still holds its own token, since another Desktop may have started since.

At startup Desktop also installs the host it ships to `$CYPHERIA_HOME/bin/cypheria-browser-host` (copying only when the contents changed) and registers it as `app.cypheria.browser_extension`, allowing only Cypheria's extension origins:

- macOS and Linux: a manifest in the `NativeMessagingHosts` directory of each Chromium browser's profile root that exists (Chrome, Edge, Brave, Vivaldi, Opera, Chromium).
- Windows: a manifest under `$CYPHERIA_HOME/browser-extension/` and `HKCU` registry keys for Chrome, Edge, Brave, Chromium, and Vivaldi.

The registration is global per browser, so the Desktop that started last owns it. Settings → General → Computer Use shows whether the host is installed, which browser profiles are connected, and, in development builds, where to load the unpacked extension.

## Development

`pnpm dev:desktop` and `pnpm --filter @cypheria/desktop dev` build the extension into `apps/browser-extension/.output/chrome-mv3` and the host into `apps/browser-extension-host/dist/<platform>-<arch>/`, and Desktop installs the host at startup. Load the extension once per browser profile: open the browser's extensions page, turn on Developer mode, choose **Load unpacked**, and select that directory. The manifest `key` fixes the development extension ID, which the host and Desktop accept; store builds receive their own IDs, which join `EXTENSION_IDS` when the extension is published.

```sh
pnpm --filter @cypheria/browser-extension build
pnpm --filter @cypheria/browser-extension test
pnpm --filter @cypheria/browser-extension-host build
pnpm --filter @cypheria/browser-extension-host check
pnpm --filter @cypheria/browser-extension-host build:all
```

Unit tests run the extension's backend and native port against a fake browser. The Go tests run the host against a fake Desktop. `apps/desktop/main/src/browser-extension/extension.e2e.test.ts` runs the whole chain: Chromium for Testing loads the unpacked extension with a native messaging manifest in its own user data directory, the real host connects to a real endpoint, and the `chrome` backend opens, groups, claims, and drives tabs; it skips when Playwright's Chromium or Go is missing.
