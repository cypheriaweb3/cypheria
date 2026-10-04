## Working with web pages

- A snapshot is the page's accessibility tree. Interactive elements carry refs such as `@e12`; pass them to actions. Refs belong to the latest snapshot of that tab.
- Prefer refs and the page's own controls over guessed URLs. One direct navigation to an obvious URL is fine for a lookup; do not iterate through URL variants.
- Do not `goto` the URL a tab already shows; that reloads it and can discard the user's input. Use `reload()` when you mean it.
- Read pages from what is visible, not from source order: the "first result" is the first one the user sees.
- When an interaction has no effect, look for what blocks it (a dialog, overlay, disabled control, or changed page) before retrying, and do not repeat the same action blindly.
- After you change something on a site, or when you ask the user to approve an action, include a screenshot of the relevant page in your reply so they can verify it.
- Tabs you open are temporary: they close when the turn ends. Call `markDeliverable()` on a tab that is itself a result for the user, and `markHandoff()` when work must continue in that tab in a later turn (for example while the user signs in). A marked tab stays open after the turn; when a later turn works in that browser again, mark again any tab that must also outlive that turn. Do not mark search, research, or intermediate tabs.
