---
title: Desktop
---

# Desktop

`apps/desktop` is Cypheria's primary client. It combines Electron main and preload processes with a TanStack Start renderer and preserves the dense, workspace-oriented Sidebar and conversation experience. It does not share its application shell with Expo.

## Process boundary

- Electron main owns windows, application lifecycle, Server management, desktop settings, secure storage, updates, native menus, OS integration, and browser guest hardening: webview attachment, browser profiles, popups, navigation, automation, and the dApp provider boundary.
- Preload exposes a narrow typed IPC surface for Electron-only capabilities.
- The TanStack renderer uses `@cypheria/client` directly for shared product state and live Agent turns.
- Browser tabs are sandboxed `<webview>` guests hosted by the main window renderer. Electron main chooses each guest's preload; the dApp preload exposes a scoped provider bridge only to the top-level frame of a secure origin and never exposes Node.js or key material.

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

The Project editor exposes the ordered workspace-root template. The first root is the Project primary directory. Saving changes only the Project; existing Threads keep their own roots. A Thread Summary lists its workspace directories, identifies the current working directory, silently applies safe additive Project roots while idle, and offers **Sync to project workspace directories** for every other difference. The confirmation makes a cwd change prominent and lists added and removed roots. Sidebar menu and drag moves use the same warning before changing Project membership. Active turns and Agents without the required cwd/root capability disable these mutations.

Pinned and custom Sections render their Server-defined mixed order, so Projects and standalone Threads remain interleaved. Sidebar drag and drop uses dnd-kit and sends the corresponding `before...` placement hint for Sections, Projects, Project Threads, and mixed Section items. Priority sorting orders unread, attention-required, running, then recently updated Threads. Thread rows expose running, failed, and stopped runtime state without opening the conversation.
- Context menus, keyboard navigation, unread state, and running state remain visible.
- Loading, empty, error, and optimistic states preserve layout and roll back failed mutations.

Query keys and optimistic updates are based on Cypheria IDs. Harness session IDs never replace Thread IDs in navigation or cache identity.

## Page headers

Desktop does not reserve a global titlebar above every route. A route that needs the shared chrome renders `PageHeader` itself and supplies its own children; a route that does not need a header fills the content area from the top. `PageHeader` owns the standard 44-pixel geometry, Electron drag region, and animated leading inset that keeps route content coordinated with the Sidebar's expanded and collapsed titlebar controls.

Conversation workspaces intentionally do not use `PageHeader`. Their chrome is split between the conversation `ChatHeader` and the right `ChatPanel` workspace header, matching the Chat Demo reference. The conversation header participates in the same Sidebar inset transition, while the right header carries its tab strip, tab launcher, and full-screen action without a bottom border. Bottom-panel and side-panel toggles remain fixed at the right edge of the window header; when the side panel is hidden, the conversation header expands beneath that area while reserving space for both controls.

## Settings navigation

Settings and the workspace use the same resizable Desktop sidebar shell, titlebar geometry, compact horizontal gutters, collapse behavior, and width state; only their navigation content differs. Settings uses one flattened, virtualized navigation list. The back row, group labels, ordinary settings items, the expandable Agent harnesses row, and all visible Agent child rows share one scroll container and one TanStack Virtual virtualizer. Search and the theme footer stay outside that container. Expansion, search, and registry membership changes rebuild the flat row model; route changes scroll the active item into view. Agent child rows never introduce a nested scroller or second navigation virtualizer. The Agent harnesses parent is an expand control rather than a page and is never active. Its children are the harnesses in the user's Agent registry; the four native harnesses are registered during Server initialization.

