import { existsSync } from "node:fs"
import { join } from "node:path"

import { type CuaSurface, cuaDriverEndpoint } from "@cypheria/cua"
import {
  ComputerBackend,
  CuaDriverClient,
  type CuaDriverConnection,
  CuaHost,
  createAgentBrowserRunner,
  ExternalBrowsersBackend,
  resolveAgentBrowserBinary,
  resolveCuaDriverBinary,
} from "@cypheria/cua/host"
import { resolveCuaRoot } from "@cypheria/cua/plugin"
import type { AuditLogService } from "@cypheria/db"
import type { ComputerUseSettings } from "@cypheria/protocol"
import type { Logger } from "pino"

import type { BrowserToolsService } from "../browser-tools/service.js"
import { BrokeredDesktopSurfaces } from "./desktop-surfaces.js"

/** Platforms cua-driver supports for native app control. */
const DESKTOP_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux", "win32"])

/** The surfaces the settings enable on this platform. */
export const enabledCuaSurfaces = (
  settings: ComputerUseSettings,
  platform: NodeJS.Platform = process.platform
): ReadonlySet<CuaSurface> => {
  const surfaces = new Set<CuaSurface>()
  if (settings.inAppBrowser) surfaces.add("iab")
  if (settings.externalBrowsers) surfaces.add("browsers")
  if (settings.mcpApps) surfaces.add("mcpapps")
  if (settings.desktopApps && DESKTOP_PLATFORMS.has(platform)) surfaces.add("computer")
  return surfaces
}

/**
 * How the Server reaches cua-driver: the private daemon Desktop hosts when it is running, so
 * macOS grants belong to Cypheria. Without it, Linux and Windows run `cua-driver mcp` directly,
 * and macOS uses an installed CuaDriver.app, which holds its own grants.
 */
export const cuaDriverConnection = (
  root: string,
  cypheriaHome: string,
  platform: NodeJS.Platform = process.platform
): CuaDriverConnection | null => {
  const binary = resolveCuaDriverBinary(root, process.env, platform)
  if (!binary) return null
  const socketPath = cuaDriverEndpoint(cypheriaHome, platform)
  if (existsSync(socketPath)) return { binary, kind: "embedded", socketPath }
  if (platform !== "darwin") return { binary, kind: "standalone" }
  return existsSync("/Applications/CuaDriver.app") ? { binary, kind: "standalone" } : null
}

export type CuaHostFactoryOptions = {
  readonly settings: () => ComputerUseSettings
  readonly browserTools: BrowserToolsService
  readonly cypheriaHome: string
  readonly cacheDir: string
  readonly audit?: Pick<AuditLogService, "append">
  readonly logger?: Logger
}

/** Composes the `cua` host with its built-in browser, external browser, and native app backends. */
export const createCuaHost = (
  options: CuaHostFactoryOptions
): { host: CuaHost; surfaces: () => ReadonlySet<CuaSurface> } => {
  const surfaces = () => enabledCuaSurfaces(options.settings())
  let root: string | undefined
  const cuaRoot = () => {
    root ??= resolveCuaRoot()
    return root
  }
  const driver = new CuaDriverClient(() => {
    try {
      return cuaDriverConnection(cuaRoot(), options.cypheriaHome)
    } catch (error) {
      options.logger?.warn?.({ error }, "cua-driver is unavailable")
      return null
    }
  })
  const host = new CuaHost({
    audit: (event) => {
      void options.audit
        ?.append({
          actor: `thread:${event.threadId}`,
          eventType: `cua.${event.op}.${event.ok ? "succeeded" : "failed"}`,
          ...(event.target ? { payloadSummary: `target ${event.target}` } : {}),
          source: "cua",
        })
        .catch(() => undefined)
    },
    browsers: new ExternalBrowsersBackend({
      runner: (args, runOptions) =>
        createAgentBrowserRunner(resolveAgentBrowserBinary(cuaRoot()), {
          ...process.env,
          AGENT_BROWSER_NAMESPACE: "cypheria",
        })(args, runOptions),
      scratchDir: join(options.cacheDir, "cua", "screenshots"),
    }),
    computer: new ComputerBackend((name, args) => driver.callTool(name, args)),
    desktop: new BrokeredDesktopSurfaces(options.browserTools),
    surfaces,
  })
  return { host, surfaces }
}
