---
name: control-in-app-browser
description: "Control Cypheria's built-in browser for opening, navigating, inspecting, clicking, typing, taking screenshots, scanning QR codes, extracting assets, and local web testing."
---

# Cypheria Built-In Browser Automation

Use this skill to control Cypheria's built-in desktop browser webview.

## Core Capabilities

The `browser` MCP server exposes tools prefixed with `browser_` directly to the Agent:

1. **Tab & Navigation Management**:
   - `browser_list_tabs`: List active browser tabs with their IDs, URLs, and titles.
   - `browser_new_tab`: Open a new tab (optionally at a URL).
   - `browser_close_tab`: Close a tab.
   - `browser_select_tab`: Activate / focus a tab.
   - `browser_navigate`: Navigate a tab to a target URL (supports `http://`, `https://`, `localhost`, `file://`).
   - `browser_back`, `browser_forward`, `browser_reload`: History and refresh controls.
   - `browser_resize_viewport`: Adjust the browser viewport dimensions (`width`, `height`).

2. **Inspection & Extraction**:
   - `browser_snapshot`: Take a structured DOM snapshot of the current page. Returns indexed element references (`ref: "e12"`), accessibility roles, tag names, and bounding boxes.
   - `browser_screenshot`: Capture a visual viewport screenshot (PNG base64).
   - `browser_extract_text`: Extract plain text or markdown content from the page or a container.
   - `browser_extract_assets`: Extract page assets (`image`, `svg`, `font`, `stylesheet`) with their resolved URLs and optional names.
   - `browser_scan_qr`: Scan and decode QR codes (such as 2FA codes, authentication challenges, or address QR codes) on the page. You can target the entire viewport or scope to a specific `selector` or `point`.

3. **Interaction**:
   - `browser_click`: Click an element using `ref` (from snapshot), direct `selector` (CSS or XPath), or coordinate `point` (`{ x, y }`).
   - `browser_fill`: Clear and type text into an input field (`ref` or `selector`).
   - `browser_type`: Type characters into the focused element or target (`ref`, `selector`, or `text`).
   - `browser_select`: Select option(s) in a dropdown (`ref` or `selector`).
   - `browser_hover`: Move mouse over an element (`ref`, `selector`, or `point`).
   - `browser_drag`: Drag and drop from start to end location.
   - `browser_keypress`: Send individual key presses (e.g. `Enter`, `Tab`, `Escape`).
   - `browser_scroll`: Scroll horizontally and/or vertically (`deltaX`, `deltaY`, `ref`, `selector`, or `point`).
   - `browser_upload`: Upload file paths into file input elements (`ref` or `selector`).
   - `browser_evaluate`: Run sandboxed JavaScript expressions inside the page context and receive JSON results.

## Tab Lifecycle: Temporary vs. Deliverable vs. Handoff

In Cypheria, tabs opened during an Agent turn are managed with explicit lifecycles:

- **Temporary Tabs (Default)**:
  Any new tab opened by the Agent (`browser_new_tab`) defaults to `temporary`. When the Agent finishes its turn (`turn-completed`), temporary tabs are automatically closed to keep the user's workspace tidy.
- **Deliverable Tabs**:
  When a page is a meaningful result of the user's task (e.g., a local dev preview, generated dashboard, or target documentation), call `browser_mark_deliverable` with the `browserId`. Deliverable tabs stay open across turns and are pinned/surfaced for the user.
- **Handoff Tabs**:
  When human intervention is required (e.g., user authentication, solving an interactive captcha, signing a transaction, or manual confirmation), call `browser_mark_handoff` or `browser_request_manual_handoff`. Handoff tabs stay open and signal the user to take over.

## Best Practices

1. **Snapshot Before Interacting**:
   Start by taking a `browser_snapshot` to inspect page structure and get element `ref` IDs.
2. **Robust Selectors**:
   If an element does not have a stable `ref` from a dynamic re-render, you can pass a CSS selector (e.g., `button[type="submit"]`) or XPath (e.g., `//button[contains(text(), "Save")]`) directly to interaction tools.
3. **QR Codes**:
   When encountering a QR code, call `browser_scan_qr` to retrieve the decoded string (URL, otpauth URI, etc.).
4. **Local Development**:
   For commands like "check my app on port 3000", navigate to `http://localhost:3000`, snapshot or screenshot the interface, and mark the tab as a deliverable if the user asked to see it.
