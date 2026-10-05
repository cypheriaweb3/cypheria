import { afterEach, describe, expect, it, vi } from "vitest"

import { nodeReplFeatureEnv, resolveNodeRuntime } from "./node-runtime.js"

describe("resolveNodeRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("prefers the managed Node.js", () => {
    expect(resolveNodeRuntime("/managed/bin/node")).toEqual({ env: {}, path: "/managed/bin/node" })
  })

  it("falls back to the Server's executable", () => {
    expect(resolveNodeRuntime(undefined)).toEqual({ env: {}, path: process.execPath })
  })

  it("runs Electron as Node.js explicitly when the Server runs on Electron", () => {
    vi.stubGlobal("process", {
      ...process,
      versions: { ...process.versions, electron: "39.0.0" },
    })
    expect(resolveNodeRuntime(undefined)).toEqual({
      env: { ELECTRON_RUN_AS_NODE: "1" },
      path: process.execPath,
    })
  })
})

describe("nodeReplFeatureEnv", () => {
  it("passes audio through only when the Server enables it", () => {
    expect(nodeReplFeatureEnv({ NODE_REPL_ENABLE_AUDIO: "1" })).toEqual({
      NODE_REPL_ENABLE_AUDIO: "1",
    })
    expect(nodeReplFeatureEnv({ NODE_REPL_ENABLE_AUDIO: "0" })).toEqual({})
    expect(nodeReplFeatureEnv({})).toEqual({})
  })
})