The add action on the Agent harnesses row is disabled when every catalog harness has already been registered. Otherwise it opens an edge-aligned picker whose options include each harness description and installable version. Selecting an option adds the Agent registry record and opens its settings immediately. Child rows show gray, yellow, green, or blue status dots for uninstalled, installed-but-disabled, enabled but stopped, or running Agents, respectively. For Agents with multiple session runtimes, blue remains visible while any runtime is active; Claude uses its active queries. The Agent list refreshes every five seconds while Settings is open so runtime status stays current. A menu removes an uninstalled Agent from the registry. Agent harness routes use `/settings/agent-harnesses/$agentId/$sectionId`. The header shows the current version; an uninstalled harness places its Install action and percentage progress inside the installation notice. An installed but disabled harness replaces section content with an Enable notice and disables its section navigation. Installed harnesses expose Restart and a destructive Uninstall item in the maintenance menu. Restart requires warning confirmation because it forcibly stops the harness, closes its active threads, and interrupts in-progress work before starting it again. Uninstall keeps the row in navigation and returns it to the Install notice. The colored Update button expands to show percentage progress while it runs; like Install, it restores active progress and failures from the shared operation list after navigation. The Uninstall confirmation uses a labeled destructive button and shows progress there. Native and registry harnesses expose Update when the shared semantic-version comparison reports that the currently available catalog version is newer than the installed version. For a native harness, the available version is the exact version in Cypheria's tested native harness manifest. Operation state is isolated by Agent so installing, updating, or uninstalling one harness does not disable another. The selected Agent owns a second-level section menu; on narrow screens it becomes a selector. Codex has Authentication and a consolidated Settings page for permissions, model defaults, and features. Other harnesses retain Models and discovered settings categories. The right panel contains the actual section. A single collapsed Network proxy card remains above the Agent header and configures the Server-owned settings shared by every Agent without returning credentials to the renderer. A second collapsed card directly below it lists Node.js, Python, and uv toolchains managed for Agent harnesses. It omits pinned-version and up-to-date labels; available install or update actions use icon buttons that expand to percentage progress while running. Other harness Models pages use a separate fixed-height virtualized list with provider filtering and an explicit Server refresh. The Codex Settings model list reads App Server `model/list`; its Set default action appears on hover or keyboard focus. Settings changes save immediately, and the list can be refreshed explicitly.

Authentication pages use user-facing Configure and Disconnect actions. A single-account harness shows mutually exclusive methods before configuration, then account details, a connection test, and Disconnect after authentication. Pi and OpenCode show one row per connected provider and an Add provider dialog. That dialog first searches only unconnected providers, then presents the selected provider's methods as a mutually exclusive radio list. API-key forms complete with OK; browser and command flows close automatically on success; failures remain visible with a cancellable cleanup action.

Codex Agent settings edit native model and permission defaults through App Server. The composer permission menu is separate: it always contains the four modes documented in [Codex Permissions](codex-permissions.md), stores the new-chat selection in Server configuration, and stores an existing chat's selection in that Thread's authoritative configuration.

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

The ownership and backend-selection rules for this experience are in [Local Git design](git.md); pull requests and merge requests are in [Code Review](code-review.md).

For a conversation with a local working directory, the Codex Review panel reads the repository through the Server Git API. It shows staged and unstaged files and text diffs plus committed branch changes from the merge base with the default branch. Branch diffs use a pinned HEAD and reject stale reads after HEAD moves. The panel offers repository initialization, branch creation and switching, file staging, unstaging, commit, push, and managed worktree creation, deletion, and restoration. Branch selection searches recent local and remote refs; selecting a remote ref creates a local tracking branch. Worktree deletion requires a clean worktree and saves its committed HEAD for restoration in the panel. The panel follows the thread working directory when available and refreshes local status while open.

The unstaged Review source also renders text diffs for untracked regular files before they are staged.

A Thread whose working directory is inside a repository shows its branch in the conversation header. The branch button opens a popover to commit (with a typed or generated message and an option to include unstaged changes), commit and push, or push; when the branch has a pull request, found through the Thread's attachments or through Code Review, the header shows its number and state with a menu that offers View PR in the Pull request panel, Open in GitHub or GitLab, Copy link, and Add to chat; otherwise Create PR fills the composer with a request to open one. The popover and the Review panel use the same Server Git API and commit code.

Other applications reach Desktop through the `cypheria://` scheme, which Desktop registers with the operating system. `cypheria://threads/<threadId>` opens a Thread, `?view=review` also opens its Review panel, and `cypheria://review?pr=<url>&path=<file>&line=<n>&side=<left|right>` opens that pull request in the Pull request panel of the Thread on screen. Desktop accepts only these two forms with an `https` pull request URL and routes them inside the renderer; `cypheria://app/` and `cypheria://media/` stay the renderer's own origins. A link that arrives before the window can receive it waits until the renderer asks.

The Uncommitted source combines index and working tree changes against HEAD, including untracked files. In a repository without a first commit, it combines the staged and unstaged diffs.

The Commit source lists recent commits and compares a selected commit with its first parent, or with the empty tree for the root commit. File diffs use pinned commit hashes, so later working tree changes do not alter that review.

