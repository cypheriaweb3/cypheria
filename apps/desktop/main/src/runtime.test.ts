import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { initializeDesktopRuntime, shutdownDesktopRuntime } from "./runtime.js"

describe("desktop runtime bootstrap", () => {
  it("starts and stops the Cypheria runtime host", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cypheria-desktop-runtime-test-"))

    try {
      const context = await initializeDesktopRuntime({ homeDir, startCodexAppServer: false })

      expect(context.runtime.lifecycleState).toBe("ready")
      expect(context.paths).toBe(context.runtime.paths)
      expect(context.codexEnv.CODEX_HOME).toBe(context.paths.codexHome)

      await expect(context.runtime.request("runtime.info")).resolves.toMatchObject({
        cypheriaHome: context.paths.cypheriaHome,
        lifecycleState: "ready",
      })

      await shutdownDesktopRuntime(context)
      expect(context.runtime.lifecycleState).toBe("stopped")
    } finally {
      await rm(homeDir, { force: true, recursive: true })
    }
  })
})
