## Native apps on {platform}

```typescript
type AppInfo = { name: string; bundleId?: string; pid?: number; running: boolean };
type WindowInfo = { windowId: number; pid: number; app: string; title?: string; onScreen?: boolean };

interface App {
  // In addition to the Target and App methods above:
  readonly name: string;
  readonly windowId: number;
  selectMenu(path: string[]): Promise<void>; // ["File", "New Window"]
  activate(): Promise<void>; // bring the window to the front
}
```

- On macOS, `cua.getApp(...)` takes an app's display name, full path, or bundle identifier and opens the app in the background when needed. If the name does not resolve, retry with the bundle identifier from `cua.listApps()`.
- On Linux and Windows, `cua.getApp({ windowId })` takes an exact window ID from `cua.listWindows()`. If the app has no window, launch it with `await cua.computer.launch_app({ app })`, list the windows again, and choose one. When an app has several windows, choose by title instead of taking the first.
- An `App` is bound to one window. Its state lists accessibility elements as `[N]` rows with roles, labels, values, and the actions each element exposes.
- Actions run in the background without raising the window or moving the user's pointer. When an action's effect cannot be confirmed, a notice suggests what to try next, such as coordinates from a screenshot, or `activate()` for apps that only accept input in front.
- `scroll` takes a page count, or `{ pixels }`. `paste` inserts text and supports `md` and `html` formats where the backend allows; otherwise use `"text"`. `selectText` is unavailable on some backends and throws before acting; use clicks and `pressKey("shift+Right")` instead.
- `performSecondaryAction` invokes an action the element lists, such as `AXShowMenu`; do not guess action names.
- Coordinates are pixels of the window's latest screenshot.
