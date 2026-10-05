import type { BrowserHostCall } from "@cypheria/cua"
import type {
  BrowserAutomationRequest,
  BrowserServerMessage,
  ComputerHostServerMessage,
} from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { BrowserToolsService } from "../browser-tools/service.js"
import type { ExtensionOpenApp } from "../extensions/service.js"
import { ComputerHostService } from "./computer-hosts.js"
import { BrokeredComputerHosts } from "./desktop-surfaces.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const otherThread = "01984de2-8f74-7c91-a3b2-5c5e937cf319"

type ShownApp = { readonly id: string; readonly threadId: string | null; readonly on: string[] }

const call = (member: string, extra: Partial<BrowserHostCall> = {}): BrowserHostCall =>
  ({
    args: [],
    browser: "iab",
    member,
    op: "browser.call",
    backend: "iab",
    ...extra,
  }) as BrowserHostCall

/**
 * Two Desktops, each with one window registered as a browser host and the device registered as
 * a computer host. Each window keeps its own built-in browser tabs; every request a window or
 * device receives is recorded by client ID.
 */
const setup = (apps: ShownApp[]) => {
  const browser = new BrowserToolsService()
  const devices = new ComputerHostService()
  const received = new Map<string, BrowserAutomationRequest[]>()
  const deviceRequests = new Map<string, unknown[]>()
  for (const clientId of ["laptop", "studio"]) {
    const sent: BrowserAutomationRequest[] = []
    const tabs: string[] = []
    received.set(clientId, sent)
    const answer = (request: BrowserAutomationRequest): unknown => {
      const hostCall = request.request as unknown as BrowserHostCall
      if (request.backend === "mcpapps") {
        if (hostCall.member === "tabs.list") {
          return apps
            .filter((app) => app.on.includes(clientId))
            .map((app) => ({ id: app.id, threadId: app.threadId }))
        }
        return { from: clientId }
      }
      switch (hostCall.member) {
        case "tabs.list":
          return tabs.map((id) => ({ id, title: id, url: `https://${id}` }))
        case "tabs.new": {
          const id = `${clientId}-tab-${tabs.length + 1}`
          tabs.push(id)
          return { id, title: "", url: "about:blank" }
        }
        case "tab.close":
          tabs.splice(tabs.indexOf(String(hostCall.tab)), 1)
          return null
        default:
          return { from: clientId }
      }
    }
    const window = {
      clientId,
      id: `ses_${clientId}`,
      kind: "desktop" as const,
      notify: (message: BrowserServerMessage) => {
        if (message.type !== "browser.automation.command.notification") return
        const request = message.payload
        sent.push(request)
        queueMicrotask(() => {
          void browser.handle(
            {
              payload: { automationId: request.automationId, ok: true, value: answer(request) },
              requestId: "r",
              type: "browser.automation.result.request",
            },
            window,
            () => undefined
          )
        })
      },
      transport: {},
    }
    void browser.handle(
      {
        payload: { backends: ["iab", "mcpapps"], name: clientId },
        requestId: "host",
        type: "browser.host.register.request",
      },
      window,
      () => undefined
    )
    const requests: unknown[] = []
    deviceRequests.set(clientId, requests)
    const device = {
      ...window,
      notify: (message: ComputerHostServerMessage) => {
        if (message.type !== "computer.host.command.notification") return
        requests.push(message.payload)
        queueMicrotask(() => {
          void devices.handle(
            {
              payload: {
                commandId: message.payload.commandId,
                ok: true,
                value: { from: clientId },
              },
              requestId: "r",
              type: "computer.host.result.request",
            },
            device,
            () => undefined
          )
        })
      },
    }
    void devices.handle(
      {
        payload: { capabilities: ["chrome", "computer"], name: clientId },
        requestId: "device",
        type: "computer.host.register.request",
      },
      device,
      () => undefined
    )
  }
  const openApps: ExtensionOpenApp[] = apps.map((app) => ({
    displayMode: "inline",
    id: app.id,
    pluginId: null,
    server: "demo",
    threadId: app.threadId,
    title: app.id,
  }))
  const hosts = new BrokeredComputerHosts({ browser, devices, openApps: () => openApps })
  const members = (clientId: string) =>
    (received.get(clientId) ?? []).map(
      (request) => (request.request as unknown as BrowserHostCall).member
    )
  return { deviceRequests, hosts, members }
}

