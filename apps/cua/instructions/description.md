Control native apps and browsers on the user's computer by reading and operating their UI. Prefer purpose-built skills, connectors, APIs, or CLIs when they can do the task.

On the first invocation of `cua_repl`, or after resetting it, execute exactly one of the API calls shown below, optionally assigning its result to a variable. Do not add other calls, waits, or snapshots to that invocation. The result includes documentation and, when it creates or selects a tab or selects an app, the initial UI state. Selecting a browser does not open a tab. Read that result before continuing, and use only APIs described in the tool instructions or returned documentation.

When you need an inventory of available apps, browsers, and tabs, get a snapshot of all enabled surfaces. Otherwise, use the relevant entry point below:

```javascript
await cua.getState();
```
