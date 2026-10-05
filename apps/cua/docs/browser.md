## Browsers

`cua.getBrowser()` returns an `agent.browsers` browser. Its tabs are `Tab` objects that `cua.getTab()` and `cua.createBrowserTab()` also return, extended with the `Target` methods above. The full API follows; a member this browser does not support is `undefined`.

```typescript
interface Browsers {
  list(): Promise<BrowserInfo[]>;
  get(id: string): Promise<Browser>; // an ID, "iab", "mcpapps", or a family such as "chrome"
  getDefault(): Promise<Browser>;
  getForUrl(url: string): Promise<Browser>;
}

interface Browser {
  readonly browserId: string;
  readonly tabs: Tabs;
  readonly user?: BrowserUser; // the user's own open tabs
  readonly capabilities?: { list(): Promise<{ id: string; description: string }[]>; get(id: string): Promise<any> };
  documentation(): Promise<string>;
  nameSession?(name: string): Promise<void>;
}

interface BrowserUser {
  openTabs(): Promise<{ id: string; providerTabId?: string; title?: string; url?: string; lastOpened?: string; tabGroup?: string }[]>;
  claimTab(tab: string | { id: string }): Promise<Tab>;
}

interface Tabs {
  list(): Promise<TabInfo[]>; // the tabs this task controls
  get(id: string): Promise<Tab>;
  new?(): Promise<Tab>;
  selected?(): Promise<Tab | undefined>;
}

interface Tab {
  readonly id: string;
  readonly ax?: AXAPI;
  readonly cua?: CUAAPI;
  readonly dom_cua?: DomCUAAPI;
  readonly playwright: PlaywrightAPI;
  readonly clipboard?: { read(): Promise<ClipboardItem[]>; readText(): Promise<string>; write(items: ClipboardItem[]): Promise<void>; writeText(text: string): Promise<void> };
  readonly content?: {
    exportGsuite(type: "pdf" | "md" | "xlsx" | "csv" | "docx" | "pptx"): Promise<string>; // a Google Docs (pdf, md, docx), Sheets (pdf, xlsx, csv), or Slides (pdf, pptx) tab; returns the saved path
    exportYouTubeTranscript(): Promise<string>; // a youtube.com/watch tab; returns the saved .txt path
  };
  readonly dev?: { logs(options?: { filter?: string; levels?: ("debug" | "info" | "log" | "warn" | "error")[]; limit?: number }): Promise<{ level: string; message: string; timestamp: string; url?: string }[]> };
  title(): Promise<string | undefined>;
  url(): Promise<string | undefined>;
  screenshot(options?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Uint8Array>;
  goto?(url: string): Promise<void>;
  back?(): Promise<void>;
  forward?(): Promise<void>;
  reload?(): Promise<void>;
  close?(): Promise<void>;
  getJsDialog?(): Promise<undefined | { type: "alert" | "beforeunload" | "confirm" | "prompt"; message: string; accept?(text?: string): Promise<void>; dismiss(): Promise<void> }>;
  markDeliverable?(): Promise<void>;
  markHandoff?(): Promise<void>;
}

interface AXAPI {
  get(mode?: "state", options?: { disableDiffing?: boolean }): Promise<string>;
  get(mode: "screenshot"): Promise<Uint8Array>;
  get(mode: "both", options?: { disableDiffing?: boolean }): Promise<{ state: string; screenshot?: Uint8Array }>;
  write(mode?: "state" | "screenshot" | "both", options?: { disableDiffing?: boolean }): Promise<void>; // displays it
  click(target: number | Vec2, options?: ClickOptions): Promise<void>;
  drag(from: Vec2, to: Vec2): Promise<void>;
  paste(elementIndex: number | null, text: string, options?: PasteOptions): Promise<void>;
  performSecondaryAction(elementIndex: number, action: string): Promise<void>;
  pressKey(elementIndex: number | null, key: string): Promise<void>;
  scroll(target: number | Vec2, direction: Direction, pages?: number): Promise<void>;
  selectText(elementIndex: number, text: string, options?: SelectTextOptions): Promise<void>;
  setValue(elementIndex: number, value: string): Promise<void>;
  typeText(elementIndex: number | null, text: string): Promise<void>;
}

interface CUAAPI {
  click(options: { x: number; y: number; button?: number; keypress?: string[] }): Promise<void>; // button: 1 left, 2 middle, 3 right
  double_click(options: { x: number; y: number; keypress?: string[] }): Promise<void>;
  drag(options: { path: { x: number; y: number }[]; keys?: string[] }): Promise<void>;
  keypress(options: { keys: string[] }): Promise<void>; // one chord, such as ["CTRL", "A"]
  move(options: { x: number; y: number; keys?: string[] }): Promise<void>;
  scroll(options: { x: number; y: number; scrollX: number; scrollY: number; keypress?: string[] }): Promise<void>;
  type(options: { text: string }): Promise<void>;
}

interface DomCUAAPI {
  get_visible_dom(): Promise<{ node_id: string; tag: string; role?: string; text?: string; bounds: number[] }[]>;
  click(options: { node_id: string }): Promise<void>;
  double_click(options: { node_id: string }): Promise<void>;
  keypress(options: { keys: string[] }): Promise<void>;
  scroll(options: { node_id?: string; x: number; y: number }): Promise<void>;
  type(options: { text: string }): Promise<void>;
}

interface PlaywrightAPI {
  domSnapshot(): Promise<string>;
  elementInfo(options: { x: number; y: number; includeNonInteractable?: boolean }): Promise<ElementInfo[]>;
  elementScreenshot(options: { x: number; y: number; includeNonInteractable?: boolean }): Promise<Uint8Array>;
  evaluate<R, A>(pageFunction: string | ((arg: A) => R | Promise<R>), arg?: A, options?: { timeoutMs?: number }): Promise<R>;
  expectNavigation<T>(action: () => Promise<T>, options?: { timeoutMs?: number; url?: string | RegExp; waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<T>;
  locator(selector: string, options?: FilterOptions): Locator;
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): Locator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTestId(testId: string): Locator;
  frameLocator(frameSelector: string): FrameLocator; // has the same locator builders
  waitForEvent(event: "download", options?: { timeoutMs?: number }): Promise<{ path(options?: { timeoutMs?: number }): Promise<string | null> }>;
  waitForEvent(event: "filechooser", options?: { timeoutMs?: number }): Promise<{ isMultiple(): boolean; setFiles(files: string | string[]): Promise<void> }>;
  waitForLoadState(options?: { state?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number }): Promise<void>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  waitForURL(url: string | RegExp, options?: { timeoutMs?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }): Promise<void>;
}

type FilterOptions = { has?: Locator; hasNot?: Locator; hasText?: string | RegExp; hasNotText?: string | RegExp; visible?: boolean };

interface Locator {
  // Builders
  locator(selector: string, options?: FilterOptions): Locator;
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): Locator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTestId(testId: string): Locator;
  filter(options: FilterOptions): Locator;
  and(locator: Locator): Locator;
  or(locator: Locator): Locator;
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  all(): Promise<Locator[]>;
  // Reads
  count(): Promise<number>;
  textContent(options?: { timeoutMs?: number }): Promise<string | null>;
  innerText(options?: { timeoutMs?: number }): Promise<string>;
  allTextContents(options?: { timeoutMs?: number }): Promise<string[]>;
  getAttribute(name: string, options?: { timeoutMs?: number }): Promise<string | null>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeoutMs?: number }): Promise<void>;
  evaluate<R, A>(fn: string | ((element: Element, arg: A) => R), arg?: A): Promise<R>; // the locator must match one element
  evaluateAll<R, A>(fn: string | ((elements: Element[], arg: A) => R), arg?: A): Promise<R>;
  downloadMedia(options?: { timeoutMs?: number }): Promise<string>; // saves the image, video, audio, or link the element points to; returns its path
  // Actions; they wait for one visible, enabled element
  click(options?: { button?: "left" | "right" | "middle"; modifiers?: string[]; force?: boolean; timeoutMs?: number }): Promise<void>;
  dblclick(options?: { button?: "left" | "right" | "middle"; modifiers?: string[]; timeoutMs?: number }): Promise<void>;
  fill(value: string, options?: { timeoutMs?: number }): Promise<void>; // replaces the value
  type(value: string, options?: { timeoutMs?: number }): Promise<void>; // keeps the existing value
  pressSequentially(value: string, options?: { timeoutMs?: number }): Promise<void>;
  press(key: string, options?: { timeoutMs?: number }): Promise<void>;
  check(options?: { force?: boolean; timeoutMs?: number }): Promise<void>;
  uncheck(options?: { force?: boolean; timeoutMs?: number }): Promise<void>;
  setChecked(checked: boolean, options?: { force?: boolean; timeoutMs?: number }): Promise<void>;
  selectOption(value: string | { value?: string; label?: string; index?: number } | (string | object)[], options?: { timeoutMs?: number }): Promise<string[]>;
}
```

