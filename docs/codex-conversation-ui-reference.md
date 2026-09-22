---
title: Codex Conversation UI Reference
---

# Codex Conversation UI Reference

This document is the implementation reference for reproducing the Codex task conversation experience in Cypheria. It describes observable structure and behavior, not copied ChatGPT implementation code. General ChatGPT chat modes and the application-wide left navigation are outside this reference.

## Status and evidence

The reference targets the locally unpacked ChatGPT Desktop application `26.915.31945` (`build 9922`) inspected on 2026-09-20. Evidence has three strengths:

- **Observed:** read-only CuaDriver captures of the live Codex task window confirmed the visible proportions, hierarchy, flat activity rows, floating two-level composer, wide Review panel, and separate header toggles. The captures contain user data and are intentionally not committed.
- **Source-confirmed:** the unpacked `local-conversation-page`, `local-conversation-thread`, `composer-host`, `composer-utility-bar`, `thread-app-shell-chrome`, `thread-scroll-layout`, `thread-side-panel-tab-content`, `right-panel-composer-overlay`, and background-terminal bundles establish state and interaction behavior.
- **Cypheria mapping:** reusable presentation is implemented in `@cypheria/ui`; persistence, transport, runtime, and domain behavior remain in Desktop and Server.

Values that are visually estimated are treated as defaults, not protocol. The 44px header, original 40rem content measure, 639px compact breakpoint, and 70% user-message limit are source-confirmed. Following comparison with Cypheria's production conversation workspace, the shared implementation now uses one 48rem outer measure for both Timeline and composer so their edges align; inner message typography remains independently readable.

The inspected bundle identities are recorded so later audits can distinguish product changes from interpretation changes:

| Bundle | SHA-256 |
| --- | --- |
| `local-conversation-page-112daed315f5.js` | `1bc90d93a4c74ab9bfb68134170b56c675a3c4c879716657dea1e6697279c4a9` |
| `local-conversation-thread-d531b243ea4e.js` | `014788e09176b4be847cec5f702225ce77851f98577525e80e846859b85008e7` |
| `composer-host-1069c79f77de.js` | `5293950f723dc480cbbc170896b6e5eedc89754c12bae06c84833129840c3639` |
| `composer-utility-bar-63b667abc11c.js` | `7b34b71202fe2d44d25fa6250ac2f0593f59bd86d2218a32fbf9ff3222283e4a` |
| `thread-app-shell-chrome-e7ab72062e15.js` | `7f4be251470eed08b5d855a21562772a346468f3e04c55cd43718dd985477d90` |
| `thread-scroll-layout-a1fd58afc6e8.js` | `982a991b8f970846725093623ea0bfc10c907934d1f69b197e17760638d9f03e` |
| `thread-side-panel-tab-content-2b3cd260bf24.js` | `57bceb291e63944d939c8bc4f19664330f8185edcb0b485e39f4025440017205` |
| `right-panel-composer-overlay-f770dcfd060a.js` | `c1def12dd32e4aea1be827b6c3b20e68e7657a02add4adcc52c690fc274e60c5` |
| `local-conversation-background-terminal-tab-6b15fb4e8083.js` | `cd39bbc8dc5b8f7333bc5ff1448cfc94ad87bd86cd2d94423ca6efef6b10fec7` |

## Product boundary

The shared conversation surface starts at the task title bar and contains the Timeline, composer, optional right panel, and optional bottom panel. It must work for Codex, Claude, Pi, OpenCode, and ACP without cloning any harness application.

The shell does not own the global Sidebar, route selection, Thread persistence, protocol types, network requests, Agent processes, terminal processes, or filesystem access. Harness-specific UI is permitted only inside attributed Timeline items, composer controls, or panel content.

## Spatial model

The shell uses a nested two-axis work area. The upper workspace places the conversation column beside the right panel, and each owns its own top chrome; the bottom panel is a sibling below that whole workspace. Both panels may be open simultaneously. Resizing a panel must not replace the active tab, reset the composer, or lose the Timeline anchor. The right split preserves a pixel width with a 320px panel minimum and a 480px conversation minimum. Continuing to drag left at that conversation threshold collapses the conversation to zero and lets the right panel occupy the whole upper workspace without affecting the bottom panel. The Desktop mounts this split only from its 1181px wide-view breakpoint so the normal constraints cannot form an immovable layout. The bottom split preserves a pixel height between 160px and 50% while leaving at least 240px for the upper workspace. Dragging below its 160px threshold collapses it to zero and changes controlled visibility to `hidden`. Resize persistence callbacks run after the pointer or keyboard interaction completes, not on every pointer movement. Button-driven panel and fullscreen transitions animate the resizable flex layout for 200ms and honor reduced motion; direct pointer resizing remains unanimated.

