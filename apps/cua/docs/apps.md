## Native apps on {platform}

```typescript
type Point = [x: number, y: number];
type Target = number | Point; // an element index from the latest state, or screenshot pixels

declare const cua: {
  getApp(target: string | { windowId: number }): Promise<App>;
  listApps(options?: { emit?: boolean }): Promise<AppInfo[]>;
  listWindows(options?: { pid?: number; emit?: boolean }): Promise<WindowInfo[]>;
};

interface App {
  readonly name: string;
  readonly pid: number;
  readonly windowId: number;
  getState(options?: { full?: boolean; query?: string; emit?: boolean }): Promise<string>;
  getScreenshot(options?: { emit?: boolean }): Promise<Uint8Array>;
  getStateAndScreenshot(options?: { full?: boolean; query?: string; emit?: boolean }): Promise<{ state: string; screenshot?: Uint8Array }>;
  click(target: Target, options?: { button?: "left" | "right" | "middle"; count?: number; modifiers?: ("cmd" | "ctrl" | "alt" | "shift" | "fn")[] }): Promise<{ notice?: string }>;
  typeText(text: string, options?: { element?: number; point?: Point }): Promise<{ notice?: string }>;
  pressKey(key: string): Promise<{ notice?: string }>; // "Return", "Tab", "cmd+c", "shift+Tab"
  scroll(target: Target, direction: "up" | "down" | "left" | "right", amount?: number, options?: { by?: "line" | "page" }): Promise<{ notice?: string }>;
  drag(from: Point, to: Point): Promise<{ notice?: string }>;
  setValue(element: number, value: string): Promise<{ notice?: string }>;
  performAction(element: number, action: string): Promise<{ notice?: string }>;
  selectMenu(path: string[]): Promise<{ notice?: string }>; // ["File", "New Window"]
  activate(): Promise<{ notice?: string }>;
}
```

- On macOS, `getApp` takes an app's display name, bundle ID, or path and opens it in the background when it is not running. On Linux and Windows it takes `{ windowId }` from `listWindows()`; if the app has no window yet, ask the user to open it. When an app has several windows, choose by title instead of taking the first.
- An `App` is bound to one window. State lists its accessibility elements as `[N]` rows with roles, labels, values, and available actions, followed by a screenshot when requested.
- Actions run in the background without raising the window or moving the user's pointer. An agent cursor shows where you act. When an action cannot be verified or appears to do nothing, its result carries a `notice` (also displayed) suggesting the next step, such as using coordinates from a screenshot or `activate()` for apps that only accept input in front.
- `typeText` inserts text at the focused element; pass `element` or `point` to focus a field first. `pressKey` sends one key or chord.
- `performAction` invokes an action the element lists, such as `AXShowMenu`; do not invent action names. `setValue` replaces the value of an editable element directly.
- Coordinates are pixels of the window's latest screenshot.
- After any action short of an obvious confirmation, observe again before relying on the result.
