## Cypheria's built-in browser (`iab`)

The built-in browser is a tab panel inside Cypheria Desktop. Use it for local development pages, dApps, and pages the user wants to see inside Cypheria.

- `cua.createBrowserTab("iab", url, { visible })` opens a tab. `visible: true` shows it to the user in the Thread's browser panel; `false` keeps it in the background. Without `visible`, the tab opens in the background.
- A tab mention of the built-in browser looks like `plugin://browser@cypheria-bundled?mention=tab-v1&source=iab&browserId=iab&tabId=…&title=…&url=…`. Pass the whole link to `cua.getTab({ mention })`. It fails when the tab's title or URL changed since the user mentioned it; then list the tabs and ask the user if you are unsure.
- `tab.requestManualHandoff(reason)` shows the tab to the user for a step only they should do, such as signing in.

### Tab cleanup

- Tabs you open close automatically when the turn ends unless you mark them.
- Call `tab.markDeliverable()` when the live tab is itself the result the user asked for, such as a page they asked to keep open or a submitted form's result.
- Call `tab.markHandoff()` only when work must continue from the live page in a later turn, such as a page waiting for the user.
- Marks last for the turn. Re-mark tabs that must outlive a later turn before it ends.
