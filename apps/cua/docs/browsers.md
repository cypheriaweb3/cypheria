## External browsers (`cua.browsers`)

`cua.browsers` controls the user's own Chromium browsers — Google Chrome, Microsoft Edge, Brave, Vivaldi, Opera, or Chromium — with their tabs, cookies, and signed-in sessions. Use it only when the task needs that state; use the built-in browser otherwise.

```typescript
type Ref = string; // "@e12"
type Point = [x: number, y: number];
type BrowserId = "chrome" | "edge" | "brave" | "vivaldi" | "opera" | "chromium";

declare const cua: {
  browsers: {
    list(options?: { host?: string; emit?: boolean }): Promise<{ id: BrowserId; host: string; name: string; installed: boolean; connectable: boolean; setup?: string }[]>;
    get(id: BrowserId, options?: { host?: string }): Promise<ExternalBrowser>;
    getTab(reference: { mention: string }): Promise<ExternalTab>;
  };
};

interface ExternalBrowser {
  readonly id: BrowserId;
  readonly name: string;
  readonly host: string; // the device it runs on
  tabs(options?: { emit?: boolean }): Promise<{ id: string; title: string; url: string; controlled: boolean }[]>;
  claimTab(tabId: string): Promise<ExternalTab>;
  newTab(url?: string): Promise<ExternalTab>;
}

interface ExternalTab {
  readonly id: string;
  readonly browserId: BrowserId;
  url(): string;
  title(): string;
  snapshot(options?: { full?: boolean; emit?: boolean }): Promise<string>;
  screenshot(options?: { fullPage?: boolean; annotate?: boolean; emit?: boolean }): Promise<Uint8Array>;
  click(target: Ref | Point, options?: { button?: "left" | "right" | "middle"; double?: boolean }): Promise<void>;
  fill(ref: Ref, value: string): Promise<void>;
  type(text: string, options?: { ref?: Ref }): Promise<void>;
  press(key: string, options?: { ref?: Ref }): Promise<void>; // "Enter", "Control+a"
  hover(target: Ref | Point): Promise<void>;
  select(ref: Ref, ...values: string[]): Promise<void>;
  check(ref: Ref, checked?: boolean): Promise<void>;
  scroll(direction: "up" | "down" | "left" | "right", options?: { pixels?: number; ref?: Ref }): Promise<void>;
  drag(from: Ref, to: Ref): Promise<void>;
  upload(ref: Ref, paths: string[]): Promise<void>;
  get(what: "text" | "html" | "value" | "title" | "url", ref?: Ref): Promise<string>;
  evaluate(script: string | Function): Promise<unknown>;
  waitFor(condition: { text: string } | { url: string } | { selector: string } | { ms: number }): Promise<void>;
  goto(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  acceptDialog(text?: string): Promise<void>;
  dismissDialog(): Promise<void>;
  close(): Promise<void>;
  markDeliverable(): Promise<void>;
  markHandoff(): Promise<void>;
}
```

- `cua.browsers.get(id)` fails with setup instructions when the browser is not running or remote debugging is off. Relay those instructions to the user; the browser may also ask them to allow the connection. Do not try to start or reconfigure the browser yourself.
- A prompt link `plugin://chrome@cypheria-bundled?mention=tab-v1&browserId=…&tabId=…&title=…&url=…` is the user pointing at one of their tabs: pass it to `cua.browsers.getTab({ mention })`. It fails if the tab closed or changed; report that rather than using another tab.
- To work in a tab the user already has open, call `tabs()`, choose the tab by its title and URL, and `claimTab(id)` it. Only claim IDs from the current `tabs()` result. Claiming does not move the tab; when the turn ends, an unmarked claimed tab is released and stays open.
- `newTab` opens a tab this task owns. Owned tabs close when the turn ends unless marked.
- Snapshots list interactive elements. Use `get("text", ref)` or `evaluate` to read longer content.
- `alert` dialogs are accepted automatically; `confirm` and `prompt` dialogs block the page until you call `acceptDialog` or `dismissDialog`, and a pending dialog is reported in the action's result.
- Signed-in sessions are the user's. Do not sign out, change account settings, or read cookies and storage beyond what the task needs.
