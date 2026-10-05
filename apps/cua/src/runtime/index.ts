// The `cua` and `agent` globals of `cua_repl`, built to dist/runtime.mjs. The launcher's banner
// imports it once per REPL module cache, so `js_reset` builds a fresh one.
import type { CuaHostInfo, CuaState } from "../protocol.ts"
import { parseSurfaces } from "../surfaces.ts"
import { createAgent } from "./agent.ts"
import { createAppsApi } from "./apps.ts"
import { createBrowserApi } from "./cua.ts"
import { SnapshotHistory } from "./diff.ts"
import { Documentation } from "./docs.ts"
import { call, nodeRepl, writeText } from "./host.ts"

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
}

const disabledMessage = (name: string) => `${name} is disabled in Cypheria's Computer Use settings.`

const unavailable =
  (name: string) =>
  async (..._args: unknown[]): Promise<never> => {
    throw new Error(disabledMessage(name))
  }

const createRuntime = () => {
  const surfaces = new Set(parseSurfaces(nodeRepl().env.CUA_REPL_ENABLED_SURFACES))
  const platform = nodeRepl().env.CUA_REPL_PLATFORM ?? ""
  const docs = new Documentation(
    PLATFORM_NAMES[platform] ?? "this platform",
    typeof nodeRepl().emitAudio === "function"
  )
  const history = new SnapshotHistory()
  const agent = createAgent(history, docs)
  const browser = surfaces.has("browser") ? createBrowserApi(agent.browsers, docs) : null
  const apps = surfaces.has("computer") ? createAppsApi(history, docs, platform) : null
  const getState = async (options: { emit?: boolean } = {}): Promise<CuaState> => {
    const state = await call<CuaState>({ op: "state" })
    if (options.emit !== false) writeText(JSON.stringify(state))
    return state
  }
  const hosts = async (options: { emit?: boolean } = {}): Promise<CuaHostInfo[]> => {
    const list = await call<CuaHostInfo[]>({ op: "hosts" })
    if (options.emit !== false) writeText(JSON.stringify(list))
    return list
  }
  const noBrowser = unavailable("Browser control")
  const noApps = unavailable("Native app control")
  docs.start()
  const cua = {
    computer: apps?.computer ?? { launch_app: noApps, target: "mac" },
    createBrowserTab: browser?.createBrowserTab ?? noBrowser,
    getApp: apps?.getApp ?? noApps,
    getBrowser: browser?.getBrowser ?? noBrowser,
    getState,
    getTab: browser?.getTab ?? noBrowser,
    hosts,
    listApps: apps?.listApps ?? noApps,
    listBrowsers: browser?.listBrowsers ?? noBrowser,
    listTabs: browser?.listTabs ?? noBrowser,
    listWindows: apps?.listWindows ?? noApps,
    rewriteDocumentation: async () => docs.rewrite(),
  }
  return { agent: surfaces.has("browser") ? agent : undefined, cua }
}

const { agent, cua } = createRuntime()
Reflect.set(globalThis, "cua", cua)
if (agent) Reflect.set(globalThis, "agent", agent)
