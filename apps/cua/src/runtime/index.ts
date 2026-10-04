// The `cua` global of `cua_repl`, built to dist/runtime.mjs. The launcher's banner imports it once
// per REPL module cache, so `js_reset` builds a fresh one.
import type { CuaState } from "../protocol.ts"
import { parseSurfaces } from "../surfaces.ts"
import { createAppsApi } from "./apps.ts"
import { createBrowsersApi } from "./browsers.ts"
import { SnapshotHistory } from "./diff.ts"
import { Documentation } from "./docs.ts"
import { call, nodeRepl, writeText } from "./host.ts"
import { createIabApi } from "./iab.ts"
import { createMcpAppsApi } from "./mcp-apps.ts"

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
}

const disabledMessage = (name: string) => `${name} is disabled in Cypheria's Computer Use settings.`

/** Stands in for a disabled surface's namespace: any use explains why it is missing. */
const disabled = (name: string) =>
  new Proxy(
    {},
    {
      get() {
        throw new Error(disabledMessage(name))
      },
    }
  )

const unavailable =
  (name: string) =>
  async (..._args: unknown[]): Promise<never> => {
    throw new Error(disabledMessage(name))
  }

const createCua = () => {
  const surfaces = new Set(parseSurfaces(nodeRepl().env.CUA_REPL_ENABLED_SURFACES))
  const platform = nodeRepl().env.CUA_REPL_PLATFORM ?? ""
  const docs = new Documentation(PLATFORM_NAMES[platform] ?? "this platform")
  const history = new SnapshotHistory()
  const apps = surfaces.has("computer") ? createAppsApi(history, docs) : null
  const getState = async (options: { emit?: boolean } = {}): Promise<CuaState> => {
    const state = await call<CuaState>({ op: "state" })
    if (options.emit !== false) writeText(JSON.stringify(state))
    return state
  }
  docs.start()
  return {
    browsers: surfaces.has("browsers")
      ? createBrowsersApi(history, docs)
      : disabled("External browser control"),
    getApp: apps?.getApp ?? unavailable("Native app control"),
    getState,
    iab: surfaces.has("iab") ? createIabApi(history, docs) : disabled("The built-in browser"),
    initialize: getState,
    listApps: apps?.listApps ?? unavailable("Native app control"),
    listWindows: apps?.listWindows ?? unavailable("Native app control"),
    mcpApps: surfaces.has("mcpapps")
      ? createMcpAppsApi(history, docs)
      : disabled("MCP App control"),
    rewriteDocumentation: async () => docs.rewrite(),
    surfaces: [...surfaces],
  }
}

Reflect.set(globalThis, "cua", createCua())
