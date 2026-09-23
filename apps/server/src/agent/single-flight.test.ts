import { describe, expect, it, vi } from "vitest"
import { getOrInitialize } from "./single-flight.js"

describe("getOrInitialize", () => {
  it("shares one pending initialization and keeps its result", async () => {
    const runtimes = new Map<string, Promise<object>>()
    let finish!: (value: object) => void
    const initialize = vi.fn(() => new Promise<object>((resolve) => (finish = resolve)))
    const first = getOrInitialize(runtimes, "session", initialize)
    const second = getOrInitialize(runtimes, "session", initialize)
    expect(first).toBe(second)
    expect(initialize).toHaveBeenCalledTimes(1)
    const runtime = {}
    finish(runtime)
    expect(await first).toBe(runtime)
    expect(await getOrInitialize(runtimes, "session", initialize)).toBe(runtime)
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it("evicts a failed initialization so the next call can retry", async () => {
    const runtimes = new Map<string, Promise<object>>()
    const failure = Promise.reject(new Error("startup failed"))
    await expect(getOrInitialize(runtimes, "session", () => failure)).rejects.toThrow(
      "startup failed"
    )
    await Promise.resolve()
    const runtime = {}
    expect(await getOrInitialize(runtimes, "session", async () => runtime)).toBe(runtime)
  })
})
