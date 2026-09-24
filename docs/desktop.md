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

For a conversation with a local working directory, the Codex Review panel reads the repository through the Server Git API. It shows staged and unstaged files and text diffs plus committed branch changes from the merge base with the default branch. Branch diffs use a pinned HEAD and reject stale reads after HEAD moves. The panel offers repository initialization, branch creation and switching, file staging, unstaging, commit, push, and managed worktree creation, deletion, and restoration. Branch selection searches recent local and remote refs; selecting a remote ref creates a local tracking branch. Worktree deletion requires a clean worktree and saves its committed HEAD for restoration in the panel. The panel follows the thread working directory when available and refreshes local status while open. For a GitHub.com origin, the `gh` path shows account and repository availability, open PRs and details, PR checks, discussion comments and reviews, PR creation, title/body editing, draft/ready transitions, close/reopen, and confirmed merge with a matching head commit. State changes and new comments or reviews compare the displayed head SHA with the current PR head before sending. Checks include passing, failing, pending, skipped, and canceled states. If `gh` cannot access the repository, a connected GitHub App can search the latest open PRs, read PR details, and create a PR from a pushed local branch of a local Codex thread. It selects operation-specific tools on one account link, validates `get_repo` access and PR URLs, and opens a newly created PR in the system browser. Editing, checks, discussion writes, state changes, and merge remain on the `gh` path. For a GitLab.com origin, it looks up the current branch MR, and offers MR detail, pipeline jobs and bridges, title editing, comments, native creation, and a prefilled form in the system browser; native actions require a local Codex thread and a connected GitLab App. Pipeline results indicate when one or more pages could not be loaded.
For a conversation with a local working directory, the Codex Review panel reads the repository through the Server Git API. It shows staged and unstaged files and text diffs plus committed branch changes from the merge base with the default branch. Branch diffs use a pinned HEAD and reject stale reads after HEAD moves. The panel offers repository initialization, branch creation and switching, file staging, unstaging, commit, push, and managed worktree creation, deletion, and restoration. Branch selection searches recent local and remote refs; selecting a remote ref creates a local tracking branch. Worktree deletion requires a clean worktree and saves its committed HEAD for restoration in the panel. The panel follows the thread working directory when available and refreshes local status while open. For a GitHub.com origin, the `gh` path shows account and repository availability, open PRs and details, PR checks, discussion comments and reviews, PR creation, title/body editing, draft/ready transitions, close/reopen, and confirmed merge with a matching head commit. State changes and new comments or reviews compare the displayed head SHA with the current PR head before sending. Checks include passing, failing, pending, skipped, and canceled states. If `gh` cannot access the repository, a connected GitHub App can search the latest open PRs, read PR details, and create a PR from a pushed local branch of a local Codex thread. It selects operation-specific tools on one account link, validates `get_repo` access and PR URLs, and opens a newly created PR in the system browser. Editing, checks, discussion writes, state changes, and merge remain on the `gh` path. For a GitLab.com origin, it looks up the current branch MR, and offers MR detail, paginated discussions, reviewer and approval status, project member search, reviewer management for the MR author, pipeline jobs and bridges, title editing, comments, native creation, and a prefilled form in the system browser; native actions require a local Codex thread and a connected GitLab App. Pipeline results indicate when one or more pages could not be loaded.

The unstaged Review source also renders text diffs for untracked regular files before they are staged.

The Uncommitted source combines index and working tree changes against HEAD, including untracked files. In a repository without a first commit, it combines the staged and unstaged diffs.

The Commit source lists recent commits and compares a selected commit with its first parent, or with the empty tree for the root commit. File diffs use pinned commit hashes, so later working tree changes do not alter that review.

For local Codex turns, Server snapshots the repository's non-ignored files through a temporary Git index before and after the turn. It pins both trees under `refs/cypheria/turn-diffs` and stores the latest completed capture under `CYPHERIA_HOME/git-turn-diffs`. The Last turn source reads these trees, including untracked files, without changing the real index. Captures are best effort; a turn still runs if its Git snapshot fails.

Staged and unstaged Review files have a Server-issued revision. Whole-file and individual text-section stage or unstage actions refresh and compare that revision before changing the index; stale actions fail and refresh the Review. The unstaged source also supports confirmed whole-file and text-section revert. Before reverting, Server saves the original file or symlink under `CYPHERIA_HOME/git-review-undo`; the panel lists saved reverts after a restart and offers Undo. Undo rejects a file changed after revert. New, deleted, and binary files remain whole-file actions.

All six Review sources support case-insensitive path filtering and an ignore-whitespace display option. Branch Review lets the user choose a local or remote base branch. Server provides per-file added and deleted line counts from Git's NUL-delimited numstat output; the panel shows counts for visible files and their total. The ignore-whitespace option also filters these counts. It hides section-level mutations because filtered hunks cannot safely identify raw patch sections; whole-file actions still use the unchanged file revision. Binary and untracked files omit line counts.

The GitHub CLI pull request list supports server-side query search and open, closed, merged, or all state filters.

For open GitHub PRs, the CLI path reads the auto-merge state and can enable or disable auto-merge. Enabling uses the configured merge method and checks the displayed head commit before sending the action.

