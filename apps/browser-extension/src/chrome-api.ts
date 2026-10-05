/**
 * The part of the extension API the backend uses, so unit tests can supply a fake browser.
 * Shapes follow `chrome.*`; only the fields Cypheria reads are listed.
 */
export type ChromeTab = {
  id?: number
  windowId: number
  title?: string
  url?: string
  pendingUrl?: string
  active: boolean
  incognito: boolean
  groupId: number
  lastAccessed?: number
}

export type ChromeWindow = {
  id?: number
  type?: string
  incognito: boolean
  focused: boolean
  tabs?: ChromeTab[]
}

export type ChromeTabGroup = { id: number; windowId: number; title?: string }

export type DebuggerTarget = { tabId?: number; targetId?: string; sessionId?: string }

export type DownloadItem = { id: number; url: string; filename: string; state: string }
export type DownloadDelta = {
  id: number
  state?: { current?: string }
  error?: { current?: string }
  filename?: { current?: string }
}

type Event<Listener> = { addListener(listener: Listener): void }

export interface ChromeApi {
  readonly runtime: { readonly id: string; getManifest(): { version: string } }
  readonly tabs: {
    query(query: Record<string, unknown>): Promise<ChromeTab[]>
    get(tabId: number): Promise<ChromeTab>
    create(properties: { active: boolean; url: string; windowId?: number }): Promise<ChromeTab>
    remove(tabId: number): Promise<void>
    group(options: {
      tabIds: number[]
      groupId?: number
      createProperties?: { windowId: number }
    }): Promise<number>
  }
  readonly tabGroups: {
    get(groupId: number): Promise<ChromeTabGroup>
    update(groupId: number, properties: { title?: string; color?: string }): Promise<unknown>
  }
  readonly windows: {
    getLastFocused(options: { windowTypes: string[] }): Promise<ChromeWindow>
    getAll(options: { windowTypes: string[] }): Promise<ChromeWindow[]>
    create(options: { focused: boolean; url: string; type: string }): Promise<ChromeWindow>
  }
  readonly debugger: {
    attach(target: DebuggerTarget, version: string): Promise<void>
    detach(target: DebuggerTarget): Promise<void>
    sendCommand(target: DebuggerTarget, method: string, params?: object): Promise<unknown>
    readonly onEvent: Event<(source: DebuggerTarget, method: string, params?: object) => void>
    readonly onDetach: Event<(source: DebuggerTarget, reason: string) => void>
  }
  readonly downloads: {
    search(query: { id: number }): Promise<DownloadItem[]>
    readonly onCreated: Event<(item: DownloadItem) => void>
    readonly onChanged: Event<(delta: DownloadDelta) => void>
  }
  readonly storage: {
    readonly local: StorageArea
    readonly session: StorageArea
  }
}

export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}