For local Codex turns, Server snapshots the repository's non-ignored files through a temporary Git index before and after the turn. It pins both trees under `refs/cypheria/turn-diffs` and stores the latest completed capture under `CYPHERIA_HOME/git-turn-diffs`. The Last turn source reads these trees, including untracked files, without changing the real index. Captures are best effort; a turn still runs if its Git snapshot fails.

Staged and unstaged Review files have a Server-issued revision. Whole-file and individual text-section stage or unstage actions refresh and compare that revision before changing the index; stale actions fail and refresh the Review. The unstaged source also supports confirmed whole-file and text-section revert. Before reverting, Server saves the original file or symlink under `CYPHERIA_HOME/git-review-undo`; the panel lists saved reverts after a restart and offers Undo. Undo rejects a file changed after revert. New, deleted, and binary files remain whole-file actions.

Review shows changed files in the same file tree component as the workspace tree, with Git status colors, added and removed line counts, review-comment counts, and a filter. Beside it, or above it in a narrow panel, the selected file's diff uses the shared diff options and Viewed marks described below; stage, unstage, and revert actions for a text section sit at the start of that section. `::code-comment` findings in the Agent's replies also appear under their lines, labeled with the Agent's name, count toward the file tree's comments, and can be dismissed from the diff while they stay in the conversation. Pressing the add button beside a line, or after selecting a range on one side, writes a review comment; pending comments stay with the Thread until **Send to Agent** sends them as one message naming each file by absolute path and line or line range. Commit, branch, and worktree controls are collapsible sections below the diff. Review also offers path copying, inserting a path mention into the chat composer, **Open in tab** for the file's workspace tab, opening an existing repository file in the default application, and saving a copy. Electron main resolves the file and checks that it remains a regular file inside the discovered repository before opening or copying it. The commit controls can include unstaged changes, record co-authors, and commit then push; a failed push leaves the successful commit in place and can be retried separately.

All six Review sources support case-insensitive path filtering and an ignore-whitespace display option. Branch Review lets the user choose a local or remote base branch. Server provides per-file added and deleted line counts from Git's NUL-delimited numstat output; the panel shows counts for visible files and their total. The ignore-whitespace option also filters these counts. It hides section-level mutations because filtered hunks cannot safely identify raw patch sections; whole-file actions still use the unchanged file revision. Binary and untracked files omit line counts.

