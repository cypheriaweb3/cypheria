import { CUA_SURFACES, type CuaSurface } from "@cypheria/cua"
import { CuaHost } from "@cypheria/cua/host"
import type { AuditLogService } from "@cypheria/db"
import type { ComputerUseSettings } from "@cypheria/protocol"

import type { BrowserToolsService } from "../browser-tools/service.js"
import type { ExtensionOpenApp } from "../extensions/service.js"
import type { ComputerHostService } from "./computer-hosts.js"
import { BrokeredComputerHosts } from "./desktop-surfaces.js"

const SETTING_OF: Record<CuaSurface, keyof ComputerUseSettings> = {
  browsers: "externalBrowsers",
  computer: "desktopApps",
  iab: "inAppBrowser",
  mcpapps: "mcpApps",
}

/**
 * The surfaces the settings allow. Whether a window or device can serve one is for it to say
 * when it registers; the settings are the person's policy across every device.
 */
export const enabledCuaSurfaces = (settings: ComputerUseSettings): ReadonlySet<CuaSurface> =>
  new Set(CUA_SURFACES.filter((surface) => settings[SETTING_OF[surface]]))

export type CuaHostFactoryOptions = {
  readonly settings: () => ComputerUseSettings
  readonly browserTools: BrowserToolsService
  readonly computerHosts: ComputerHostService
  /** The MCP App instances clients have open; read on each request. */
  readonly openApps: () => readonly ExtensionOpenApp[]
  /** The client that sent a Thread's current turn. */
  readonly initiator: (threadId: string) => string | undefined
  readonly audit?: Pick<AuditLogService, "append">
}

/**
 * Composes the `cua` host. The Server keeps policy, Thread scope, routing, and audit; tabs and
 * MCP Apps run in Desktop windows and external browsers and apps on the Desktop's device.
 */
export const createCuaHost = (
  options: CuaHostFactoryOptions
): { host: CuaHost; surfaces: () => ReadonlySet<CuaSurface> } => {
  const surfaces = () => enabledCuaSurfaces(options.settings())
  const hosts = new BrokeredComputerHosts({
    browser: options.browserTools,
    devices: options.computerHosts,
    openApps: options.openApps,
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
    desktop: hosts,
    hosts,
    initiator: options.initiator,
    surfaces,
  })
  return { host, surfaces }
}