Default Cypheria layout tokens are:

| Token | Default | Purpose |
| --- | ---: | --- |
| `--chat-header-height` | `2.75rem` | Title bar height |
| `--chat-fixed-header-actions-width` | `4.625rem` | Reserved width for the two fixed panel toggles |
| `--chat-thread-max-width` | `48rem` | Shared Timeline and composer measure |
| `--chat-content-max-width` | `var(--chat-thread-max-width)` | Readable message content |
| `--chat-composer-max-width` | `var(--chat-thread-max-width)` | Floating composer width |
| `--chat-main-min-width` | `30rem` | Minimum resizable conversation column |
| `--chat-right-panel-size` | `420px` | Initial right panel width |
| `--chat-bottom-panel-size` | `280px` | Initial bottom panel height |
| bottom-panel maximum | `50%` | Preserve the upper workspace |
| side-panel fullscreen | `100%` | Replace only the upper conversation region |

### Top title bar

The title bar is compact and visually quiet. The conversation header belongs to the conversation column and contains project or workspace context followed by a truncating task title; activity, thinking, and usage details are secondary status, not title text. The right panel owns a separate, aligned header containing its tabs, launcher, and Enter/Exit full screen action. Toggle bottom panel and Toggle side panel form a fixed control group at the far right of the workspace. Both headers reserve that group’s width, and all adjacent icon buttons use the same 32px button geometry and 4px gap, so the controls do not move or change rhythm when the side panel is hidden. In that state the conversation header expands naturally toward them and its bottom divider continues beneath the fixed group; the visible right panel header intentionally has no bottom divider. In Desktop, the conversation header uses the same `desktop-titlebar` marker and stacking contract as the production workspace: this removes the route-level 44px fallback gutter, keeps the collapsed-sidebar controls above the title surface, and makes its leading padding animate with the left navigation’s expanded or collapsed state.

Panel and summary controls are independent toggles with persistent pressed state and accessible names. Long titles truncate before action controls move. Status changes use text or accessible labels in addition to color and animation.

### Conversation stream

The Timeline is the primary scroll container. Content is centered within the reading measure while the scrollbar belongs to the full column. User messages are compact right-aligned bubbles, normally capped at 70% of the reading width and at 456px for the compact form. Assistant content is unboxed and uses the full reading measure.

Timeline items include user and assistant messages, reasoning, tool activity, commands, plans, review summaries, approvals, files, generated artifacts, errors, and retry affordances. `ChatMessageContent`, `ChatReasoning`, and `ChatTool` own the transcript-specific typography and disclosure hierarchy instead of inheriting the generic AI Elements visual layer. `ChatActivityList` and `ChatActivityItem` keep progress rows flat; `ChatCommandBlock`, `ChatFileChanges`, `ChatFileChange`, and `ChatTurnNotice` provide reusable structure for richer transcript items without embedding runtime behavior. Message actions appear on hover and keyboard focus. A narrow turn navigator may expose jump targets for user turns without becoming the primary navigation model.

The reusable event catalog covers all 37 audited item discriminators. `ChatTimelineEvent` supplies the common icon, tone, state, metadata, and action contract, while plan/todo, approval, user-input, agent, generated-image, diff, resource, handoff, transcript, and timestamp components preserve the distinct visual structures that cannot be reduced to a generic row. The development Demo groups these into nine independently switchable families so the complete catalog can be inspected without forcing every item into the default transcript.

Older history loads above the retained anchor. Streaming updates reuse stable item identity. A dynamic response spacer reserves room near the live edge so an active response is readable above the composer. A scroll-to-latest control appears only when the reader is away from that edge.

### Composer

The composer floats above the Timeline and aligns to the same 48rem outer measure. Its frame contains an optional context tray, native `ChatComposerForm` and multiline `ChatComposerTextarea`, and a compact utility footer. Attachments, referenced sources, permission mode, execution location, workspace/worktree/base selection, model, reasoning effort, dictation, and send/stop are composed as controls rather than embedded business logic.

The composer visibly distinguishes ready, submitted, streaming, and error states. Streaming changes the primary action from send to stop. Queued and steering interactions remain application-owned but use the same trays and controls. Draft text, attachments, selection, and focus survive Thread adoption and panel changes.

When a right-side overlay needs horizontal space, the composer may use the `panel-overlay` layout and a caller-provided offset. Hiding the composer retains its state, marks it inert, and exposes a separate reveal control. Reduced motion removes layout animation without changing state transitions.

### Right panel

The right panel is a resizable tab host, not a fixed Context inspector. Tabs may be launched dynamically, selected independently, closed when closable, or moved to the bottom panel when movable. The panel header owns tab navigation, tab-local actions, and the launcher.