### Accessibility first

Use the tab's accessibility state and element indices (`tab.getAXState()`, `tab.click(42)`, or `tab.ax.*`) as the main way to read and operate pages. The state always starts with the page's title and URL. Each interactable element ends with its index in square brackets, such as `button "Submit" [42]`; other bracketed words such as `[checked]` or `[level=2]` are states. Elements inside frames that share the page's process are included under their `iframe`.

`performSecondaryAction` accepts `ShowMenu`, `Expand`, `Collapse`, `Increment`, `Decrement`, `Focus`, `Cancel`, `Hover`, and `ScrollIntoView`.

### Other APIs

Playwright locators are more verbose than element indices, so use them when they save observations: long or repetitive tasks where indices do not stay stable, or pages you are building, where you know the structure. `playwright.evaluate` runs a function in the page and returns its JSON result; use it to read, not to change the page. Coordinates (`tab.cua` or `click([x, y])`) are pixels of the latest screenshot's viewport; use them when an element cannot be reached otherwise.

A locator action fails with a strict-mode error when it matches several elements; narrow it with `first()`, `nth()`, `filter()`, or a more specific locator. Frame locators reach frames that run in the page's process; content in other processes is reachable through screenshots and coordinates only.

To upload a file, wait for the chooser before clicking the control that opens it, then set paths inside the task's working directory:

```javascript
const chooser = tab.playwright.waitForEvent("filechooser");
await tab.playwright.getByRole("button", { name: "Upload" }).click();
await (await chooser).setFiles(["report.pdf"]);
```

When a page shows a JavaScript dialog, other calls fail until you answer it with `tab.getJsDialog()`.

### Reference documents

Read one when its situation comes up, with `nodeRepl.write(await agent.documentation.get(name))`:

- `browser-troubleshooting`: a browser or tab call fails in a way you do not understand.
- `chrome-troubleshooting`: the user's browser is missing, disconnects, or refuses an action.
- `file-uploads`: before uploading a file through a page.
- `local-web-development`: building or testing an app on a local server.
- `screenshots`: the user asks for screenshots, or you test their site.

A browser capability's guide appears the first time you call `capabilities.get()` for it.
