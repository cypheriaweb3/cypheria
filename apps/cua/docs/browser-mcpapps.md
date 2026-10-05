## MCP Apps (`mcpapps`)

The `mcpapps` browser reaches MCP Apps that a Cypheria window shows for this task, or that are open outside any task. An App shown only inline in the conversation may not appear; ask the user to open it beside the conversation if you need it.

- `browser.tabs.list()` lists the Apps; `cua.getTab(id, { browser: "mcpapps" })` binds one. This browser cannot create or navigate tabs, and closing an App invalidates its tab.
- Interaction is DOM-based with synthetic events: use `tab.playwright` locators to read, click, and fill. There is no native pointer or keyboard input, so element indices, coordinates, and `tab.cua` are unavailable. `getAXState()` returns a DOM snapshot.
