---
title: Desktop
---

# Desktop

`apps/desktop` is Cypheria's primary client. It combines Electron main and preload processes with a TanStack Start renderer and preserves the dense, workspace-oriented Sidebar and conversation experience. It does not share its application shell with Expo.

## Process boundary

- Electron main owns windows, application lifecycle, Server management, desktop settings, secure storage, updates, native menus, OS integration, and isolated dApp browser views.
- Preload exposes a narrow typed IPC surface for Electron-only capabilities.
- The TanStack renderer uses `@cypheria/client` directly for shared product state and live Agent turns.
- dApp preload exposes a scoped provider bridge to an isolated origin; it never exposes Node.js or key material.

Default browser views keep `nodeIntegration` off, `contextIsolation`, sandbox, and web security on.

## Server Manager

At startup, Electron main:

1. checks the configured or bundled Server executable;
2. discovers a running local instance and validates protocol compatibility;
3. starts a Server when none is reusable;
4. waits for readiness before connecting the renderer;
5. captures actionable logs and failure state;
6. only reclaims a process started by this Desktop when it is idle and safe to stop.

The packaged application copies the Server distribution into its resources. Desktop does not move database, Agent, schedule, integration, or Web3 ownership back into Electron.

## Sidebar invariants

The Sidebar consumes the Cypheria Projects, Threads, and Sections facades. The Server returns membership and ordering directly; the renderer does not infer them from Codex metadata.

The established interaction model is a product invariant:

- Pinned, custom Sections, Projects, and recents keep their hierarchy and visual density.
- Project Threads remain nested and support expansion, pagination, and “show more”.
- Selection, create, rename, archive, delete, pin, unpin, drag, cross-Section move, and reorder remain available where the protocol permits.
- Context menus, keyboard navigation, unread state, and running state remain visible.
- Loading, empty, error, and optimistic states preserve layout and roll back failed mutations.

Query keys and optimistic updates are based on Cypheria IDs. Harness session IDs never replace Thread IDs in navigation or cache identity.

## Page headers

Desktop does not reserve a global titlebar above every route. A route that needs the shared chrome renders `PageHeader` itself and supplies its own children; a route that does not need a header fills the content area from the top. `PageHeader` owns the standard 44-pixel geometry, Electron drag region, and animated leading inset that keeps route content coordinated with the Sidebar's expanded and collapsed titlebar controls.

Conversation workspaces intentionally do not use `PageHeader`. Their chrome is split between the conversation `ChatHeader` and the right `ChatPanel` workspace header, matching the Chat Demo reference. The conversation header participates in the same Sidebar inset transition, while the right header carries its tab strip, tab launcher, and full-screen action without a bottom border. Bottom-panel and side-panel toggles remain fixed at the right edge of the window header; when the side panel is hidden, the conversation header expands beneath that area while reserving space for both controls.

## Settings navigation

Settings and the workspace use the same resizable Desktop sidebar shell, titlebar geometry, compact horizontal gutters, collapse behavior, and width state; only their navigation content differs. Settings uses one flattened, virtualized navigation list. The back row, group labels, ordinary settings items, the expandable Agent harnesses row, and all visible Agent child rows share one scroll container and one TanStack Virtual virtualizer. Search and the theme footer stay outside that container. Expansion, search, and registry membership changes rebuild the flat row model; route changes scroll the active item into view. Agent child rows never introduce a nested scroller or second navigation virtualizer. The Agent harnesses parent is an expand control rather than a page and is never active. Its children are the harnesses in the user's Agent registry; the four native harnesses are registered during Server initialization.

