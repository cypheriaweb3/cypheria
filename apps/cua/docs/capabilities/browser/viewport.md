## Browser capability: `viewport`

Fixes the page size of this task's tabs, including tabs opened later, until it is reset. Leave the default size for ordinary work. Set a size only when the user asks for one, when testing a responsive layout or device width, or when the answer depends on a specific size. Do not resize to make a screenshot bigger; take a full-page screenshot instead.

```typescript
const viewport = await browser.capabilities.get("viewport");

interface ViewportCapability {
  set(size: { width: number; height: number }): Promise<void>; // CSS pixels, 1 to 10000
  reset(): Promise<void>; // back to the size of the browser pane
}
```

Call `reset()` before you finish unless the user wants to keep the size.
