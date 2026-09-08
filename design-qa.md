# Desktop Sidebar Design QA

- Source visual truth: `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-39e65d74-815a-4a24-9449-7fb6cd43dcc4.png` through `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-f4a646fb-5368-4329-ac20-6e6845eabcd8.png`
- Primary focused source: `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-7c33a09e-cfd7-49e9-be7e-1c3d91939a1d.png`
- Implementation screenshot: `/Users/ridewindx/Code/web3/cypheria/.artifacts/design-qa/sidebar-section-menu-final.png`
- Combined comparison: `/Users/ridewindx/Code/web3/cypheria/.artifacts/design-qa/section-comparison-final.png`
- Viewport: 1144 × 768 CSS px, light theme, Chinese locale
- Pixels and normalization: the focused Codex reference is 764 × 292 px at Retina 2× density and was normalized to 382 × 146 px. The Cypheria CUA capture is 1144 × 768 px at 1× output density; a 382 × 146 px matching sidebar crop was used. The combined comparison is 764 × 146 px.
- State: custom `Test` section expanded, empty state visible, section menu open, Projects visible below it, right workbench panel open.

## Full-view comparison evidence

The final Electron capture preserves the Codex layout hierarchy: compact left-aligned section headers, disclosure chevrons immediately after labels, right-aligned overflow/new-chat actions, folder rows, a quiet neutral palette, and a menu that opens into the content area. The center conversation and right workspace panel remain fully visible without horizontal clipping. The right panel uses a workbench-relative clamped width.

## Focused region comparison evidence

The normalized side-by-side comparison covers the highest-fidelity area: custom section header, empty copy, Projects transition, folder row, and section menu. Menu radius, elevation, item density, icon placement, disabled state, section spacing, and left alignment are materially consistent with the reference. Text language differs intentionally because Cypheria follows the active Chinese locale.

## Required fidelity surfaces

- Fonts and typography: existing Inter/system typography is retained; header weight, menu size, line height, truncation, and muted hierarchy match the established Cypheria/Codex shell.
- Spacing and layout rhythm: section rows are 40 px, content rows are 32–36 px, nested actions are compact, and double horizontal padding was removed from section/project rows.
- Colors and visual tokens: shared sidebar, popover, muted, border, and focus tokens keep the low-saturation Codex appearance in both light and dark themes.
- Image quality and asset fidelity: no raster assets are required. All controls use the project's Lucide icon system; no handcrafted SVG, emoji, or CSS-drawn replacement is present.
- Copy and content: Pinned, Projects, Recents, project creation, organization, sorting, new-section, section edit/delete, and empty-state copy are represented and localized.

## Interaction and runtime checks

- Opened Pinned sorting and verified Priority, Last updated, and Manual order.
- Opened Projects organization, expanded its submenu, switched to In one list, verified Projects disappeared and project chats moved into Recents, then restored By project.
- Opened and visually checked Create project without writing a project.
- Opened Recents, verified New section, created the `Test` section through the real experimental App Server API, and verified its menu and new-chat link.
- Opened the edit-section dialog and cancelled without mutation.
- Verified the DevTools console reported zero messages during the runtime check.

## Comparison history

1. Initial comparison found two P2 fidelity issues: top-level menus opened to the left of their action instead of into the content area, and the custom-section empty copy/icon alignment differed from Codex. The menu content was changed to use right-side placement; section/project double padding was removed; empty copy was aligned and changed to “Drop chats or projects here”; delete styling changed to the reference's neutral X icon.
2. The post-fix normalized comparison shows the earlier menu placement, copy, alignment, and icon findings resolved. No actionable P0, P1, or P2 difference remains.

## Findings

No actionable P0, P1, or P2 findings remain. A P3-only difference remains: screenshots supplied by the user use English while the tested app follows its active Chinese locale.

## Implementation checklist

