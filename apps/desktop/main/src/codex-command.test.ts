import { basename, join, sep } from "node:path"
import { describe, expect, it } from "vitest"
import { resolveCodexCommand } from "./codex-command.js"

describe("resolveCodexCommand", () => {
  it("honors an explicit development override", () => {
    expect(resolveCodexCommand({ isPackaged: false, override: "/tmp/codex" })).toBe("/tmp/codex")
  })

  it("uses the bundled sidecar in packaged applications", () => {
    expect(
      resolveCodexCommand({
        isPackaged: true,
        platform: "darwin",
        resourcesPath: "/Applications/Cypheria.app/Contents/Resources",
      })
    ).toBe(join("/Applications/Cypheria.app/Contents/Resources", "codex", "codex"))
  })

  it("resolves the pinned workspace package during development", () => {
    const command = resolveCodexCommand({ isPackaged: false })
    expect(command).toContain("0.151.0-")
    expect(command).toContain(`${sep}vendor${sep}`)
    expect(basename(command)).toBe(process.platform === "win32" ? "codex.exe" : "codex")
  })

  it("rejects unsupported development platforms", () => {
    expect(() =>
      resolveCodexCommand({ arch: "ia32", isPackaged: false, platform: "linux" })
    ).toThrow("Unsupported Codex platform: linux-ia32")
  })
})
