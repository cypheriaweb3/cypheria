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

The reference has a different signed-in catalog and settings sidebar. Cypheria deliberately retains its existing shell, settings entries and English copy. Sample item counts and logos are not evidence about the user's installed plugins.

## Findings and iterations

1. P2: management chrome was split between a redundant directory toolbar and content header; search sat above tabs and checked switches were blue. Fixed: title-level Browse/Add actions, five count tabs with adjacent search, neutral primary actions and scoped violet switches.
2. P2: content and Add menu were too wide once source density was measured. Fixed: management content 768 px, directory content 720 px, compact Add menu. Revised normalized comparison confirms the intended quiet single-column settings hierarchy.
3. P0: validating an empty MCP URL threw while rendering the form. Fixed URL refinement to return validation failure; added an incomplete-form regression test and verified empty/valid forms in the browser. Earlier console errors at 07:26 UTC were from this fixed defect; no later errors appeared in the final console log check.
4. P2: at 390 px, integration rows pushed connection buttons outside the clipped content region and header text wrapped excessively. Fixed row minimum width, wrapping header action group and nonwrapping horizontally scrollable tabs. Ready/Connect controls remained inside the viewport; the last tab was reachable by interaction and displayed its Update action.

## Required fidelity surfaces

- Typography: existing system font, 28 px page title, 14 px rows, restrained weight and one-line secondary descriptions. English text varies from the Chinese reference without changing hierarchy.
- Layout: compact title actions, five tab counts, adjacent desktop search, single-column 68–72 px rows, trailing settings switches; narrow header wraps and tab strip scrolls.
- Colors: neutral surfaces, subtle hover backgrounds, violet enabled switches, status colors only for actual runtime state. No green success state is inferred from clicking a connection link.
- Assets: server-provided logos in Electron; documented Simple Icons in labeled preview. Missing metadata uses library fallback icons, not invented branding. No new raster assets were required for this slice.
- Copy: app accessibility, enabled state and callable state remain distinct. MCP runtime connection and stored authentication are separate. Preview login explicitly says it does not authorize anything.

## Interaction verification

- Apps tab selection, enable/disable status synchronization, search and empty results.
- MCP tab, server detail dialog, tool inventory, OAuth preview (does not fake success), and standalone switches.
- Add menu → MCP form; empty submit disabled, valid fields enable submit, successful preview addition increases count and shows new server. Existing-name rejection and unsafe URLs covered by service tests.
- Keyboard Escape dismisses menu; narrow tab navigation reaches Markets. Shared dialog/switch/menu controls provide semantic labels and focus behavior.
- 47 desktop tests, workspace checks and desktop build passed. Live authenticated Electron OAuth was not executed; browser tests are sample-only.

## Follow-up polish and remaining scope

P3: sample brand marks are monochrome, while live catalog artwork may be multicolor. Keep actual provider artwork rather than recoloring brands. Cypheria's settings sidebar and account inventory intentionally differ from Codex.

Separate roadmap work: recording skills, advanced MCP configuration, remaining source screenshot states and live authenticated connector verification.

## Marketplace/source follow-up

The directory exposes only the Public and Personal source tabs shown by the desktop reference. Created by me, Shared with me, Local marketplaces and Workspace are content sections inside Personal rather than peer source tabs. Personal has explicit empty-state copy. Local source removal uses the shared dialog, starts focus on Cancel, and keeps the target title during its closing animation. At the existing 752×942 preview viewport, the confirmation fits without overflow and clearly separates cancel/destructive actions.

Browser preview verification: Cancel retains both markets; confirmed removal changes Markets 2 to Markets 1 and removes only Local examples. No real marketplace was removed. Service tests cover installed/missing/ambiguous/remote/error guards, exact-name IPC and partial source failures. This is a functional follow-up, not a new claim of complete screenshot parity.
