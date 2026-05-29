import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CodexNormalizedEvent } from "@cypheria/codex-bridge"
import { CypheriaRuntime } from "@cypheria/runtime"
import { describe, expect, it } from "vitest"

import { createCodexProcessSupervisor } from "./codex.js"
import type { DesktopRuntimeContext } from "./runtime.js"

const createRuntimeContext = (): DesktopRuntimeContext => {
  const cypheriaHome = join(tmpdir(), "cypheria-codex-supervisor-test")

  return {
    codexEnv: {
      ...process.env,
      CODEX_HOME: join(cypheriaHome, "codex"),
    },
    paths: {
      automationDir: join(cypheriaHome, "automation"),
      browserDir: join(cypheriaHome, "browser"),
      cacheDir: join(cypheriaHome, "cache"),
      codexHome: join(cypheriaHome, "codex"),
      configDir: join(cypheriaHome, "config"),
      cypheriaHome,
      dbDir: join(cypheriaHome, "db"),
      logsDir: join(cypheriaHome, "logs"),
      vaultDir: join(cypheriaHome, "vault"),
    },
    runtime: new CypheriaRuntime({ ensureDirectories: false, homeDir: cypheriaHome }),
  }
}

const waitForEvent = async (
  events: readonly CodexNormalizedEvent[],
  predicate: (event: CodexNormalizedEvent) => boolean
): Promise<CodexNormalizedEvent> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const event = events.find(predicate)
    if (event) {
      return event
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error("Timed out waiting for Codex supervisor event")
}

describe("Codex process supervisor", () => {
  it("starts a stdio child process, writes JSONL, reads events, and stops", async () => {
    const events: CodexNormalizedEvent[] = []
    const supervisor = createCodexProcessSupervisor({
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      command: process.execPath,
      context: createRuntimeContext(),
      onEvent: (event) => events.push(event),
    })

    await supervisor.start()
    expect(supervisor.getState()).toBe("ready")

    supervisor.sendNotification("client.ready", { ok: true })
    const messageEvent = await waitForEvent(
      events,
      (event) => event.type === "codex.message" && event.messageKind === "notification"
    )

    expect(messageEvent).toMatchObject({
      message: {
        jsonrpc: "2.0",
        method: "client.ready",
        params: { ok: true },
      },
      type: "codex.message",
    })

    const exitState = await supervisor.stop()
    expect(exitState?.signal).toBe("SIGTERM")
    expect(supervisor.shouldRestart(exitState as NonNullable<typeof exitState>)).toBe(false)
  })
})
