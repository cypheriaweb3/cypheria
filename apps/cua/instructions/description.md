Control native apps, browsers, and MCP Apps on the user's computer by reading and operating their UI. Prefer purpose-built skills, connectors, APIs, or CLIs when they can do the task.

On the first invocation of `cua_repl`, or after resetting it, execute exactly one of the entry-point calls below, optionally assigning its result to a variable. Do not add other calls, waits, or snapshots to that invocation. Its result includes the documentation for that surface and, when it selects a tab or app, the current UI state. Read that result before continuing, and use only APIs described in the tool instructions or returned documentation.

For an inventory of every enabled surface (apps, built-in browser tabs, external browsers and their tabs, MCP Apps):

```javascript
await cua.getState();
```
