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
