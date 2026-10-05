## Browser capability: `visibility`

Shows or hides the browser beside the conversation. Work in the background by default; show the browser when the user asks to watch, when they need to act in a page themselves, or when seeing the page live helps them follow along.

```typescript
const visibility = await browser.capabilities.get("visibility");

interface VisibilityCapability {
  get(): Promise<boolean>; // whether the user can see the browser now
  set(visible: boolean): Promise<void>; // show or hide it
}
```

`cua.createBrowserTab(browserId, url, { visible: true })` opens a tab and shows the browser in one step. Hiding the browser does not close its tabs.
