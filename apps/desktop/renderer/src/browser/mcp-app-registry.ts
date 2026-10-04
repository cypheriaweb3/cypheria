import type { BrowserMcpAppInfo } from "@cypheria/protocol"

/** An MCP App this window currently shows, with the sandbox origin that locates its frames. */
export type MountedMcpApp = BrowserMcpAppInfo & { readonly origin: string }

const mounted = new Map<string, MountedMcpApp>()

/**
 * Records a mounted App so the Server can list and operate it for its Thread through Computer
 * Use. Apps without a Thread, such as global pages, are not registered. Returns the disposer.
 */
export const registerMountedMcpApp = (app: MountedMcpApp): (() => void) => {
  mounted.set(app.appId, app)
  return () => {
    if (mounted.get(app.appId) === app) mounted.delete(app.appId)
  }
}

export const mountedMcpApps = (threadId: string): BrowserMcpAppInfo[] =>
  [...mounted.values()]
    .filter((app) => app.threadId === threadId)
    .map(({ origin: _origin, ...info }) => info)

export const mountedMcpApp = (threadId: string, appId: string): MountedMcpApp | undefined => {
  const app = mounted.get(appId)
  return app?.threadId === threadId ? app : undefined
}
