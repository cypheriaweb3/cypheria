# Plugin integration management design QA

## Scope and result

Current review slice: Apps/MCP management, availability display, MCP login/addition, and the five-tab settings layout. This is not a certification of full Codex feature parity; recording, advanced configuration and remaining directory source states remain tracked in the todo.

Final result: passed

## Visual evidence

- Source: user screenshot 8, `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-df6e8c4a-c7ea-4a63-8a9e-79ac9b69a7da.png`.
- Source pixels: 3680 × 2392, with a 3456 × 2168 application window at (112, 76); inferred 2x density gives 1728 × 1084 CSS pixels.
- Implementation: `.artifacts/plugin-audit/integrations-settings-final.png`, light theme, Plugins management tab, Add menu open, 1728 × 1084 CSS viewport, reported DPR 1.
- The in-app full-page capture rendered into the upper-left half-size region with unused space. Analysis-only normalization crops that region and the source application window; both are scaled equally to 925 × 580. Script: `.artifacts/plugin-audit/normalize-integration-comparison.swift`.
- Combined comparison: `.artifacts/plugin-audit/integrations-comparison-final.png`. Both artifacts were opened together in this single comparison image. Full view includes readable headings, menu, tabs and rows; no additional focused crop was needed at this comparison size.
- Default-window Apps capture: `.artifacts/plugin-audit/integrations-apps-preview.png` (no normalization needed).
- Narrow-width evidence: `.artifacts/plugin-audit/integrations-narrow.png` and `integrations-narrow-final.png`, 390 × 844 CSS pixels; this is a responsive check, not a mobile-source clone.

The reference has a different signed-in catalog and settings sidebar. Cypheria deliberately retains its existing shell, settings entries and English copy. Catalog contents and logos are always supplied by App Server in the running desktop application.

## Findings and iterations

1. P2: management chrome was split between a redundant directory toolbar and content header; search sat above tabs and checked switches were blue. Fixed: title-level Browse/Add actions, five count tabs with adjacent search, neutral primary actions and scoped violet switches.
2. P2: content and Add menu were too wide once source density was measured. Fixed: management content 768 px, directory content 720 px, compact Add menu. Revised normalized comparison confirms the intended quiet single-column settings hierarchy.
3. P0: validating an empty MCP URL threw while rendering the form. Fixed URL refinement to return validation failure; added an incomplete-form regression test and verified empty/valid forms in the browser. Earlier console errors at 07:26 UTC were from this fixed defect; no later errors appeared in the final console log check.
4. P2: at 390 px, integration rows pushed connection buttons outside the clipped content region and header text wrapped excessively. Fixed row minimum width, wrapping header action group and nonwrapping horizontally scrollable tabs. Ready/Connect controls remained inside the viewport; the last tab was reachable by interaction and displayed its Update action.

## Required fidelity surfaces

- Typography: existing system font, 28 px page title, 14 px rows, restrained weight and one-line secondary descriptions. English text varies from the Chinese reference without changing hierarchy.
- Layout: compact title actions, five tab counts, adjacent desktop search, single-column 68–72 px rows, trailing settings switches; narrow header wraps and tab strip scrolls.
- Colors: neutral surfaces, subtle hover backgrounds, violet enabled switches, status colors only for actual runtime state. No green success state is inferred from clicking a connection link.
- Assets: server-provided logos in Electron. Missing metadata uses library fallback icons rather than invented branding.
- Copy: app accessibility, enabled state and callable state remain distinct. MCP runtime connection and stored authentication are separate.

## Interaction verification

- Apps tab selection, enable/disable status synchronization, search and empty results.
- MCP tab, server detail dialog, tool inventory, OAuth flow, and standalone switches.
- Add menu → MCP form; empty submit is disabled and valid fields enable submit. Existing-name rejection and unsafe URLs are covered by service tests.
- Keyboard Escape dismisses menu; narrow tab navigation reaches Markets. Shared dialog/switch/menu controls provide semantic labels and focus behavior.
- Desktop tests, workspace checks and desktop build passed. Live authenticated Electron inspection remains a manual step because it uses the user's login state.

## Follow-up polish and remaining scope

Keep actual provider artwork rather than recoloring brands. Cypheria's settings sidebar and account inventory intentionally differ from Codex.

