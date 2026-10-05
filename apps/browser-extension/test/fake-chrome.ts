import type {
  ChromeApi,
  ChromeTab,
  ChromeTabGroup,
  ChromeWindow,
  DebuggerTarget,
  DownloadDelta,
  DownloadItem,
} from "../src/chrome-api.ts"

class FakeEvent<Listener extends (...args: never[]) => void> {
  readonly listeners: Listener[] = []
  addListener(listener: Listener): void {
    this.listeners.push(listener)
  }
  emit(...args: Parameters<Listener>): void {
    for (const listener of this.listeners) listener(...args)
  }
}

/** An in-memory browser with windows, tabs, tab groups, a debugger, and downloads. */
export class FakeChrome {
  windows: ChromeWindow[] = [{ focused: true, id: 1, incognito: false, type: "normal" }]
  tabs: ChromeTab[] = []
  groups: ChromeTabGroup[] = []
  attached = new Set<number>()
  commands: { tabId?: number; method: string; params?: object }[] = []
  downloads: DownloadItem[] = []
  local: Record<string, unknown> = {}
  session: Record<string, unknown> = {}
  readonly onEvent = new FakeEvent<
    (source: DebuggerTarget, method: string, params?: object) => void
  >()
  readonly onDetach = new FakeEvent<(source: DebuggerTarget, reason: string) => void>()
  readonly onDownloadCreated = new FakeEvent<(item: DownloadItem) => void>()
  readonly onDownloadChanged = new FakeEvent<(delta: DownloadDelta) => void>()
  #nextTab = 100
  #nextGroup = 10

  addTab(tab: Partial<ChromeTab> & { url: string }): ChromeTab {
    const created: ChromeTab = {
      active: false,
      groupId: -1,
      id: this.#nextTab++,
      incognito: false,
      title: "",
      windowId: 1,
      ...tab,
    }
    this.tabs.push(created)
    return created
  }

  get api(): ChromeApi {
    const storage = (area: Record<string, unknown>) => ({
      get: async (key: string) => (key in area ? { [key]: area[key] } : {}),
      set: async (items: Record<string, unknown>) => {
        Object.assign(area, items)
      },
    })
    const tab = (tabId: number) => {
      const found = this.tabs.find((candidate) => candidate.id === tabId)
      if (!found) throw new Error(`No tab with id: ${tabId}.`)
      return found
    }
    return {
      debugger: {
        attach: async (target) => {
          tab(target.tabId ?? -1)
          this.attached.add(target.tabId ?? -1)
        },
        detach: async (target) => {
          this.attached.delete(target.tabId ?? -1)
        },
        onDetach: this.onDetach,
        onEvent: this.onEvent,
        sendCommand: async (target, method, params) => {
          if (!this.attached.has(target.tabId ?? -1)) throw new Error("Debugger is not attached")
          this.commands.push({
            method,
            ...(target.tabId ? { tabId: target.tabId } : {}),
            ...(params ? { params } : {}),
          })
          return { echoed: method }
        },
      },
      downloads: {
        onChanged: this.onDownloadChanged,
        onCreated: this.onDownloadCreated,
        search: async ({ id }) => this.downloads.filter((item) => item.id === id),
      },
      runtime: { getManifest: () => ({ version: "1.2.3" }), id: "test-extension" },
      storage: { local: storage(this.local), session: storage(this.session) },
      tabGroups: {
        get: async (groupId) => {
          const group = this.groups.find((candidate) => candidate.id === groupId)
          if (!group) throw new Error(`No group with id: ${groupId}.`)
          return group
        },
        update: async (groupId, properties) => {
          const group = this.groups.find((candidate) => candidate.id === groupId)
          if (group && properties.title !== undefined) group.title = properties.title
          return group
        },
      },
      tabs: {
        create: async ({ active, url, windowId }) =>
          this.addTab({ active, url, windowId: windowId ?? 1 }),
        get: async (tabId) => tab(tabId),
        group: async ({ createProperties, groupId, tabIds }) => {
          let id = groupId
          if (id === undefined) {
            id = this.#nextGroup++
            this.groups.push({ id, windowId: createProperties?.windowId ?? 1 })
          }
          for (const tabId of tabIds) tab(tabId).groupId = id
          return id
        },
        query: async () =>
          this.tabs.filter((candidate) => {
            const window = this.windows.find((w) => w.id === candidate.windowId)
            return (window?.type ?? "normal") === "normal"
          }),
        remove: async (tabId) => {
          tab(tabId)
          this.tabs = this.tabs.filter((candidate) => candidate.id !== tabId)
        },
      },
      windows: {
        create: async ({ url }) => {
          const id = Math.max(0, ...this.windows.map((w) => w.id ?? 0)) + 1
          const window: ChromeWindow = { focused: false, id, incognito: false, type: "normal" }
          this.windows.push(window)
          return { ...window, tabs: [this.addTab({ url, windowId: id })] }
        },
        getAll: async () => this.windows,
        getLastFocused: async () => {
          const focused = this.windows.find((window) => window.focused)
          if (!focused) throw new Error("No last-focused window")
          return focused
        },
      },
    }
  }
}
