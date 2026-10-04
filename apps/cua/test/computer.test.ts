import { describe, expect, it } from "vitest"

import { ComputerBackend } from "../src/host/computer/backend.ts"
import type { ToolResult } from "../src/host/computer/cua-driver.ts"

const result = (structuredContent: Record<string, unknown>, text = ""): ToolResult => ({
  content: text ? [{ text, type: "text" }] : [],
  structuredContent,
})

const fakeDriver = () => {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    calls.push({ args, name })
    switch (name) {
      case "list_apps":
        return result({
          apps: [
            { bundle_id: "com.apple.iCal", name: "Calendar", pid: 42, running: true },
            { bundle_id: "com.apple.Notes", name: "Notes", running: false },
          ],
        })
      case "list_windows":
        return result({
          windows: [
            { app_name: "Calendar", layer: 0, pid: 42, title: "Week", window_id: 7, z_index: 3 },
            {
              app_name: "Calendar",
              layer: 0,
              pid: 42,
              title: "Inspector",
              window_id: 8,
              z_index: 1,
            },
          ],
        })
      case "get_window_state":
        return result({
          elements: [{ element_index: 3, element_token: "tok-3" }],
          tree_markdown: '[3] button "Today"',
        })
      case "click":
        return result({
          effect: "suspected_noop",
          escalation: { reason: "no change", recommended: "px" },
        })
      default:
        return result({ effect: "confirmed" })
    }
  }
  return { backend: new ComputerBackend(call, "darwin"), calls }
}

describe("native apps", () => {
  it("binds an app's frontmost window and names the others", async () => {
    const { backend } = fakeDriver()
    const { binding, observation } = await backend.getApp("thread", "calendar")
    expect(binding).toEqual({ bundleId: "com.apple.iCal", name: "Calendar", pid: 42, windowId: 7 })
    expect(observation.text).toContain('[3] button "Today"')
    expect(observation.text).toContain('8 "Inspector"')
  })

  it("maps element indices to the latest snapshot's tokens", async () => {
    const { backend, calls } = fakeDriver()
    const { binding } = await backend.getApp("thread", "Calendar")
    const outcome = await backend.act("thread", binding, { target: 3, type: "click" })
    expect(calls.at(-1)).toMatchObject({
      args: { element_token: "tok-3", pid: 42, window_id: 7 },
      name: "click",
    })
    expect(outcome.notice).toContain("coordinates")
    await expect(backend.act("thread", binding, { target: 9, type: "click" })).rejects.toThrow(
      /not in the latest state/
    )
    await expect(backend.act("other", binding, { target: 3, type: "click" })).rejects.toThrow(
      /not in the latest state/
    )
  })

  it("sends chords as hotkeys and single keys as presses", async () => {
    const { backend, calls } = fakeDriver()
    const handle = { pid: 42, windowId: 7 }
    await backend.act("thread", handle, { key: "cmd+shift+N", type: "press" })
    expect(calls.at(-1)).toMatchObject({ args: { keys: ["cmd", "shift", "n"] }, name: "hotkey" })
    await backend.act("thread", handle, { key: "Return", type: "press" })
    expect(calls.at(-1)).toMatchObject({ args: { key: "return" }, name: "press_key" })
  })

  it("launches an installed app that is not running", async () => {
    const { backend, calls } = fakeDriver()
    await backend.getApp("thread", "Notes").catch(() => undefined)
    expect(calls.find((call) => call.name === "launch_app")?.args).toMatchObject({
      bundle_id: "com.apple.Notes",
    })
  })
})