Separate roadmap work: recording skills, advanced MCP configuration, remaining source screenshot states and live authenticated connector verification.

## Marketplace/source follow-up

The directory exposes Public, OpenAI, and Personal. Public is the future Cypheria Marketplace and uses an honest placeholder until that provider ships. OpenAI contains marketplaces matched by the exact official-name allowlist; Personal contains one section per remaining user-added Git or local-directory marketplace, titled from marketplace metadata. Personal marketplace removal uses the shared dialog, starts focus on Cancel, and keeps the target title during its closing animation. At the existing 752×942 preview viewport, the confirmation fits without overflow and clearly separates cancel/destructive actions.

Codex `0.153.4` was checked with the user's ChatGPT session. Cypheria uses the first 50 ordered entries from the remote OpenAI curated marketplace for Popular and only falls back to the server's featured IDs when that marketplace is unavailable. Category groups include the complete matching catalog and Other is always last. The protocol has no publication timestamp or New & Noteworthy member list, so no synthetic recency section is added.

Service tests cover installed/missing/ambiguous/remote/error guards, exact-name IPC and partial source failures. The production UI performs these operations only through Electron IPC against fresh App Server state.

## Plugin detail loading-state addendum

Final result: passed

- Reference: `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-6a7ff369-9527-46ea-b00a-c8006b3e8f9f.png`, the Codex Desktop detail-loading state supplied by the user.
- Implementation capture: `.artifacts/plugin-audit/plugin-detail-loading-cypheria.png`, captured immediately after opening the uncached Slack detail through the running authenticated Electron application.
- Dark-theme capture: `.artifacts/plugin-audit/plugin-detail-loading-cypheria-dark.png`, captured immediately after opening the uncached Outlook Email detail.
- Combined comparison opened for inspection: `.artifacts/plugin-audit/plugin-detail-loading-comparison.png`.

The reference and implementation both retain the plugin breadcrumb while replacing the complete detail content region with an uninterrupted background and a low-contrast mark at its geometric center. Cypheria uses its own 44 px single-color SVG mark instead of OpenAI branding. The mark is automatically vector-traced from a high-contrast generated source, remains crisp at loading size, follows the current foreground/background theme, uses restrained motion when reduced motion is not requested, and has an accessible status label without visible loading copy. The pointer glow in captures belongs to the Computer Use cursor rather than the application.

The former partial loading text and already-rendered plugin header were P1 mismatches because they exposed an incomplete page and could briefly show stale detail affordances. The absolute content-region overlay and conditional detail mount resolve both. Light and dark themes, breadcrumb return, loading-to-detail transition and real App Server data were exercised in the development Electron application. Desktop tests, typecheck and renderer build passed.

## Cypheria brand asset addendum

final result: passed

- Source visual truth: `apps/desktop/renderer/src/assets/brand/cypheria-mark.svg`, 1254 × 1254 SVG canvas, approved by the user as the Cypheria mark.
- Rendered implementation: `apps/desktop/resources/icons/icon.png`, 1024 × 1024 at 1x; the same SVG composition produces the favicon, ICNS and ICO outputs.
- Full-view comparison: `.artifacts/brand/cypheria-mark-to-app-icon.png`, 1800 × 900. Source and implementation were normalized to 800 × 800 and opened together on one neutral canvas.
- Focused small-size evidence: `.artifacts/brand/cypheria-icon-small-sizes.png`, showing actual 16, 32 and 64 px rasterizations at 1x. A focused check was required because favicon recognition is not reliable in the full-view comparison.
- State: default application icon on a light inspection canvas. The running Electron development app was restarted after the main/renderer build; generated renderer HTML contains the hashed SVG favicon link.

No P0/P1/P2 differences remain. The circular C and central spark preserve their geometry; the dark rounded-square carrier, white ring and violet spark improve launcher contrast without introducing a second symbol. The mark remains identifiable at 16 px, with no transparency halo or clipped curve. Typography and copy are not present in the icon; the brand document defines the Cypheria name treatment separately. Spacing follows the mark's source canvas, colors use the documented Ink/Paper/Violet tokens, and SVG remains the vector source while raster files exist only for operating-system compatibility.

The new plugin-detail loading status uses the Lingui message `plugins.detail.loading`; English and Simplified Chinese catalogs compile with no missing entries, and the duplicate screen-reader-only English string was removed.