The shared panel chrome follows the observed app-shell tab strip rather than a generic underlined tab bar: the default 36px pane toolbar contains rounded 28px tabs with an adaptive compact measure, a horizontally scrollable strip with a hidden scrollbar, and a non-scrolling trailing action cluster. A right panel used as top-level workspace chrome adopts the 44px title-bar height, while the bottom toolbar remains 36px. A long title fades toward its trailing edge instead of ending in a hard clipping boundary. Its close control sits immediately beside that fade; the active tab exposes it continuously, while inactive close controls appear on hover or keyboard focus. Short separators preserve grouping between inactive tabs without adding card borders around the content. The side launcher follows the side tabs. The bottom launcher follows the bottom tabs, and the bottom toolbar's right side contains only Close.

Bundle-confirmed tabs and hosts include Sources, Subagents, Plan, Summary, Goal, Review/diff, pull request, Terminal, text files, images, cloud browser, MCP App, automation, generic artifacts, PDF, DOCX, notebooks, presentations, workbooks, and entity details. Each tab owns its scrolling region and empty, loading, error, read-only, disconnected, and oversized-content states. Opening a tab must not change the Thread or Timeline scroll position.

### Bottom panel

The bottom panel uses the same tab descriptor and lifecycle as the right panel. Terminal is the common first-party content, but the location is not terminal-specific: review, browser, or artifact tabs may move there. Its tab strip remains visible above the active content, and terminal sessions retain title and running/exited/failed status.

The bottom toolbar uses the same tab mechanics with a slightly muted surface so the split remains legible when both panel placements are open. Right and bottom separators are one-pixel visual rules with enlarged pointer hit areas, visible hover/focus feedback, native separator semantics, and arrow-key resizing.

Hiding the panel preserves its tabs and active value. Closing a tab removes that tab. Closing the final tab may cause the application to transition the panel to `closed`; the UI package only emits the relevant callbacks.

## Interaction and state model

### Panel lifecycle

Panels have three explicit presentation states:

- `visible`: participates in layout and interaction.
- `hidden`: retains the registry and active tab but is hidden, inert, and `aria-hidden`.
- `closed`: is not mounted by the panel component.

Hidden panels stay inside their original collapsible resizable panel at size zero. Restoring visibility expands the same panel instance to its caller-owned pixel size, so tab content, local renderer state, and focus bookkeeping are not remounted merely because the panel was hidden. Closed panels leave the resizable tree. The application owns tab arrays, placement, active values, persisted dimensions, launcher availability, and the decision to close an empty panel. The shared layer emits active-tab, close-tab, move-tab, visibility, and resize events only.

### Scrolling and streaming

Desktop owns the virtualizer and per-Thread scroll controller. The presentation layer supplies the scroll container, content measure, state rows, spacer, navigator, and live-edge affordance. It never assumes fixed item height. Initial navigation and explicit turn/latest navigation use immediate positioning; mounting does not begin with an estimated intermediate offset or a smooth-scroll animation. Measurement settling may repeat the same immediate bottom alignment while variable-height rows stabilize.

Loading history, expanding reasoning, terminal output, large diffs, and streamed tool results must preserve the user's visual anchor. New output follows automatically only while the user is already at the live edge. Cancel, retry, pending interaction, and failure recovery appear at the action site.

### Focus, keyboard, and accessibility

Base UI supplies roving tab focus and menu behavior. Every icon-only action requires an accessible name and tooltip. Tab selection, current turn, expanded state, disabled state, and panel toggle state use native ARIA semantics. Hidden panels and composers are inert so their descendants cannot receive keyboard focus.

Opening a panel does not steal focus from the composer unless the user explicitly invoked a focus-moving action. Closing or moving a focused tab returns focus to a stable adjacent tab or its panel launcher. Status includes text and live-region semantics instead of color alone.

### Responsive behavior, motion, and localization

At and below 639px, content and composer measures become fluid and nonessential control labels may collapse to icon-plus-tooltip. The application should hide or overlay secondary panels before squeezing the primary column below usable width. Longer English and Simplified Chinese labels must not displace the core send/stop action.

All motion respects the shared reduced-motion preference. Light and dark themes consume semantic surface, border, foreground, muted, destructive, success, and focus tokens. No component embeds product strings; Desktop supplies localized visible text and accessible labels through Lingui.

## Panel content taxonomy

Sources group attached, read, created, updated, web, tool-input, and tool-result material. Subagents group active and completed work and expose state, model, and reasoning effort. Plan, Summary, and Goal use lightweight section and step primitives. Review combines scope controls, pull-request cards, file statistics, file selection, and a renderer-agnostic diff host; pull-request details additionally cover checks, reviewers, comments, and error recovery. Terminal combines tab selection, lifecycle status, and a renderer-agnostic output host.

