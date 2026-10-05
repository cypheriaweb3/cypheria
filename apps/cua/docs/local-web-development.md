## Local web development

- Prefer Cypheria's built-in browser (`iab`) for apps served on `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, or `file:` URLs; `agent.browsers.getForUrl(url)` picks it for you.
- After changing code or rebuilding, reload the page with `tab.reload()` unless the app's dev server reloads it for you, then observe again before checking the result.
- Read the page's console with `tab.dev.logs({ levels: ["error", "warn"] })` when something does not render or a request fails.
- To check a layout at a specific width, use the browser's `viewport` capability and reset it when you are done.
