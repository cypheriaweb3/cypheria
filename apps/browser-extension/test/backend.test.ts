import { describe, expect, it } from "vitest"

import { detectFamily, ExtensionBackend } from "../src/backend.ts"
import { FakeChrome } from "./fake-chrome.ts"

const setup = () => {
  const chrome = new FakeChrome()
  const notifications: { method: string; params: unknown }[] = []
  const backend = new ExtensionBackend({
    chrome: chrome.api,
    family: "chrome",
    notify: (method, params) => notifications.push({ method, params }),
  })
  return { backend, chrome, notifications }
}

describe("ExtensionBackend", () => {
  it("reports a stable instance ID per profile", async () => {
    const { backend } = setup()
    const first = await backend.handle("getInfo", {})
    expect(first).toMatchObject({ extensionVersion: "1.2.3", family: "chrome" })
    expect(await backend.handle("getInfo", {})).toEqual(first)
  })

  it("lists the person's tabs without browser pages or incognito tabs", async () => {
    const { backend, chrome } = setup()
    chrome.addTab({ lastAccessed: 5, title: "Docs", url: "https://example.com/" })
    chrome.addTab({ url: "chrome://settings/" })
    chrome.addTab({ incognito: true, url: "https://secret.example/" })
    chrome.groups.push({ id: 3, title: "Work", windowId: 1 })
    chrome.addTab({ groupId: 3, title: "Mail", url: "https://mail.example/" })
    const tabs = (await backend.handle("listTabs", {})) as { url: string; groupTitle?: string }[]
    expect(tabs.map((tab) => tab.url)).toEqual(["https://example.com/", "https://mail.example/"])
    expect(tabs[0]).toMatchObject({ lastAccessed: 5, title: "Docs" })
    expect(tabs[1]?.groupTitle).toBe("Work")
  })

  it("opens agent tabs in the background in one named group per key", async () => {
    const { backend, chrome } = setup()
    const first = (await backend.handle("openTab", { group: "thread-1", title: "Research" })) as {
      id: number
    }
    const second = (await backend.handle("openTab", { group: "thread-1" })) as { id: number }
    const other = (await backend.handle("openTab", { group: "thread-2" })) as { id: number }
    const tab = (id: number) => chrome.tabs.find((candidate) => candidate.id === id)
    expect(tab(first.id)?.active).toBe(false)
    expect(tab(first.id)?.groupId).toBe(tab(second.id)?.groupId)
    expect(tab(other.id)?.groupId).not.toBe(tab(first.id)?.groupId)
    expect(chrome.groups.map((group) => group.title)).toEqual(["Research", "Cypheria"])
    await backend.handle("nameGroup", { group: "thread-2", title: "Shopping" })
    expect(chrome.groups[1]?.title).toBe("Shopping")
  })

  it("opens a window when the person has none", async () => {
    const { backend, chrome } = setup()
    chrome.windows = []
    const { id } = (await backend.handle("openTab", { group: "thread-1" })) as { id: number }
    expect(chrome.windows).toHaveLength(1)
    expect(chrome.tabs.find((tab) => tab.id === id)?.windowId).toBe(chrome.windows[0]?.id)
  })

  it("forwards CDP for attached tabs, attaching on first use", async () => {
    const { backend, chrome, notifications } = setup()
    const tab = chrome.addTab({ url: "https://example.com/" })
    const id = tab.id ?? -1
    expect(await backend.handle("cdp", { method: "Page.enable", tabId: id })).toEqual({
      echoed: "Page.enable",
    })
    expect(chrome.attached.has(id)).toBe(true)
    chrome.onEvent.emit({ tabId: id }, "Page.loadEventFired", { timestamp: 1 })
    chrome.onEvent.emit({ sessionId: "child", tabId: id }, "Page.loadEventFired", {})
    chrome.onEvent.emit({ tabId: 999 }, "Page.loadEventFired", {})
    chrome.onDetach.emit({ tabId: id }, "canceled_by_user")
    expect(notifications).toEqual([
      {
        method: "cdpEvent",
        params: { method: "Page.loadEventFired", params: { timestamp: 1 }, tabId: id },
      },
      { method: "cdpDetached", params: { reason: "canceled_by_user", tabId: id } },
    ])
  })

  it("refuses browser pages and validates parameters", async () => {
    const { backend, chrome } = setup()
    const settings = chrome.addTab({ url: "chrome://settings/" })
    await expect(backend.handle("attach", { tabId: settings.id })).rejects.toThrow(/browser page/)
    await expect(backend.handle("cdp", { tabId: "1" })).rejects.toMatchObject({ code: "invalid" })
    await expect(backend.handle("history", {})).rejects.toMatchObject({ code: "invalid" })
  })

  it("reports finished downloads with their file", async () => {
    const { chrome, notifications } = setup()
    chrome.downloads.push({
      filename: "/tmp/a.pdf",
      id: 7,
      state: "complete",
      url: "https://x/a.pdf",
    })
    chrome.onDownloadCreated.emit({
      filename: "",
      id: 7,
      state: "in_progress",
      url: "https://x/a.pdf",
    })
    chrome.onDownloadChanged.emit({ id: 7, state: { current: "complete" } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(notifications).toEqual([
      {
        method: "downloadChanged",
        params: { id: 7, state: "in_progress", url: "https://x/a.pdf" },
      },
      {
        method: "downloadChanged",
        params: { filename: "/tmp/a.pdf", id: 7, state: "complete", url: "https://x/a.pdf" },
      },
    ])
  })
})

describe("detectFamily", () => {
  it("tells Chromium browsers apart", () => {
    const chrome = { brands: [{ brand: "Google Chrome" }, { brand: "Chromium" }] }
    expect(detectFamily({ userAgent: "Chrome/130", userAgentData: chrome })).toBe("chrome")
    expect(detectFamily({ brave: {}, userAgent: "Chrome/130" })).toBe("brave")
    expect(detectFamily({ userAgent: "Chrome/130 Edg/130", userAgentData: { brands: [] } })).toBe(
      "edge"
    )
    expect(detectFamily({ userAgent: "Chrome/130 OPR/115" })).toBe("opera")
    expect(
      detectFamily({ userAgent: "Chrome/130", userAgentData: { brands: [{ brand: "Chromium" }] } })
    ).toBe("chromium")
  })
})
