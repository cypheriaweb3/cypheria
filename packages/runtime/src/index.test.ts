import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import {
  buildCodexEnvironment,
  CypheriaRuntime,
  CypheriaRuntimeError,
  type CypheriaRuntimeEvent,
  ensureRuntimeDirectories,
} from "./index.js"

const tempDirs: string[] = []

const makeTempHome = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "cypheria-runtime-test-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

const nextEvent = async (events: AsyncIterator<CypheriaRuntimeEvent>) => {
  const event = await events.next()
  expect(event.done).toBe(false)
  return event.value
}

describe("runtime paths", () => {
  it("builds a Codex environment scoped to the Cypheria home", async () => {
    const homeDir = await makeTempHome()
    const runtime = new CypheriaRuntime({ ensureDirectories: false, homeDir })

    expect(buildCodexEnvironment(runtime.paths, { PATH: "/bin" })).toMatchObject({
      CODEX_HOME: runtime.paths.codexHome,
      PATH: "/bin",
    })
  })

  it("creates all runtime directories", async () => {
    const homeDir = await makeTempHome()
    const runtime = new CypheriaRuntime({ ensureDirectories: false, homeDir })

    await expect(ensureRuntimeDirectories(runtime.paths)).resolves.toBeUndefined()
  })
})

describe("CypheriaRuntime", () => {
  it("starts, reports runtime info, and stops cleanly", async () => {
    const homeDir = await makeTempHome()
    const runtime = new CypheriaRuntime({ homeDir })

    await runtime.start()

    expect(runtime.lifecycleState).toBe("ready")
    await expect(runtime.request("runtime.info")).resolves.toMatchObject({
      codexHome: runtime.paths.codexHome,
      cypheriaHome: runtime.paths.cypheriaHome,
      lifecycleState: "ready",
    })

    await expect(runtime.request("runtime.health")).resolves.toMatchObject({
      status: "ok",
    })

    await runtime.stop()
    expect(runtime.lifecycleState).toBe("stopped")
  })

  it("supports registered runtime request handlers", async () => {
    const homeDir = await makeTempHome()
    const runtime = new CypheriaRuntime({
      ensureDirectories: false,
      homeDir,
      requestHandlers: [
        {
          handler: (params: unknown) => ({ echoed: params }),
          method: "wallet.echo",
        },
      ],
    })

    await runtime.start()

    await expect(runtime.request("wallet.echo", { id: "wallet_1" })).resolves.toEqual({
      echoed: { id: "wallet_1" },
    })
  })

  it("emits lifecycle and request events", async () => {
    const homeDir = await makeTempHome()
    const runtime = new CypheriaRuntime({ homeDir })
    const events = runtime.events()[Symbol.asyncIterator]()
    const firstEvent = events.next()

    await runtime.start()
    await runtime.request("runtime.info")
    await runtime.stop()

    await expect(firstEvent).resolves.toMatchObject({
      done: false,
      value: {
        state: "starting",
        type: "runtime.lifecycle",
      },
    })
    await expect(nextEvent(events)).resolves.toMatchObject({
      state: "ready",
      type: "runtime.lifecycle",
    })
    await expect(nextEvent(events)).resolves.toMatchObject({
      method: "runtime.info",
      type: "runtime.request",
    })
    await expect(nextEvent(events)).resolves.toMatchObject({
      state: "stopping",
      type: "runtime.lifecycle",
    })
    await expect(nextEvent(events)).resolves.toMatchObject({
      state: "stopped",
      type: "runtime.lifecycle",
    })

    await expect(events.next()).resolves.toMatchObject({ done: true })
  })

  it("rejects requests before start and unknown methods", async () => {
    const homeDir = await makeTempHome()
    const runtime = new CypheriaRuntime({ ensureDirectories: false, homeDir })

    await expect(runtime.request("runtime.info")).rejects.toMatchObject({
      code: "LIFECYCLE_ERROR",
    })

    await runtime.start()

    await expect(runtime.request("wallet.missing")).rejects.toMatchObject({
      code: "METHOD_NOT_FOUND",
    })
  })

  it("rejects duplicate handler registration", () => {
    const runtime = new CypheriaRuntime({ ensureDirectories: false })

    expect(() => runtime.registerHandler("runtime.info", () => undefined)).toThrow(
      CypheriaRuntimeError
    )
  })
})
