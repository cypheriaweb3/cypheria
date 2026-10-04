import type {
  BrowserAutomationResult,
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

/**
 * Two Desktops, each with one window registered as a browser host and the device registered as
 * a computer host. Every request a device or window receives is recorded by client ID.
 */
const setup = (apps: ShownApp[]) => {
  const browser = new BrowserToolsService({ enabled: () => true })
  const devices = new ComputerHostService()
  const received = new Map<string, unknown[]>()
  for (const clientId of ["laptop", "studio"]) {
    const sent: unknown[] = []
    received.set(clientId, sent)
    const window = {
      clientId,
      id: `ses_${clientId}`,
      kind: "desktop" as const,
      notify: (message: BrowserServerMessage) => {
        if (message.type !== "browser.automation.command.notification") return
        const request = message.payload
        const result: BrowserAutomationResult =
          request.command.command === "list_mcp_apps"
            ? {
                apps: apps
                  .filter((app) => app.on.includes(clientId))
                  .map((app) => ({ appId: app.id, threadId: app.threadId })),
                command: "list_mcp_apps",
              }
            : { action: "snapshot", appId: "app", command: "mcp_app", snapshot: clientId }
        if (request.command.command !== "list_mcp_apps") sent.push(request)
        queueMicrotask(() => {
          void browser.handle(
            {
              payload: { automationId: request.automationId, ok: true, result },
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
        payload: {
          hostKind: "Cypheria Desktop",
          name: clientId,
          supportedCommands: ["list_mcp_apps", "mcp_app"],
        },
        requestId: "host",
        type: "browser.host.register.request",
      },
      window,
      () => undefined
    )
    const device = {
      ...window,
      notify: (message: ComputerHostServerMessage) => {
        if (message.type !== "computer.host.command.notification") return
        sent.push(message.payload)
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
        payload: { name: clientId, surfaces: ["computer"] },
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
  return { hosts, received }
}

describe("brokered Computer Use hosts", () => {
  it("lists the Thread's Apps and Apps outside any Thread that a window shows", async () => {
    const { hosts } = setup([
      { id: "mine", on: ["laptop"], threadId },
      { id: "page", on: ["studio"], threadId: null },
      { id: "theirs", on: ["laptop"], threadId: otherThread },
    ])
    const listed = await hosts.listMcpApps({ threadId })
    expect(listed.map((item) => [item.id, item.threadId])).toEqual([
      ["mine", threadId],
      ["page", null],
    ])
    await expect(
      hosts.mcpApp({ threadId }, "theirs", { type: "snapshot" }, undefined)
    ).rejects.toThrow(/not open in any window/u)
  })

  it("acts on the copy the turn's device shows, else the newest window showing it", async () => {
    const { hosts, received } = setup([{ id: "shared", on: ["laptop", "studio"], threadId }])
    await expect(
      hosts.mcpApp({ threadId }, "shared", { type: "snapshot" }, "laptop")
    ).resolves.toEqual({ text: "laptop" })
    await expect(
      hosts.mcpApp({ threadId }, "shared", { type: "snapshot" }, "phone")
    ).resolves.toEqual({ text: "studio" })
    expect(received.get("laptop")).toHaveLength(1)
    expect(received.get("studio")).toHaveLength(1)
  })

  it("lists one host per device and sends device requests to the named device", async () => {
    const { hosts, received } = setup([])
    expect(hosts.list()).toEqual([
      { id: "laptop", name: "laptop", surfaces: ["mcpapps", "computer"] },
      { id: "studio", name: "studio", surfaces: ["mcpapps", "computer"] },
    ])
    await expect(hosts.device("studio", { threadId }, { op: "apps.list" })).resolves.toEqual({
      from: "studio",
    })
    expect(received.get("studio")?.[0]).toMatchObject({ request: { op: "apps.list" }, threadId })
    expect(received.get("laptop")).toHaveLength(0)
  })
})