These Git operations belong to the clients. Agents use `git` and `gh` themselves and read pull request checks through the bundled `code-review` plugin; see [Cypheria app tools](integrations.md#cypheria-app-tools).

Pull requests and merge requests open in the **Code Review** page from the Sidebar and in the conversation's **Pull request** panel. Both host the Code Review MCP App and need a ChatGPT sign-in with GitHub or GitLab connected; their behavior, including Watch and fix, is in [Code Review](code-review.md).

Review diffs render on the shared code viewer with syntax highlighting, word-level changes, per-file add and delete counts, and virtualized scrolling for large patches. A diff options menu chooses Auto, Split, or Unified layout (Auto splits wide views of files that both add and remove lines), word diffs, and wrapping, saved as Desktop client state; it also copies the patch as a `git apply` command. The menu can also hide hunks that only change top-level imports and hide generated files, meaning lock files, minified bundles, source maps, snapshots, and paths the repository attributes mark `linguist-generated`. Review loads full files through the Server for every source. When a working tree has more than 2,000 untracked files, Review shows tracked changes only and offers to copy an interactive `git clean` command. Jump to file searches the changed files. Each file header collapses the file and marks it Viewed; a viewed file collapses, shows a check in the file tree, and reads as unviewed again once its diff changes.

The Review panel remembers the most recently selected source in Desktop client state and falls back to unstaged changes when that source requires a thread that is not available. Pull requests can be attached to or detached from a chat through the shared Thread Attachment API. Desktop reads the Server-owned relationship, supports reverse lookup from a PR to linked chats, reacts to attachment notifications, and shows an attachment icon in the sidebar when the Git setting allows it. The same relationship is therefore visible to future Expo, Web, and CLI clients. Git settings remain in Server configuration. Server records the start and outcome of Git mutations in the shared audit log with the request ID; audit events omit paths, commit messages, and file contents.

Managed worktrees persist an optional owner Thread ID in Cypheria's worktree metadata. The Server checks that an assigned local Codex thread belongs to the same repository and currently uses that worktree. A worktree with an owner cannot be deleted until its owner moves away.

The Review panel can move an idle local Thread between its checkout and an active managed worktree. The Server rejects a move during a turn or pending interaction, asks the selected Agent adapter to change the working directory, updates worktree ownership and its Thread Attachment, and restores the prior directory if the move fails. The common path supports every Agent adapter that implements working-directory changes. The move can optionally copy local changes when both checkouts have the same HEAD and the destination is clean; the source files remain available.
When the thread starts in a repository subdirectory, the Server moves it to the same relative directory in the target worktree. It rejects missing directories and paths that resolve outside the target worktree.
The Review panel can create a detached managed worktree from `HEAD` or a selected local or remote branch. The source checkout stays on its current branch.
When creating it, Server copies ignored `AGENTS.override.md` files and ignored regular files selected by the source root's `.worktreeinclude`. It skips symlinks and existing destination files.
The Worktrees controls can include local changes and select a repository-local environment config. Creation progress, setup output, cancellation, retry, and skip-setup are shown in the Review panel. With no selected environment, setup is skipped.
For a local branch selected from a different checkout branch, the managed detached worktree records a synced-branch baseline. Review can sync committed and uncommitted worktree changes to that branch while the source checkout is clean and the branch still points to its recorded baseline. Server snapshots uncommitted changes through a temporary index, stores the previous branch commit under `refs/cypheria/worktree-sync/*`, and offers Undo. Thread moves can optionally copy staged, unstaged, and untracked regular files when both worktrees share the same HEAD and the target is clean; the source keeps its files for recovery. A setup script's safe toolchain environment changes are captured in the worktree Git directory and retained in managed metadata for restoration.

The common experience includes drafts, attachments, temporary-to-persistent Thread transitions, per-Thread scope, streaming, cancellation, retry, virtualized Timeline, scroll anchoring, position restoration, unread state, search, navigation, reasoning, plans, tools, commands, diffs, terminals, approvals, artifacts, and failure recovery.

The terminal panel subscribes to the selected Thread's shared [terminal directory](terminals.md). Remote creations add background tabs without changing local focus or panel visibility; hiding or unmounting the panel only releases stream subscriptions. A not-yet-persisted draft cannot create a terminal. Interactive authentication reuses the stream renderer for its private terminal without adding a workspace tab.

Harness-specific UI is limited to discriminated Timeline extensions, header actions, model settings, permission details, and genuine harness capabilities. Codex remains the fidelity reference, but Claude, Pi, OpenCode, and ACP reuse the same shell rather than cloning it.

The composer owns shared `ChatModelSelector` and `ChatContextUsage` presentation components. The selector combines Agent, model, reasoning effort, and speed while hiding dimensions the selected Agent does not advertise. Before the first message, changing Agent changes the new Thread runtime; an existing Thread keeps its Agent identity. A new chat also has a project selector with an explicit clear action. For a project whose first root is a Git repository, the user can check **Worktree** and select a local or remote starting branch. On first submit Desktop creates the managed worktree, creates the project Thread, moves and attaches the Thread to the worktree before starting its first turn, and rolls back newly created resources if setup fails. Other Project roots continue to be accessed directly. Existing Threads do not expose these creation controls. The context control is a compact meter with a detailed hover card whose rows vary for Codex, Claude, Pi, OpenCode, and ACP and whose source label distinguishes reported, queried, derived, and estimated values. The Chat Demo exposes both components and lets developers switch among every rendering variant without a live Agent.

The shared `ChatComposerEditor` uses Tiptap/ProseMirror for rich text and selected semantic references. The Server supplies and validates `@` and `$` candidates; Desktop handles its executable `/` commands. Selected references become ordered protocol input blocks, while unselected trigger text stays text. `ChatComposerAttachmentList` keeps binary and other context outside the editor document with controlled status, removal, and reordering. Desktop's explicit plain-text preference retains the textarea path. For ownership, upload, and Agent mapping details, see [Composer Inputs and References](composer.md).

Canonical Timeline history and ordered live updates are consumed directly through `@cypheria/client`. A framework-independent controller handles pagination, reconnection, gap recovery, send, steer, native Codex queueing, cancellation, and interactions; React subscribes through `useSyncExternalStore`. Codex uses a dedicated workspace, while other Agents use the common Thread workspace until they receive specialized extensions.

The Codex workspace applies a Desktop-only render split after Canonical Timeline projection, without changing stored items or inventing App Server item types. It keeps user input, interim commentary, consecutive tool or subagent activity, plan, diff, final answer, and post-answer notices as distinct virtual rows. The latest turn tracks only its current synchronous commentary; asynchronous delivery or a question clears that marker. A final answer can precede completed trailing activity in source order, so the split looks past finished commands and tools and renders the answer after the process group. Pending approvals remain in the composer interaction surface, while goal, queue, usage, and other runtime state stay outside history. A Codex MCP elicitation identified by its metadata as a Computer Use app request additionally displays a screenshot/access disclosure and high-risk badge when applicable; it does not become a timeline item. The shared `ChatTurnGroup` is presentation-only; the development Chat Demo uses the same splitter in a two-turn fixture and includes a Computer Use request sample alongside its 128-message virtualized transcript.

## Codex Summary overview

Codex has an independent Summary overview opened from the conversation header; it is no longer a right-panel tab. It can float over the conversation or be pinned, reserving space according to the measured conversation width (overlay below 1096 px, partial shift through 1536 px, gutter above that). Right-side detail tabs and the bottom panel remain independent. Open, pinned, and expanded-section state are stored per Thread in Desktop client KV under `thread-summary-ui:<threadId>`; hidden content is inert and closing returns focus to the header toggle.

The overview composes real data only: Outputs, Sources, Subagents, and the latest Plan come from the Server's full-history [Thread Summary projection](protocol.md#canonical-timeline); native background processes use the Codex facade; thread terminals use the shared terminal directory; linked PRs use Thread Attachments; Schedules target the current Thread; Browser lists the Desktop's thread-scoped built-in tabs. Rows open the relevant existing detail tab or route. A failed source reports its own error without hiding other sections. Environment, Usage, Computer Use, external Chrome Browser Use, created tasks without origin linkage, and side chats without thread linkage are not Summary sections.

## Desktop-local settings

Electron stores Desktop-private preferences as version-1 values in `userData/kv.sqlite`. Semantic keys have no product or platform prefix. Appearance, `localeOverride`, General, Composer, Panel, Popout, Notifications, Sidebar, Git UI, and unread activity each have narrow schemas. Jotai owns renderer state; temporary form edits remain component state until confirmed. Electron main reads appearance and locale before creating a window and applies menu, sleep, notification, sound, and shortcut side effects for the relevant keys. OS operations such as picking a directory or sound remain narrow IPC calls.

The General settings page groups local preferences under Permissions, General, Composer, Popout Window, and Notifications. General includes the default folder for tasks without a project (`~/Documents/Cypheria` unless changed), dynamically discovered local file opening applications, UI language, menu bar presence, bottom panel control, terminal placement, and sleep prevention. Composer includes plain text input, context window usage, the three Enter send modes, and follow-up behavior. Popout Window includes its global shortcut and standalone chat default. Notifications includes turn completion mode, permission and question alerts, plus Default and Classic bundled sounds, None, sounds discovered from macOS, and a custom sound file picker. Selecting a sound plays a preview; selecting None stops any preview. Codex plugin availability is configured in Codex Settings and stored by Codex; see [Codex Configuration](codex-app-server-config.md).

Shared Agent, model, integration, Web3, and Server behavior belongs in Cypheria Server configuration or the database. UI preferences are not written to Codex configuration.

Other local UI state, rebuildable replicas, and attachment bytes use the shared [Client Storage](client-storage.md) ports. Electron main owns the Desktop SQLite key/value and replica databases as well as attachment files; the renderer reaches them only through validated preload IPC. These stores remain separate from the authoritative Server database.

Composer text and ordered attachment metadata are stored under `composerDraft:<threadId>` for an existing Thread and the fixed `composerDraft:new` key for every not-yet-created chat, with a 250 ms debounce and page-hide flush. No draft identity is carried in route search. When the Server creates a Thread, Desktop moves the shared new-chat draft to that Thread's key. File-picker inputs use Electron `webUtils.getPathForFile()` and main-process direct copy; only clipboard, pasted-text, screenshot, and other already in-memory sources use the bounded byte path. Failed submissions retain the complete draft. Missing binary data remains visibly unavailable and cannot be submitted.

Timeline message menus are derived from the Server's per-boundary capabilities. A `turn-user` message may show **Rewind to here** and **Fork in new chat**; an `assistant-final` message may show Fork; steer messages, streaming or unsuccessful assistant messages, tools, reasoning, and other items show neither. Rewind asks before replacing a non-empty draft and writes the returned input blocks only after the Server operation succeeds. User-message Fork writes those blocks to the new Thread draft; assistant and thread-head Fork start with an empty composer. Related actions and submission are locked while a branch operation is pending.

The main window stores changed Thread layouts under `panelLayout:<threadId>`, including right and bottom visibility and sizes, right-tab state, full-screen state, and focus. A new Thread uses fixed code defaults and creates no layout value until the user changes the workspace. Popout windows keep layout in memory only. Unsupported restored tabs are filtered.

Development builds expose a `/debug` route and a development-only sidebar entry. Its compact split view browses key/value state, replica rows, and attachment bytes with search, keyset pagination, bounded text previews, and bounded binary prefixes. The route redirects to the main workspace outside Desktop development mode and is not shown in production navigation.

Git, Worktrees, and Code Review settings follow the official desktop's pages and store their values in Server configuration.

- **Git** covers Git-based diffs (the last-turn-only review mode), branch prefix, merge method, guarded force push, draft pull requests, review delivery (inline or detached), Watch and fix (auto-merge and watch instructions), and commit and pull request instructions. Instructions save on their own after a pause.
- **Worktrees** covers the worktree root, which takes effect after Server restart, the upstream refresh before each new worktree, and automatic deletion with its limit; turning deletion off asks for confirmation. Below them it lists the managed worktrees by repository with their linked conversations, opens a new chat in a worktree, and deletes a worktree once no chat uses it.
- **Code Review** hosts the Code Review App's settings; see [Code Review](code-review.md#desktop-surfaces).

The Review panel respects the last-turn-only mode.

After creating a managed worktree, Server may clean up at most five older managed worktrees according to the retention setting. It protects the source checkout, the new worktree, worktrees used by active or unarchived threads, dirty worktrees, and worktrees created or updated in the last ten minutes. Archive and thread handoff also trigger cleanup; an archived thread's snapshot is restored before unarchiving when needed. Cleaned worktrees retain a Git snapshot and can be restored. A cleanup failure does not undo successful worktree creation.

For new or resumed managed Codex threads, Server includes the configured branch prefix and commit and PR instructions in Codex developer instructions.

## Browser and dApp boundary

Only the main window may host the built-in browser; the popout window does not. Third-party notices for adapted browser code are in `NOTICE`.

### Tabs and profiles

Every browser tab, web or dApp, belongs to exactly one Thread and appears in that Thread's Browser panel, where the user opens web and dApp tabs; there is no browser outside a Thread. Deleting a Thread closes its tabs; each connection to the Server also closes tabs whose Thread no longer exists, covering deletions Desktop missed. The device-local tab index lives in Desktop client KV and keeps the newest 200 tabs; a corrupt record is dropped on its own. Page state lives in the guest. Guests are kept in one fixed-position host outside React panes: a visible pane positions its active tab over itself, and hidden tabs are parked at 1×1 so pages keep running and can still be driven by an Agent. Restored tabs load from their saved URL when first shown or automated. The composer `@` menu lists the Thread's open tabs.

Each tab has a kind. Web tabs share the `persist:cypheria-browser` profile and never receive a wallet. dApp tabs share the separate `persist:cypheria-dapp-browser` profile. Switching a tab's kind rebuilds its guest because a profile cannot change after a guest attaches. Electron main rejects any other partition or preload, denies device permissions, blocks non-HTTP(S) navigation, opens `window.open` popups that need `window.opener` as sandboxed windows without a preload, and turns other new-window requests into tabs of the same kind. The address bar focus and reload shortcuts are reserved in the guest; other keys stay with the page.

### Agent control

When **Settings → General → Computer Use** enables the built-in browser or MCP Apps, the main window registers with the Server as a browser host and executes commands from [Computer Use](computer-use.md) against the calling Thread's tabs and mounted MCP Apps. Snapshots expose accessibility-tree refs that expire when the page changes; clicks, keys, hovers, and drags use trusted input through the Chrome DevTools Protocol after the target is visible, enabled, and stable. JavaScript dialogs are handled and reported instead of blocking. Uploads accept only files inside the Thread's working directory after resolving symlinks. MCP App actions run in the App's sandbox frame with synthetic events. Electron main also hosts the cua-driver daemon for native app control and requests its macOS permissions; see [Computer Use](computer-use.md#desktop-apps). The Server contract is in [Protocol](protocol.md#browser-hosts-and-computer-use).

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
