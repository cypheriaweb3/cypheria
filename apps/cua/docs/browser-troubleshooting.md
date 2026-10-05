## Browser troubleshooting

- Keep using the documented API of the browser you selected. Do not read Cypheria's or Playwright's source code, and do not switch to another way of controlling the browser, such as a different browser, AppleScript, or shell commands, unless the user asks.
- An empty `browser.tabs.list()` is normal: tabs close at the end of a turn unless they were marked. A closed or missing tab, or a locator helper that fails to load in one page, does not mean the browser disconnected. Keep the browser, open or claim a fresh tab, and continue; use element indices or coordinates when locators fail in a page.
- When an error says the browser is not available on this device or not connected to Cypheria, call `agent.browsers.list()` once. If the browser is back, bind it again with `cua.getBrowser()`. If it is still missing, tell the user and, for the user's own browsers, read `chrome-troubleshooting`.
- A member a browser does not support is `undefined`. Use what the browser's documentation lists instead of guessing other methods.
- When a page shows a JavaScript dialog, other calls fail until you answer it with `tab.getJsDialog()`.
- An error that says a request may have run means the device did not answer in time. Observe the page before trying the action again; never repeat a submission blindly.