The add action on the Agent harnesses row is disabled when every catalog harness has already been registered. Otherwise it opens an edge-aligned picker whose options include each harness description and installable version. Selecting an option adds the Agent registry record and opens its settings immediately. Child rows show gray, yellow, or green status dots for uninstalled, installed-but-disabled, or enabled Agents, plus a menu that removes an uninstalled Agent from the registry. Agent harness routes use `/settings/agent-harnesses/$agentId/$sectionId`. The header shows the current version; an uninstalled harness places its Install action and percentage progress inside the installation notice. An installed but disabled harness replaces section content with an Enable notice and disables its section navigation. Installed harnesses expose a Restart menu item and a destructive icon button for Uninstall. Restart requires warning confirmation because it forcibly stops the harness, closes its active threads, and interrupts in-progress work before starting it again. Uninstall keeps the row in navigation and returns it to the Install notice. Update and Uninstall icon buttons expand to show percentage progress while their operation runs. Native and registry harnesses expose Update when the shared semantic-version comparison reports that the currently available catalog version is newer than the installed version. For a native harness, the available version is the exact version in Cypheria's tested native harness manifest. Operation state is isolated by Agent so installing, updating, or uninstalling one harness does not disable another. The selected Agent owns a second-level section menu for authentication, models, and discovered settings categories; on narrow screens it becomes a selector. The right panel contains the actual section. Network proxy remains above the Agent header and starts collapsed. A second collapsed card directly below it lists Node.js, Python, and uv toolchains managed for Agent harnesses. It omits pinned-version and up-to-date labels; available install or update actions use icon buttons that expand to percentage progress while running. Models use a separate fixed-height virtualized list with provider filtering and an explicit Server refresh.

Authentication pages use user-facing Configure and Disconnect actions. A single-account harness shows mutually exclusive methods before configuration, then account details, a connection test, and Disconnect after authentication. Pi and OpenCode show one row per connected provider and an Add provider dialog. That dialog first searches only unconnected providers, then presents the selected provider's methods as a mutually exclusive radio list. API-key forms complete with OK; browser and command flows close automatically on success; failures remain visible with a cancellable cleanup action.

## Conversation workspace

One shared conversation shell serves every Agent:

```text
AgentChatWorkspace
  ├─ CommonChatHeader
  ├─ CanonicalTimeline
  │   ├─ CommonTimelineItem
  │   └─ ProviderTimelineExtension
  ├─ CommonComposer
  └─ SharedPanels
```

The common experience includes drafts, attachments, temporary-to-persistent Thread transitions, per-Thread scope, streaming, cancellation, retry, virtualized Timeline, scroll anchoring, position restoration, unread state, search, navigation, reasoning, plans, tools, commands, diffs, terminals, approvals, artifacts, and failure recovery.

Harness-specific UI is limited to discriminated Timeline extensions, header actions, model settings, permission details, and genuine harness capabilities. Codex remains the fidelity reference, but Claude, Pi, OpenCode, and ACP reuse the same shell rather than cloning it.

Canonical Timeline history and ordered live updates are consumed directly through `@cypheria/client`. A framework-independent controller handles pagination, reconnection, gap recovery, send, steer, native Codex queueing, cancellation, and interactions; React subscribes through `useSyncExternalStore`. Codex uses a dedicated workspace, while other Agents use the common Thread workspace until they receive specialized extensions.

## Desktop-local settings

Electron stores local preferences in `userData/config.json`:

- appearance, language, font, density, and layout;
- shortcuts, sound, window bounds, and panel state;
- Server auto-start, executable, and preferred port;
- browser, update, tray, and OS-integration behavior.

The General settings page groups local preferences under General, Composer, Popout Window, and Notifications. General includes the default folder for tasks without a project (`~/Documents/Cypheria` unless changed), dynamically discovered local file opening applications, UI language, menu bar presence, bottom panel control, terminal placement, sleep prevention, and plugin availability. Composer includes plain text input, context window usage, the three Enter send modes, and follow-up behavior. Popout Window includes its global shortcut and standalone chat default. Notifications includes turn completion mode, permission and question alerts, plus Default and Classic bundled sounds, None, sounds discovered from macOS, and a custom sound file picker. Selecting a sound plays a preview; selecting None stops any preview. The plugin availability switch also updates Codex's process-wide `plugins` experimental feature through Server.

Shared Agent, model, integration, Web3, and Server behavior belongs in Cypheria Server configuration or the database. UI preferences are not written to Codex configuration.

## dApp and Web3 boundary

Each dApp origin receives an isolated session partition and scoped provider permissions. Electron owns the `WebContents`, navigation policy, popups, downloads, and injection boundary. Provider requests are forwarded to Server Web3 APIs; signing and policy evaluation remain in the privileged Server runtime.

## Cross-platform requirements

macOS, Windows, and Linux are first-class targets. Platform-specific code stays in Electron main or packaging scripts and must preserve:

- native path, process, and signal behavior;
- window and tray conventions;
- code signing and update boundaries;
- native module rebuilding, including `node-pty`;
- Server executable discovery and log access.

Changes to Sidebar or conversation behavior require interaction tests and visual review. Packaging validation must cover all three desktop platforms before release.