Files, images, browser previews, MCP Apps, automation, generic artifacts, PDF, DOCX, notebooks, presentations, workbooks, entity details, side chat, MCP thread/file extensions, sandboxes, and secondary timelines use named `ChatPanelSurface` wrappers over `ChatPreviewPanel`, `ChatPreviewToolbar`, `ChatPreviewHost`, and `ChatPreviewStatusBar`. The wrappers expose stable `data-kind` identities while common sections, lists, empty/error states, and launchers remain composable. The hosts establish structure only: editors, annotation engines, browser sessions, sandboxed apps, document renderers, kernels, Office bridges, and domain stores remain application-owned.

## Cypheria component mapping

| Codex capability | Shared component surface | Application-owned behavior |
| --- | --- | --- |
| Task chrome | `ChatWorkspaceShell` fixed header actions, conversation `ChatHeader`, panel `ChatPanelHeader`, title/status/actions/toggles, `ChatPinnedSummary` | project lookup, title mutation, sharing, usage data, Desktop sidebar state |
| Two-axis shell | `ChatWorkspaceShell`, `ChatPanelLayout`, resize handle | saved sizes, open state, side fullscreen state |
| Timeline | Timeline items, message content, reasoning/tool disclosures, activity list/item, command block, file changes, notice, navigator, spacer, live-edge button | Canonical Timeline mapping, virtualization, anchor persistence |
| Composer | dock/frame/form/textarea/trays/utility controls/submit/reveal | draft, attachments, permissions, model catalog, send/stop/queue |
| Dynamic panels | `ChatPanel`, tabs, launcher, sections, list and state primitives | registry, availability, persistence, tab placement |
| Sources and subagents | source/subagent groups and rows | runtime events and navigation |
| Plan and summary | plan steps and summary sections | plan data, usage and summarization |
| Review | PR card, toolbar, file list, diff host | Git state, diff loading, review commands |
| Terminal | terminal tabs, status and output host | process lifecycle, xterm controller, auditing |
| Generic previews | preview panel/toolbar/host/status bar | file editors, image/PDF/DOCX/notebook/Office renderers, browser/MCP sessions |

### Desktop adoption

The production conversation page can adopt the chrome without copying Demo utility classes. Compose its existing Timeline and composer inside `ChatWorkspaceShell`, pass the conversation title through `ChatHeader` with `reserveFixedActions` only while the right panel is absent, pass the right-side `ChatPanel` with `workspaceHeader`, and place the bottom/side toggles in `fixedHeaderActions`. Desktop alone adds the `desktop-titlebar` class because its animated leading gutter and stacking relationship belong to the application Sidebar. Existing application state continues to own visibility, active tabs, sizes, fullscreen, resize persistence, and panel content.

## Ownership boundaries

`@cypheria/ui` contains React presentation, semantic styling, chat-owned message/composer/tool primitives, Base UI interaction primitives, direct Streamdown rendering, and renderer slots. The chat component surface does not depend on AI Elements, so its spacing and interaction hierarchy can follow the audited Codex experience independently. It imports neither `@cypheria/protocol` nor Desktop, Electron, Server, router, query, or IPC modules.

Desktop maps Canonical Timeline and harness data into component props, owns per-Thread drafts and scroll state, mounts the virtualizer and diff/terminal renderers, and persists panel layout. Server retains Agent runtimes, repositories, terminals, policy, privileged operations, and audit.

The shared icons directory is a complete 755-component mirror of the pinned MIT-licensed OpenAI Apps SDK UI icon source and documents its revision and local accessibility-only changes. No code from the unpacked ChatGPT application is copied into Cypheria.

## Alignment priority and acceptance

### P0 release gates

- Stable title bar, Timeline, floating composer, and simultaneous right/bottom panel layout.
- Per-Thread draft and scroll preservation, stable streamed identities, no forced scrolling away from the reader's anchor.
- Send, stop, pending, failure, retry, hide, close, move, and resize semantics with keyboard and pointer parity.
- Correct focus, accessible names, `aria-*`, inert hidden surfaces, and light/dark contrast.

### P1 complete work surface

- Sources, Subagents, Plan, Summary, Review, PR, Diff, and Terminal presentation states.
- Incremental history, large diffs, expanded reasoning, terminal output, long translations, and compact-window behavior.
- Harness attribution without forking the common conversation shell.

### P2 polish

- Exact easing, delayed hover-action visibility, subtle shadows, scrollbar intensity, and panel/composer transition timing.
- Additional generic artifact launchers and richer tab previews that do not change the shared state model.

Acceptance requires equivalent behavior for all supported Agents, no regression in the existing Desktop conversation, and no privileged or protocol dependency in the shared UI package.
