---
title: Desktop
---

# Desktop

`apps/desktop` is Cypheria's primary client. It combines Electron main and preload processes with a TanStack Start renderer and preserves the dense, workspace-oriented Sidebar and conversation experience. It does not share its application shell with Expo.

## Process boundary

- Electron main owns windows, application lifecycle, Server management, desktop settings, secure storage, updates, native menus, OS integration, and browser guest hardening: webview attachment, browser profiles, popups, navigation, automation, and the dApp provider boundary.
- File → New Window (`CmdOrCtrl+Shift+N`) opens another window with the same layout as the first. Every window is a full client of the Server under the Desktop's one client ID, and the Server keeps windows only as in-memory connections that register again after a reconnect or restart. The primary window, the first of a launch, keeps Thread panel layouts across launches, receives deep links, and on macOS hides when closed; additional windows keep their layout in memory and close for good.
- Preload exposes a narrow typed IPC surface for Electron-only capabilities.
- The TanStack renderer uses `@cypheria/client` directly for shared product state and live Agent turns.
- Browser tabs are sandboxed `<webview>` guests hosted by a window's renderer. Electron main chooses each guest's preload; the dApp preload exposes a scoped provider bridge only to the top-level frame of a secure origin and never exposes Node.js or key material.

Browser guests and popups keep `nodeIntegration` off, `contextIsolation`, sandbox, and web security on.

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

The renderer stores Projects, Sections, Project memberships, and Section memberships in eager TanStack DB Query Collections. The active Thread collection uses on-demand synchronization. Live queries derive the Sidebar view from these normalized resources, while Server notifications apply direct writes for cross-window and external changes. Domain actions such as move, reorder, pin, and unpin remain explicit Cypheria RPCs because they update multiple ordered resources atomically. Query cancellation is forwarded to the shared client request signal, and reconnect or mutation recovery can refetch all Sidebar collections without returning to interval polling.

The established interaction model is a product invariant:

- Pinned, custom Sections, Projects, and recents keep their hierarchy and visual density.
- Project Threads remain nested and support expansion, pagination, and “show more”.
- Selection, create, rename, archive, delete, pin, unpin, drag, cross-Section move, and reorder remain available where the protocol permits.
- Context menus, keyboard navigation, unread state, and running state remain visible.
- Loading, empty, error, and optimistic states preserve layout and roll back failed mutations.

The Project editor exposes the ordered workspace-root template. The first root is the Project primary directory. Saving changes only the Project; existing Threads keep their own roots. A Thread Summary lists its workspace directories, identifies the current working directory, silently applies safe additive Project roots while idle, and offers **Sync to project workspace directories** for every other difference. The confirmation makes a cwd change prominent and lists added and removed roots. Sidebar menu and drag moves use the same warning before changing Project membership. Active turns and Agents without the required cwd/root capability disable these mutations.

Pinned and custom Sections render their Server-defined mixed order, so Projects and standalone Threads remain interleaved. Sidebar drag and drop uses dnd-kit and sends the corresponding `before...` placement hint for Sections, Projects, Project Threads, and mixed Section items. Priority sorting orders unread, attention-required, running, then recently updated Threads. Thread rows expose running, failed, and stopped runtime state without opening the conversation.

Query keys and optimistic updates are based on Cypheria IDs. Harness session IDs never replace Thread IDs in navigation or cache identity.

## Page headers

Desktop does not reserve a global titlebar above every route. A route that needs the shared chrome renders `PageHeader` itself and supplies its own children; a route that does not need a header fills the content area from the top. `PageHeader` owns the standard 44-pixel geometry, Electron drag region, and animated leading inset that keeps route content coordinated with the Sidebar's expanded and collapsed titlebar controls.

