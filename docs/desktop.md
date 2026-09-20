# Desktop

`apps/desktop` is Cypheria's primary client. It combines Electron main and preload processes with a TanStack Start renderer and preserves the dense, workspace-oriented Sidebar and conversation experience. It does not share its application shell with Expo.

## Process boundary

- Electron main owns windows, application lifecycle, Server management, desktop settings, secure storage, updates, native menus, OS integration, and isolated dApp browser views.
- Preload exposes a narrow typed IPC surface for Electron-only capabilities.
- The TanStack renderer uses `@cypheria/client` for shared product state and the AI SDK providers for live Agent turns.
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

## Settings navigation

Settings uses one flattened, virtualized navigation list. The back row, group labels, ordinary settings items, the expandable Agent harnesses row, and all visible Agent child rows share one scroll container and one TanStack Virtual virtualizer. Search and the theme footer stay outside that container. Expansion, search, and registry updates rebuild the flat row model; route changes scroll the active item into view. Agent child rows never introduce a nested scroller or second navigation virtualizer.

Agent harness routes use `/settings/agent-harnesses/$agentId/$sectionId`. The selected Agent owns a second-level section menu for installation, authentication, models, and discovered settings categories; on narrow screens it becomes a selector. The right panel contains the actual section. Network proxy remains above the Agent header, starts collapsed, and retains its expanded state while the Agent or section changes. Models use a separate fixed-height virtualized list with provider filtering and an explicit Server refresh.

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

Canonical Timeline history is loaded through `@cypheria/client`. AI SDK streams provide responsive live updates, but do not become a second durable history store.

## Desktop-local settings

Electron stores local preferences in `userData/desktop-settings.json`:

- appearance, language, font, density, and layout;
- shortcuts, sound, window bounds, and panel state;
- Server auto-start, executable, and preferred port;
- browser, update, tray, and OS-integration behavior.

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