When the CLI can access the repository, the PR panel selects the current branch's PR from the list and can load its patch. Server checks the displayed PR head SHA before and after fetching that patch, so it rejects a diff if the PR changes during the read.
When the CLI cannot access the repository, a connected GitHub App can also load the PR patch. It selects the required tools on one account link and checks the PR head before and after fetching the diff.
The connected App can also display PR comments and reviews through its read tools. These reads use one account link and reject activity when the PR head changes during acquisition.
For an open PR, the App path reads checks through `get_pr_statuses`, validates the viewer login, repository, PR URL, and head revision, and keeps incomplete check sets distinct from an empty completed set.
The App path can also display inline review threads and their comments through `list_pull_request_review_threads`, checking the PR head before and after the read. Thread mutations remain on the CLI path.
For private images embedded in a PR body, the App path uses `download_user_content` on the same repository account link. Server accepts only the private GitHub image host, validates the PR head before and after download, and returns supported images up to 4 MiB for inline display.
The App PR list accepts the panel's text, lifecycle, and involvement filters. It uses the connected account login for authored or review-requested searches, queries open and closed states separately when needed, validates every returned PR URL against the repository, and shows at most 100 latest results.

The PR panel lists exact GitHub revision commits and loads the selected commit's diff. The Server can also read text file content at the selected base and head revisions; it returns unavailable for binary or oversized files. Each revision read checks the displayed PR head before and after the request.

The CLI path can inspect a PR stack by following open PR base and head branches, with a 50-PR limit and cycle checks. It can read `.gitattributes` from the displayed PR head for a changed file's parent directories, rejecting truncated attributes and rechecking the PR head after reading.

The bundled `cypheria-app-tools` Codex plugin loads its MCP tool names and input schemas from the Server's authenticated public Git protocol catalog. It exposes the same Server operations to the Agent, including local review, worktree, GitHub PR, and GitLab MR actions. Connected App operations still require their own account link and a local Codex thread; the plugin does not claim a GitHub or GitLab App ID. If an older Server lacks the catalog, the plugin keeps its bundled core Git tools.

The CLI path can request or remove a user or team reviewer. Reviewer changes and title/body edits compare the displayed head SHA before writing; the panel refreshes PR data after the operation.

The CLI path also reads PR additions, deletions, changed-file count, author, auto-merge state, allowed merge methods, reviewer requests, and paginated review decisions. Reviewer search uses GitHub's repository collaborator suggestions; the Server also exposes mention suggestions from PR participants and mentionable users.

The CLI path also reads paginated review threads and replies, posts a comment on a changed line, replies to a thread, and resolves or reopens threads when the account has permission. The author can edit or delete their issue and review comments and edit their review body. It verifies the displayed PR head before reading and writing, checks a thread belongs to that PR before changing it, and checks comment ownership before editing or deleting. If GitHub exceeds the 100-page safety limit, the panel marks the discussion as incomplete.

The CLI PR list supports state and text search, created-by-me and review-requested scopes, and loading additional results in batches of 100 up to 500. GitHub App results retain the connector's available scope and limit.

The CLI also queries the current branch's authored PR independently of the list. It favors an open PR, otherwise a merged PR, so a PR outside the current list remains available and a second open PR is not offered for the same branch.

For an open PR in a local Codex thread, **Fix PR** starts a turn in that thread with the PR URL and guarded repair instructions. **Watch and fix** creates a persistent Server schedule that runs the same thread every ten minutes. The watch prompt uses the saved auto-merge, merge-method, and custom watch instructions at creation time; the PR panel can pause and resume the schedule. Runs report a closed or merged PR without making changes, while the schedule remains available for the user to pause.

Managed worktrees persist an optional owner Thread ID in Cypheria's worktree metadata. The Server checks that an assigned local Codex thread belongs to the same repository and currently uses that worktree. A worktree with an owner cannot be deleted until its owner moves away.

The Review panel can move an idle local Codex thread between its checkout and an active managed worktree. The Server rejects a move during a turn or pending interaction, resumes the native thread at the destination, updates worktree ownership, and restores the prior directory if the move fails. Moving the thread changes its working directory; local uncommitted files remain in their original directory.
When the thread starts in a repository subdirectory, the Server moves it to the same relative directory in the target worktree. It rejects missing directories and paths that resolve outside the target worktree.
The Review panel can create a detached managed worktree from `HEAD` or a selected local or remote branch. The source checkout stays on its current branch.
When creating it, Server copies ignored `AGENTS.override.md` files and ignored regular files selected by the source root's `.worktreeinclude`. It skips symlinks and existing destination files.
The Worktrees controls can include local changes and select a repository-local environment config. Creation progress, setup output, cancellation, retry, and skip-setup are shown in the Review panel. With no selected environment, setup is skipped.

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

The Git settings page stores local Codex Git preferences in Server configuration. It covers branch prefix, guarded force push default, review mode, PR draft and merge defaults, sidebar PR icons, worktree root and retention, upstream refresh, and commit, PR, and watch instructions. The worktree root takes effect after Server restart. The Review panel respects the last-turn-only mode; PR creation and merge use the configured defaults.

After creating a managed worktree, Server may clean up at most five older managed worktrees according to the retention setting. It protects the source checkout, the new worktree, owned worktrees, worktrees used by any saved thread, dirty worktrees, and worktrees created or updated in the last ten minutes. Cleaned worktrees retain a Git snapshot and can be restored. A cleanup failure does not undo successful worktree creation.

For new or resumed managed Codex threads, Server includes the configured branch prefix and commit and PR instructions in Codex developer instructions.

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
