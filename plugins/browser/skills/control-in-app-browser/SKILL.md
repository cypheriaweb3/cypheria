---
name: control-in-app-browser
description: "Control Cypheria's built-in in-app browser for opening, navigating, inspecting visible page state, clicking, typing, screenshots, and local web/dApp testing via node-repl."
---

# Cypheria Built-In Browser Automation

Use this skill for browser automation tasks such as opening web pages, inspecting DOM structure, navigating, testing local apps or dApps, clicking, typing, taking screenshots, and reading page state.

## Environment & Platform Constraints

- **Built-in browser only**: Cypheria provides a built-in desktop browser (`iab`). External browsers (Chrome, Edge) and remote browsers are not supported.
- **Node REPL integration**: Browser control is executed using the Node REPL `js` tool (`mcp__node_repl__js` or `js`). Do not attempt to call separate `browser_*` MCP tools directly.

## Bootstrap

Run browser setup code through the Node REPL `js` tool.

The `browser-client` module is located at `scripts/browser-client.mjs` relative to this plugin's root directory. Import it and initialize the agent runtime:

```js
const { setupBrowserRuntime } = await import("<plugin root>/scripts/browser-client.mjs");
const agent = await setupBrowserRuntime();
```

Initialize the runtime once. Use `const` for stable handles and `let` for changing values; reassign instead of redeclaring.

### Selecting the Browser

In Cypheria, select the built-in browser (`iab`) and read its documentation:

```js
const browser = await agent.browsers.get("iab");
nodeRepl.write(await browser.documentation());
```

Once a browser connection is established, reuse the `browser` binding across turns.

## Controlling Tabs & Navigation

Bind tabs directly from the selected browser:

```js
// Open a new tab
const tab = await browser.tabs.new();

// Navigate to a URL (http, https, localhost, dApp)
await tab.goto("http://localhost:3000");

// Check current tabs
const tabs = await browser.tabs.list();
```

If a tab becomes stale or closed, obtain or create a fresh tab from `browser.tabs.new()`.

## Page Interaction via Playwright API

The `tab.playwright` interface provides standard Playwright-style locators and actions:

```js
// Click elements via selector or ref
await tab.playwright.locator("button[type='submit']").click();

// Fill and type into input fields
await tab.playwright.locator("input#search").fill("Cypheria Web3");

// Key presses
await tab.playwright.locator("input#search").press("Enter");

// Evaluate JavaScript in page context
const title = await tab.evaluate(() => document.title);
nodeRepl.write(title);

// Visual screenshot
await tab.screenshot();
```

## DOM Inspection

Inspect the page structure using snapshot:

```js
const snapshot = await tab.playwright.snapshot();
nodeRepl.write(snapshot);
```

## Tab Lifecycle: Temporary vs Deliverable vs Handoff

In Cypheria, tabs opened during an Agent turn are managed with explicit lifecycles:

1. **Temporary Tabs (Default)**:
   Any new tab opened defaults to `temporary`. When the turn completes (`turn_ended`), temporary tabs are automatically closed to keep the workspace tidy.

2. **Deliverable Tabs**:
   When a page is a meaningful result of the user's task (e.g. running local dev server, generated preview, or requested dashboard), mark it as deliverable:
   ```js
   await tab.markDeliverable();
   ```
   Deliverable tabs stay open across turns and are pinned for the user.

3. **Handoff Tabs**:
   When human intervention is required (e.g. signing a Web3 transaction, solving a captcha, or manual login), mark it for handoff:
   ```js
   await tab.markHandoff();
   // Or request explicit manual handoff with reason:
   await tab.requestManualHandoff("Please connect wallet and confirm the signature");
   ```
   Handoff tabs stay open and notify the user to take over.