describe("brokered Computer Use hosts", () => {
  it("lists one host per device with its windows' and device's capabilities", async () => {
    const { deviceRequests, hosts } = setup([])
    expect(hosts.list()).toEqual([
      { capabilities: ["iab", "mcpapps", "chrome", "computer"], id: "laptop", name: "laptop" },
      { capabilities: ["iab", "mcpapps", "chrome", "computer"], id: "studio", name: "studio" },
    ])
    await expect(hosts.device("studio", { threadId }, { op: "apps.list" })).resolves.toEqual({
      from: "studio",
    })
    expect(deviceRequests.get("studio")?.[0]).toMatchObject({
      request: { op: "apps.list" },
      threadId,
    })
    expect(deviceRequests.get("laptop")).toHaveLength(0)
  })

  it("opens built-in browser tabs on the turn's device and routes later calls to their window", async () => {
    const { hosts, members } = setup([])
    const tab = (await hosts.call({ threadId }, "iab", call("tabs.new"), "studio")) as {
      id: string
      host: string
    }
    expect(tab).toMatchObject({ host: "studio", id: "studio-tab-1" })
    await hosts.call(
      { threadId },
      "iab",
      call("ax.get", { args: ["state"], tab: tab.id }),
      "laptop"
    )
    expect(members("studio")).toEqual(["tabs.new", "ax.get"])
    expect(members("laptop")).toEqual([])
    await expect(hosts.call({ threadId }, "iab", call("tabs.new"), "phone")).rejects.toThrow(
      /Several devices have the built-in browser/u
    )
  })

  it("lists tabs across windows and learns owners it did not know", async () => {
    const { hosts, members } = setup([])
    await hosts.call({ threadId }, "iab", call("tabs.new"), "laptop")
    await hosts.call({ threadId }, "iab", call("tabs.new"), "studio")
    const listed = (await hosts.call({ threadId }, "iab", call("tabs.list"), undefined)) as {
      id: string
      host: string
    }[]
    expect(listed.map((tab) => [tab.id, tab.host])).toEqual([
      ["laptop-tab-1", "laptop"],
      ["studio-tab-1", "studio"],
    ])
    expect(members("laptop")).toContain("tabs.list")
  })

  it("closes unmarked tabs at turn end and keeps marked ones for one more turn", async () => {
    const { hosts, members } = setup([])
    const kept = (await hosts.call({ threadId }, "iab", call("tabs.new"), "laptop")) as {
      id: string
    }
    const dropped = (await hosts.call({ threadId }, "iab", call("tabs.new"), "laptop")) as {
      id: string
    }
    await hosts.call({ threadId }, "iab", call("tab.markDeliverable", { tab: kept.id }), "laptop")
    await hosts.turnEnded({ threadId })
    expect(members("laptop").filter((member) => member === "tab.close")).toHaveLength(1)
    const list = async () =>
      (
        (await hosts.call({ threadId }, "iab", call("tabs.list"), "laptop")) as { id: string }[]
      ).map((tab) => tab.id)
    const remaining = await list()
    expect(remaining).toEqual([kept.id])
    expect(remaining).not.toContain(dropped.id)
    // The mark lasted one turn: a later turn that uses the browser clears it.
    await hosts.call({ threadId }, "iab", call("tabs.list"), "laptop")
    await hosts.turnEnded({ threadId })
    expect(await list()).toEqual([])
  })

  it("lists the Thread's Apps and Apps outside any Thread that a window shows", async () => {
    const { hosts } = setup([
      { id: "mine", on: ["laptop"], threadId },
      { id: "page", on: ["studio"], threadId: null },
      { id: "theirs", on: ["laptop"], threadId: otherThread },
    ])
    const listed = (await hosts.call(
      { threadId },
      "mcpapps",
      call("tabs.list", { browser: "mcpapps", backend: "mcpapps" }),
      undefined
    )) as { id: string }[]
    expect(listed.map((item) => item.id)).toEqual(["mine", "page"])
    await expect(
      hosts.call(
        { threadId },
        "mcpapps",
        call("tab.screenshot", { browser: "mcpapps", tab: "theirs", backend: "mcpapps" }),
        undefined
      )
    ).rejects.toThrow(/not open in any window/u)
  })

  it("acts on the App copy the turn's device shows, else the newest window showing it", async () => {
    const { hosts } = setup([{ id: "shared", on: ["laptop", "studio"], threadId }])
    const act = (preferred: string) =>
      hosts.call(
        { threadId },
        "mcpapps",
        call("playwright.domSnapshot", { browser: "mcpapps", tab: "shared", backend: "mcpapps" }),
        preferred
      )
    await expect(act("laptop")).resolves.toEqual({ from: "laptop" })
    await expect(act("phone")).resolves.toEqual({ from: "studio" })
  })
})