Conversation workspaces intentionally do not use `PageHeader`. Their chrome is split between the conversation `ChatHeader` and the right `ChatPanel` workspace header, as described in [Conversation UI](../design/conversation-ui.md#top-title-bar). The conversation header participates in the same Sidebar inset transition, while the right header carries its tab strip, tab launcher, and full-screen action without a bottom border. Bottom-panel and side-panel toggles remain fixed at the right edge of the window header; when the side panel is hidden, the conversation header expands beneath that area while reserving space for both controls.

## Settings navigation

Settings and the workspace use the same resizable Desktop sidebar shell, titlebar geometry, compact horizontal gutters, collapse behavior, and width state; only their navigation content differs. Settings uses one flattened, virtualized navigation list. The back row, group labels, ordinary settings items, the expandable Agent harnesses row, and all visible Agent child rows share one scroll container and one TanStack Virtual virtualizer. Search and the theme footer stay outside that container. Expansion, search, and registry membership changes rebuild the flat row model; route changes scroll the active item into view. Agent child rows never introduce a nested scroller or second navigation virtualizer. The Agent harnesses parent is an expand control rather than a page and is never active. Its children are the harnesses in the user's Agent registry; the four native harnesses are registered during Server initialization.

The add action on the Agent harnesses row is disabled when every catalog harness has already been registered. Otherwise it opens an edge-aligned picker whose options include each harness description and installable version. Selecting an option adds the Agent registry record and opens its settings immediately. Child rows show gray, yellow, green, or blue status dots for uninstalled, installed-but-disabled, enabled but stopped, or running Agents, respectively. For Agents with multiple session runtimes, blue remains visible while any runtime is active; Claude uses its active queries. The Agent list refreshes every five seconds while Settings is open so runtime status stays current. A menu removes an uninstalled Agent from the registry. Agent harness routes use `/settings/agent-harnesses/$agentId/$sectionId`. The header shows the current version; an uninstalled harness places its Install action and percentage progress inside the installation notice. An installed but disabled harness replaces section content with an Enable notice and disables its section navigation. Installed harnesses expose Restart and a destructive Uninstall item in the maintenance menu. Restart requires warning confirmation because it forcibly stops the harness, closes its active threads, and interrupts in-progress work before starting it again. Uninstall keeps the row in navigation and returns it to the Install notice. The colored Update button expands to show percentage progress while it runs; like Install, it restores active progress and failures from the shared operation list after navigation. The Uninstall confirmation uses a labeled destructive button and shows progress there. Native and registry harnesses expose Update when the shared semantic-version comparison reports that the currently available catalog version is newer than the installed version. For a native harness, the available version is the exact version in Cypheria's tested native harness manifest. Operation state is isolated by Agent so installing, updating, or uninstalling one harness does not disable another. The selected Agent owns a second-level section menu; on narrow screens it becomes a selector. Codex has Authentication and a consolidated Settings page for permissions, model defaults, and features. Other harnesses retain Models and discovered settings categories. The right panel contains the actual section. A single collapsed Network proxy card remains above the Agent header and configures the Server-owned settings shared by every Agent without returning credentials to the renderer. A second collapsed card directly below it lists Node.js, Python, and uv toolchains managed for Agent harnesses. It omits pinned-version and up-to-date labels; available install or update actions use icon buttons that expand to percentage progress while running. Other harness Models pages use a separate fixed-height virtualized list with provider filtering and an explicit Server refresh. The Codex Settings model list reads App Server `model/list`; its Set default action appears on hover or keyboard focus. Settings changes save immediately, and the list can be refreshed explicitly.

Authentication pages use user-facing Configure and Disconnect actions. A single-account harness shows mutually exclusive methods before configuration, then account details, a connection test, and Disconnect after authentication. Pi and OpenCode show one row per connected provider and an Add provider dialog. That dialog first searches only unconnected providers, then presents the selected provider's methods as a mutually exclusive radio list. API-key forms complete with OK; browser and command flows close automatically on success; failures remain visible with a cancellable cleanup action.

Codex Agent settings edit native model and permission defaults through App Server. The composer permission menu is separate: it always contains the four modes documented in [Codex Permissions](../agents/codex-permissions.md), stores the new-chat selection in Server configuration, and stores an existing chat's selection in that Thread's authoritative configuration.

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

Workspace files open in the right panel as tabs, one per file. The **Open file** tab shows the workspace tree of the selected Thread's roots, and choosing a file there, in the tree beside an open file, from a link in a reply, or with **Open in tab** in Review opens that file in its own tab, scrolled to the linked line. A file tab shows the file's breadcrumb, source or preview, editing, Go to line, and the toggleable workspace tree with its root chooser. **Show git blame** adds each line's author and date to the gutter, labeling the first line of every run from one commit, with the author, commit, date, and summary on hover. The copy menu copies the absolute path, the path relative to the repository or to the Thread folder, the file contents, and, for a GitHub origin, a link to the file on the upstream or default branch, which **Open in GitHub** also opens. The tree keeps `@pierre/trees` and loads only direct children when a root or directory is opened, with request coalescing, cancellation, paginated Server reads, targeted notification refresh, and cancellable name/path search. Text writes use opaque versions. Binary previews use the protocol binary stream rather than embedding bytes in JSON. Delete moves an item to Server quarantine and exposes one-step restore; lifecycle deletion of a projectless workspace is separate. Open file tabs are part of the right panel layout; root selection, expanded directories, tree visibility, and tree width are Desktop-local per-Thread state.

Projectless Threads use one managed root laid out as `<projectless folder>/<YYYY-MM-DD>/<name>/`, using the Server's local date. `<name>` is the first six ASCII words of the opening message joined by `-` (at most 80 characters, `new-chat` when there are none), numbered `-2`, `-3`, and so on when the name is taken. Its immediate purpose directories are `work/` and `outputs/`. The root itself is the Thread cwd; those two children are not additional roots. The General setting for the projectless folder is synchronized to the local Server and affects future managed workspaces. Residual managed directories are only removed through explicit cleanup operations.

Agent replies may carry references that Desktop turns into interactions. Every path an Agent writes is a path on the Server host, so Desktop never opens one itself: `thread.paths.resolve` maps it to a Thread root, a file tab opens it, and `thread.files.read` supplies the bytes. A Markdown link to a file opens it in its own tab at the linked line, and a link to a directory shows that directory in the Open file tab; a Markdown image shows an image, audio clip, or video that lives under a Thread root, as an object URL released when it leaves the screen. A path outside the roots, or a file too large to preview, is shown as unavailable and never read. The directives `::code-comment{…}`, `:codex-followup[…]{prompt="…"}`, and `::created-thread{…}` render as a comment card that opens its file, a follow-up chip that sends its prompt as the next message, and a link to the created chat. Anything that merely resembles a directive stays text. Web links keep the default link handling, and `cypheria://review` links open that pull request in the conversation's Pull request panel. A client that cannot render these shows the same Markdown as readable text.

Git appears in the conversation header's branch button, the Review panel, and the Git, Worktrees, and Code Review settings pages; [Git](../features/git.md) describes them. Pull requests and merge requests open in the **Code Review** page from the Sidebar and in the conversation's **Pull request** panel; see [Code Review](../features/code-review.md).

Other applications reach Desktop through the `cypheria://` scheme, which Desktop registers with the operating system. `cypheria://threads/<threadId>` opens a Thread, `?view=review` also opens its Review panel, and `cypheria://review?pr=<url>&path=<file>&line=<n>&side=<left|right>` opens that pull request in the Pull request panel of the Thread on screen. Desktop accepts only these two forms with an `https` pull request URL and routes them inside the renderer; `cypheria://app/` stays the renderer's own origin. A link that arrives before the window can receive it waits until the renderer asks.

The common experience includes drafts, attachments, temporary-to-persistent Thread transitions, per-Thread scope, streaming, cancellation, retry, virtualized Timeline, scroll anchoring, position restoration, unread state, search, navigation, reasoning, plans, tools, commands, diffs, terminals, approvals, artifacts, and failure recovery.

The terminal panel subscribes to the selected Thread's shared [terminal directory](../server/terminals.md). Remote creations add background tabs without changing local focus or panel visibility; hiding or unmounting the panel only releases stream subscriptions. A not-yet-persisted draft cannot create a terminal. Interactive authentication reuses the stream renderer for its private terminal without adding a workspace tab.

Harness-specific UI is limited to discriminated Timeline extensions, header actions, model settings, permission details, and genuine harness capabilities. Codex remains the fidelity reference, but Claude, Pi, OpenCode, and ACP reuse the same shell rather than cloning it.

The composer owns shared `ChatModelSelector` and `ChatContextUsage` presentation components. The selector combines Agent, model, reasoning effort, and speed while hiding dimensions the selected Agent does not advertise. Before the first message, changing Agent changes the new Thread runtime; an existing Thread keeps its Agent identity. A new chat also has a project selector with an explicit clear action. For a project whose first root is a Git repository, the user can check **Worktree** and select a local or remote starting branch. On first submit Desktop creates the managed worktree, creates the project Thread, moves and attaches the Thread to the worktree before starting its first turn, and rolls back newly created resources if setup fails. Other Project roots continue to be accessed directly. Existing Threads do not expose these creation controls. The context control is a compact meter with a detailed hover card whose rows vary for Codex, Claude, Pi, OpenCode, and ACP and whose source label distinguishes reported, queried, derived, and estimated values. The Chat Demo exposes both components and lets developers switch among every rendering variant without a live Agent.

The shared `ChatComposerEditor` uses Tiptap/ProseMirror for rich text and selected semantic references. The Server supplies and validates `@` and `$` candidates; Desktop handles its executable `/` commands. Selected references become ordered protocol input blocks, while unselected trigger text stays text. `ChatComposerAttachmentList` keeps binary and other context outside the editor document with controlled status, removal, and reordering. Desktop's explicit plain-text preference retains the textarea path. For ownership, upload, and Agent mapping details, see [Composer Inputs and References](composer.md).

Canonical Timeline history and ordered live updates are consumed directly through `@cypheria/client`. A framework-independent controller handles pagination, reconnection, gap recovery, send, steer, native Codex queueing, cancellation, and interactions; React subscribes through `useSyncExternalStore`. Codex uses a dedicated workspace, while other Agents use the common Thread workspace until they receive specialized extensions.

The Codex workspace applies a Desktop-only render split after Canonical Timeline projection, without changing stored items or inventing App Server item types. It keeps user input, interim commentary, consecutive tool or subagent activity, plan, diff, final answer, and post-answer notices as distinct virtual rows. The latest turn tracks only its current synchronous commentary; asynchronous delivery or a question clears that marker. A final answer can precede completed trailing activity in source order, so the split looks past finished commands and tools and renders the answer after the process group. Pending approvals remain in the composer interaction surface, while goal, queue, usage, and other runtime state stay outside history. A Codex MCP elicitation identified by its metadata as a Computer Use app request additionally displays a screenshot/access disclosure and high-risk badge when applicable; it does not become a timeline item. The shared `ChatTurnGroup` is presentation-only; the development Chat Demo uses the same splitter in a two-turn fixture and includes a Computer Use request sample alongside its 128-message virtualized transcript.

## Codex Summary overview

Codex has an independent Summary overview opened from the conversation header, separate from the right-panel tabs. It can float over the conversation or be pinned, reserving space according to the measured conversation width (overlay below 1096 px, partial shift through 1536 px, gutter above that). Right-side detail tabs and the bottom panel remain independent. Open, pinned, and expanded-section state are stored per Thread in Desktop client KV under `thread-summary-ui:<threadId>`; hidden content is inert and closing returns focus to the header toggle.

The overview composes real data only: Outputs, Sources, Subagents, and the latest Plan come from the Server's full-history [Thread Summary projection](../server/protocol.md#canonical-timeline); native background processes use the Codex facade; thread terminals use the shared terminal directory; linked PRs use Thread Attachments; Schedules target the current Thread; Browser lists the Desktop's thread-scoped built-in tabs. Rows open the relevant existing detail tab or route. A failed source reports its own error without hiding other sections. Environment, Usage, Computer Use, external Chrome Browser Use, created tasks without origin linkage, and side chats without thread linkage are not Summary sections.

## Desktop-local settings

Electron stores Desktop-private preferences as version-1 values in `userData/kv.sqlite`. Semantic keys have no product or platform prefix. Appearance, `localeOverride`, General, Composer, Panel, Notifications, Sidebar, Git UI, and unread activity each have narrow schemas. Jotai owns renderer state; temporary form edits remain component state until confirmed. Electron main reads appearance and locale before creating a window and applies menu, sleep, notification, and sound side effects for the relevant keys. OS operations such as picking a directory or sound remain narrow IPC calls.

The General settings page groups local preferences under Permissions, General, Composer, and Notifications. General includes the folder for tasks without a project, which is a path on the Server's host stored in Server configuration as `workspace.projectlessRoot` (empty uses `~/Documents/Cypheria` there), dynamically discovered local file opening applications, UI language, menu bar presence, bottom panel control, terminal placement, and sleep prevention. Composer includes plain text input, context window usage, the three Enter send modes, and follow-up behavior. Notifications includes turn completion mode, permission and question alerts, plus Default and Classic bundled sounds, None, sounds discovered from macOS, and a custom sound file picker. Selecting a sound plays a preview; selecting None stops any preview. Codex plugin availability is configured in Codex Settings and stored by Codex; see [Codex Configuration](../agents/codex-config.md).

Shared Agent, model, integration, Web3, and Server behavior belongs in Cypheria Server configuration or the database. UI preferences are not written to Codex configuration.

Other local UI state, rebuildable replicas, and attachment bytes use the shared [Client Storage](client-storage.md) ports. Electron main owns the Desktop SQLite key/value and replica databases as well as attachment files; the renderer reaches them only through validated preload IPC. These stores remain separate from the authoritative Server database.

Composer text and ordered attachment metadata are stored under `composerDraft:<threadId>` for an existing Thread and the fixed `composerDraft:new` key for every not-yet-created chat, with a 250 ms debounce and page-hide flush. No draft identity is carried in route search. When the Server creates a Thread, Desktop moves the shared new-chat draft to that Thread's key. File-picker inputs use Electron `webUtils.getPathForFile()` and main-process direct copy; only clipboard, pasted-text, screenshot, and other already in-memory sources use the bounded byte path. Failed submissions retain the complete draft. Missing binary data remains visibly unavailable and cannot be submitted.

Timeline message menus are derived from the Server's per-boundary capabilities. A `turn-user` message may show **Rewind to here** and **Fork in new chat**; an `assistant-final` message may show Fork; steer messages, streaming or unsuccessful assistant messages, tools, reasoning, and other items show neither. Rewind asks before replacing a non-empty draft and writes the returned input blocks only after the Server operation succeeds. User-message Fork writes those blocks to the new Thread draft; assistant and thread-head Fork start with an empty composer. Related actions and submission are locked while a branch operation is pending.

The primary window stores changed Thread layouts under `panelLayout:<threadId>`, including right and bottom visibility and sizes, right-tab state, full-screen state, and focus. A new Thread uses fixed code defaults and creates no layout value until the user changes the workspace. Additional windows keep layout in memory only. Unsupported restored tabs are filtered.

Development builds expose a `/debug` route and a development-only sidebar entry. Its compact split view browses key/value state, replica rows, and attachment bytes with search, keyset pagination, bounded text previews, and bounded binary prefixes. The route redirects to the main workspace outside Desktop development mode and is not shown in production navigation.

## Browser and dApp boundary

Every window may host the built-in browser. Third-party notices for adapted browser code are in `NOTICE`.

### Tabs and profiles

Every browser tab, web or dApp, belongs to exactly one Thread and appears in that Thread's Browser panel, where the user opens web and dApp tabs; there is no browser outside a Thread. Deleting a Thread closes its tabs; each connection to the Server also closes tabs whose Thread no longer exists, covering deletions Desktop missed. The device-local tab index lives in Desktop client KV, is shared by every window, and keeps the newest 200 tabs; a corrupt record is dropped on its own. Page state lives in each window's own guest for a tab. A window reports to the Server the tabs it has started plus restored tabs no window has started yet, which the earliest registered window then takes; when one window closes a tab, the others drop their guests for it. Guests are kept in one fixed-position host outside React panes: a visible pane positions its active tab over itself, and hidden tabs are parked at 1×1 so pages keep running and can still be driven by an Agent. Restored tabs load from their saved URL when first shown or automated. The composer `@` menu lists the Thread's open tabs.

Each tab has a kind. Web tabs share the `persist:cypheria-browser` profile and never receive a wallet. dApp tabs share the separate `persist:cypheria-dapp-browser` profile. Switching a tab's kind rebuilds its guest because a profile cannot change after a guest attaches. Electron main rejects any other partition or preload, denies device permissions, blocks non-HTTP(S) navigation, opens `window.open` popups that need `window.opener` as sandboxed windows without a preload, and turns other new-window requests into tabs of the same kind. The address bar focus and reload shortcuts are reserved in the guest; other keys stay with the page.

### Agent control

Electron main and every window connect under the one client ID that Desktop keeps for the Cypheria home, so the Server joins them into one session. Each window registers its own browser host with the `iab` and `mcpapps` backends and answers [Computer Use](../features/computer-use.md#hosts) browser requests for the calling Thread's tabs and the MCP Apps it shows. The window keeps tab lifecycle: listing, opening, closing, the selected tab, the `visibility` capability, which opens or hides the Thread's browser pane, and the `viewport` capability, which fixes the size of the Thread's tabs until it is reset. Page members go to Electron main, which drives each guest with the shared `@cypheria/cua` engine over its `webContents.debugger`: accessibility state with numeric element indices, trusted input, Playwright locators, screenshots from the guest's rendered frames, dialogs that wait for the model, console logs, file choosers, and downloads saved to the Downloads folder. Uploads accept only files inside the Thread's working directory after resolving symlinks. MCP Apps run on the DOM-only engine in the App's sandbox frame with synthetic events. Electron main registers the device's computer host; requests for the device's Chromium browsers (`chrome`) and native apps reach it directly. It drives the browsers with the implementation selected in Settings → General → Computer Use → Browser connection, which only this device knows: the Cypheria extension, whose native host it installs and listens for (see [Browser extension](../features/browser-extension.md)), or `cdp`, attaching to running browsers that allow remote debugging. It operates native apps with the backend selected under Desktop app control: the cua-driver daemon it hosts, with the macOS permissions it requests, or the Computer Use runtime of the installed ChatGPT on macOS, whose app approvals it forwards to the Thread; see [Computer Use](../features/computer-use.md#desktop-apps). Settings → General → Computer Use shows the switches, the connected browser profiles, and this device's permissions. The Server contract is in [Protocol](../server/protocol.md#computer-use-hosts).

### dApp tabs

Wallet permissions and sessions remain per origin. Electron main derives the scope of each provider request from the sending frame's origin, rejects subframes and mismatched session keys, and opens the Server dApp session the first time an origin uses the provider. Provider events reach every dApp tab currently showing that origin. Cross-site cookies are removed from dApp-profile requests and responses; this does not cover `document.cookie` access inside third-party frames, and partitioned (CHIPS) cookies are removed as well. Clearing a site's data removes its storage from the dApp profile without revoking wallet permissions. Signing and policy evaluation remain in the privileged Server runtime, and signing intents from dApp tabs keep the `dapp` source even when an Agent drives the page.

## Cross-platform requirements

macOS, Windows, and Linux are first-class targets. Platform-specific code stays in Electron main or packaging scripts and must preserve:

- native path, process, and signal behavior;
- window and tray conventions;
- code signing and update boundaries;
- native module rebuilding, including `node-pty`;
- Server executable discovery and log access.

Changes to Sidebar or conversation behavior require interaction tests and visual review. Packaging validation must cover all three desktop platforms before release.