- [x] Match compact section headers and action placement.
- [x] Implement sorting and organization menus.
- [x] Implement project and section dialogs.
- [x] Connect experimental section lifecycle APIs through typed IPC.
- [x] Verify one-list mode, real section creation, localization, console state, and responsive workbench layout.

final result: passed

---

# Task Workspace Clipping Design QA

- Source visual truth: `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-4ab2a3ed-a85e-450f-8d2f-6808b852c943.png`
- Same-viewport reproduction: `/Users/ridewindx/Code/web3/cypheria/.artifacts/design-qa/workspace-clipping-pass1.png`
- Implementation screenshot: `/Users/ridewindx/Code/web3/cypheria/.artifacts/design-qa/workspace-clipping-final-collapsed.jpg`
- Combined comparison: `/Users/ridewindx/Code/web3/cypheria/.artifacts/design-qa/workspace-clipping-comparison.jpg`
- Viewport: 1280 × 860 CSS px, Electron device pixel ratio 2, CUA output 1144 × 768 px, light theme, Chinese locale
- Pixels and normalization: the 2006 × 1736 px user capture, 1144 × 768 px same-viewport reproduction, and 1144 × 768 px final capture were each fit without cropping into a 900 × 800 px comparison panel.
- State: the same long-title task is open, the navigation sidebar is collapsed in the final capture, and the Context workspace panel is open.

## Full-view comparison evidence

The user capture and same-viewport reproduction show the conversation stream and composer extending underneath the workspace panel and being clipped at its left edge. In the final capture, the main content ends exactly at the workspace divider; messages, tool cards, composer controls, and footer metadata remain wholly visible. The long task title truncates before the status and action controls.

## Focused region comparison evidence

The full view is readable enough to judge the affected regions, so no separate crop is needed. Runtime geometry confirms the collapsed-sidebar main pane is 840 px wide, its explicit content grid track is 839 px, the composer ends at x=825 before the x=840 divider, and no descendant crosses the main pane's right boundary.

## Required fidelity surfaces

- Fonts and typography: existing typography is unchanged; the title now ellipsizes in its 474 px available width while status/actions retain their optical weight and spacing.
- Spacing and layout rhythm: conversation, tool cards, and composer are centered within the actual main grid track rather than an intrinsic 1545 px track.
- Colors and visual tokens: unchanged from the existing Codex-like light theme.
- Image quality and asset fidelity: no image assets were added or changed; existing library icons remain intact.
- Copy and content: conversation, tool, workspace, and status copy are unchanged and no content is hidden by the divider.

## Interaction and runtime checks

- Reopened the exact task from the user report and reproduced the failure before the root fix.
- Verified Context, Files, Review, and Terminal tabs with the conversation visible beside them.
- Verified both expanded and collapsed navigation-sidebar states.
- Measured the live DOM at 1280 × 860: before the fix the 615 px main pane had a 1545 px implicit grid column; after the fix the main content track is 614 px expanded and 839 px collapsed, with zero overflowing descendants.
- Typecheck, 20 test files / 86 tests, and renderer production build passed.

## Comparison history

1. Initial P1: the long title contributed a large min-content size to the main pane's implicit `auto` grid column. The 615 px visible pane produced a 1545 px content track, so all three rows—header, conversation, and composer—were clipped by the right workspace panel.
2. The title row was made shrinkable with fixed-size icon/status/actions, and the main pane received an explicit `minmax(0, 1fr)` content column. This prevents long titles, paths, or tool content from enlarging the grid track.
3. Post-fix visual and geometry checks show correct title truncation, complete conversation/composer rendering, and no element crossing the panel divider. No actionable P0, P1, or P2 finding remains.

## Findings

No actionable P0, P1, or P2 findings remain.

## Implementation checklist

- [x] Constrain the main workspace content track.
- [x] Make the long title shrink and truncate without moving status/actions.
- [x] Verify the exact reported task with Context, Files, Review, and Terminal.
- [x] Verify expanded/collapsed sidebar states and runtime overflow geometry.

final result: passed
