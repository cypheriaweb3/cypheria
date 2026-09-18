import { describe, expect, it } from "vitest"

import { TerminalOpenRequestSchema, TerminalOutputNotificationSchema } from "./terminal.ts"

describe("terminal protocol", () => {
  it("applies conservative terminal dimensions", () => {
    expect(
      TerminalOpenRequestSchema.parse({
        payload: { projectId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e9" },
        requestId: "terminal-open",
        type: "terminal.open.request",
      }).payload
    ).toEqual({
      cols: 100,
      projectId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e9",
      rows: 28,
    })
  })

  it("rejects ambiguous working directories", () => {
    expect(() =>
      TerminalOpenRequestSchema.parse({
        payload: {
          cwd: "/workspace",
          projectId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e9",
        },
        requestId: "terminal-open",
        type: "terminal.open.request",
      })
    ).toThrow()
  })

  it("validates output notifications", () => {
    expect(
      TerminalOutputNotificationSchema.parse({
        payload: {
          data: "ready\r\n",
          terminalId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e9",
        },
        type: "terminal.output.notification",
      }).payload.data
    ).toBe("ready\r\n")
  })
})
