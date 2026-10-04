import { describe, expect, it } from "vitest"

import {
  BrowserAutomationCommandSchema,
  BrowserAutomationOutcomeSchema,
  BrowserHostRegistrationSchema,
  BrowserTabInfoSchema,
} from "./browser.js"
import {
  isClientResponseMessage,
  PersistedServerConfigPatchSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./index.js"

const browserId = "5b8f7b43-86a4-4c65-9f79-3a3a3d35f0c1"
const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

describe("browser automation protocol", () => {
  it("applies command defaults", () => {
    expect(BrowserAutomationCommandSchema.parse({ command: "new_tab" })).toEqual({
      args: { kind: "web" },
      command: "new_tab",
    })
    expect(
      BrowserAutomationCommandSchema.parse({
        args: { browserId, ref: "@e3" },
        command: "click",
      })
    ).toEqual({
      args: { browserId, button: "left", doubleClick: false, modifiers: [], ref: "@e3" },
      command: "click",
    })
  })

  it("rejects fabricated browser ids, bad refs, and non-web URLs", () => {
    expect(
      BrowserAutomationCommandSchema.safeParse({
        args: { browserId: "tab-1" },
        command: "snapshot",
      }).success
    ).toBe(false)
    expect(
      BrowserAutomationCommandSchema.safeParse({
        args: { browserId, ref: "button" },
        command: "click",
      }).success
    ).toBe(false)
    expect(
      BrowserAutomationCommandSchema.safeParse({
        args: { browserId, url: "file:///etc/passwd" },
        command: "navigate",
      }).success
    ).toBe(false)
  })

  it("requires exactly one wait condition", () => {
    const wait = (args: Record<string, unknown>) =>
      BrowserAutomationCommandSchema.safeParse({ args: { browserId, ...args }, command: "wait" })
        .success
    expect(wait({ text: "Ready" })).toBe(true)
    expect(wait({ url: "/done" })).toBe(true)
    expect(wait({})).toBe(false)
    expect(wait({ text: "Ready", url: "/done" })).toBe(false)
  })

  it("describes tab kind and thread scope", () => {
    expect(
      BrowserTabInfoSchema.parse({ browserId, kind: "dapp", threadId, title: "", url: "" })
    ).toMatchObject({ isActive: false, isLoading: false, kind: "dapp" })
  })

  it("deduplicates host capabilities and requires at least one command", () => {
    expect(
      BrowserHostRegistrationSchema.parse({ supportedCommands: ["snapshot", "snapshot"] })
    ).toEqual({ hostKind: "browser host", supportedCommands: ["snapshot"] })
    expect(BrowserHostRegistrationSchema.safeParse({ supportedCommands: [] }).success).toBe(false)
  })

  it("carries host registration, commands, and results in session envelopes", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        payload: { hostKind: "desktop app", supportedCommands: ["snapshot"] },
        requestId: "host-1",
        type: "browser.host.register.request",
      }).success
    ).toBe(true)
    expect(
      SessionInboundMessageSchema.safeParse({
        payload: {
          automationId: "browser-1",
          error: { code: "browser_stale_ref", message: "Take a new snapshot." },
          ok: false,
        },
        requestId: "result-1",
        type: "browser.automation.result.request",
      }).success
    ).toBe(true)
    const notification = SessionOutboundMessageSchema.parse({
      payload: {
        automationId: "browser-1",
        command: { args: { browserId }, command: "snapshot" },
        threadId,
      },
      type: "browser.automation.command.notification",
    })
    expect(isClientResponseMessage(notification)).toBe(false)
    const response = SessionOutboundMessageSchema.parse({
      payload: { ok: true, value: { succeeded: true } },
      requestId: "host-1",
      type: "browser.host.register.response",
    })
    expect(isClientResponseMessage(response)).toBe(true)
  })

  it("validates outcomes against the command result union", () => {
    expect(
      BrowserAutomationOutcomeSchema.safeParse({
        automationId: "browser-1",
        ok: true,
        result: { browserId, command: "back" },
      }).success
    ).toBe(true)
    expect(
      BrowserAutomationOutcomeSchema.safeParse({
        automationId: "browser-1",
        ok: true,
        result: { command: "back" },
      }).success
    ).toBe(false)
  })

  it("accepts computer use settings patches", () => {
    expect(PersistedServerConfigPatchSchema.parse({ computerUse: { inAppBrowser: true } })).toEqual(
      {
        computerUse: { inAppBrowser: true },
      }
    )
  })

  it("validates direct selector, point, and new commands", () => {
    expect(
      BrowserAutomationCommandSchema.parse({
        args: { browserId, selector: "button.submit" },
        command: "click",
      })
    ).toEqual({
      args: {
        browserId,
        button: "left",
        doubleClick: false,
        modifiers: [],
        selector: "button.submit",
      },
      command: "click",
    })

    expect(
      BrowserAutomationCommandSchema.parse({
        args: { browserId, selector: "input#search", value: "test" },
        command: "fill",
      })
    ).toEqual({
      args: { browserId, selector: "input#search", value: "test" },
      command: "fill",
    })

    expect(
      BrowserAutomationCommandSchema.parse({
        args: { browserId },
        command: "mark_deliverable",
      })
    ).toEqual({
      args: { browserId },
      command: "mark_deliverable",
    })

    expect(
      BrowserAutomationCommandSchema.parse({
        args: { browserId, reason: "Solve captcha" },
        command: "request_manual_handoff",
      })
    ).toEqual({
      args: { browserId, reason: "Solve captcha" },
      command: "request_manual_handoff",
    })

    expect(
      BrowserAutomationCommandSchema.parse({
        args: { browserId, selector: "canvas#qr" },
        command: "scan_qr",
      })
    ).toEqual({
      args: { browserId, selector: "canvas#qr" },
      command: "scan_qr",
    })

    expect(
      BrowserAutomationCommandSchema.parse({
        args: { browserId, kinds: ["image", "svg"] },
        command: "extract_assets",
      })
    ).toEqual({
      args: { browserId, kinds: ["image", "svg"] },
      command: "extract_assets",
    })
  })
})
