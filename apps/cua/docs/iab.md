## Built-in browser (`cua.iab`)

Cypheria's built-in browser shows tabs inside Cypheria. Use it for local development servers, files, dApps, and pages the user wants to see in Cypheria. Its tabs belong to this task; it has no access to the user's external browsers.

```typescript
type Ref = string; // "@e12"
type Point = [x: number, y: number];

declare const cua: {
  iab: {
    listTabs(options?: { emit?: boolean }): Promise<{ id: string; host?: string; kind: "web" | "dapp"; title: string; url: string; active: boolean }[]>;
    getTab(reference: string | { mention: string } | { url: string }): Promise<IabTab>;
    newTab(url?: string, options?: { kind?: "web" | "dapp"; host?: string }): Promise<IabTab>;
  };
};

interface IabTab {
  readonly id: string;
  readonly kind: "web" | "dapp";
  url(): string;
  title(): string;
  snapshot(options?: { full?: boolean; emit?: boolean }): Promise<string>;
  screenshot(options?: { fullPage?: boolean; emit?: boolean }): Promise<Uint8Array>;
  click(target: Ref | Point, options?: { button?: "left" | "right" | "middle"; double?: boolean; modifiers?: ("Alt" | "Control" | "Meta" | "Shift")[] }): Promise<void>;
  fill(ref: Ref, value: string): Promise<void>;
  type(text: string, options?: { ref?: Ref }): Promise<void>;
  press(key: string, options?: { ref?: Ref }): Promise<void>; // "Enter", "Escape", "ArrowDown"
  hover(target: Ref | Point): Promise<void>;
  select(ref: Ref, value: string): Promise<void>;
  drag(from: Ref | Point, to: Ref | Point): Promise<void>;
  scroll(options: { dx?: number; dy: number; ref?: Ref }): Promise<void>;
  upload(ref: Ref, filePaths: string[]): Promise<void>;
  evaluate(script: string | Function, options?: { ref?: Ref }): Promise<unknown>;
  waitFor(condition: { text: string } | { url: string }, timeoutMs?: number): Promise<void>;
  logs(options?: { maxEntries?: number; emit?: boolean }): Promise<unknown>;
  resize(width: number, height: number): Promise<void>;
  goto(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  close(): Promise<void>;
  markDeliverable(): Promise<void>;
  markHandoff(): Promise<void>;
  requestHandoff(reason: string): Promise<"completed" | "dismissed">;
  scanQr(options?: { ref?: Ref }): Promise<string | null>;
  extractAssets(options?: { kinds?: ("image" | "svg" | "font" | "stylesheet")[]; emit?: boolean }): Promise<unknown>;
}
```

- `newTab` opens a background tab. `kind: "dapp"` opens a dApp tab with Cypheria's wallet provider; ordinary web tabs have no wallet. Wallet connection and signing prompts are approved by the user through Cypheria's policy, never by you.
- A prompt link `plugin://browser@cypheria-bundled?mention=tab-v1&tabId=…&title=…&url=…` is the user pointing at a built-in tab: pass it to `getTab({ mention })`. It fails if the tab closed or its title or URL changed; report that instead of opening another tab.
- `evaluate` runs in the page with the page's privileges; use it to read data, not to bypass the page's own controls.
- `requestHandoff(reason)` brings the tab forward and waits for the user to finish a step only they should do, such as signing in.
- `logs()` returns recent console messages and network timing, useful when testing a local app.
- `upload` paths must be inside the task's working directory.
