/**
 * An MCP App this window shows: an App instance the Server opened, with the sandbox origin that
 * locates its frames. `threadId` is null for an App outside any Thread, such as a plugin's page.
 */
export type MountedMcpApp = {
  readonly appId: string
  readonly origin: string
  readonly threadId: string | null
}

/** Mounts by App instance; one instance can show in several places, newest last. */
const mounted = new Map<string, MountedMcpApp[]>()

/**
 * Records a mounted App so the Server can operate it through Computer Use, wherever it is shown.
 * Returns the disposer.
 */
export const registerMountedMcpApp = (app: MountedMcpApp): (() => void) => {
  mounted.set(app.appId, [...(mounted.get(app.appId) ?? []), app])
  return () => {
    const rest = (mounted.get(app.appId) ?? []).filter((item) => item !== app)
    if (rest.length > 0) mounted.set(app.appId, rest)
    else mounted.delete(app.appId)
  }
}

/**
 * The newest mount of an App a Thread may act on: one in that Thread, or one outside any
 * Thread. The Server checks the same rule; this is the window's own guard.
 */
export const mountedMcpApp = (threadId: string, appId: string): MountedMcpApp | undefined => {
  const app = mounted.get(appId)?.at(-1)
  return app && (app.threadId === null || app.threadId === threadId) ? app : undefined
}

/** Every App instance this window shows, once each, with the Thread it belongs to. */
export const mountedMcpApps = (): { appId: string; threadId: string | null }[] =>
  [...mounted].flatMap(([appId, mounts]) => {
    const newest = mounts.at(-1)
    return newest ? [{ appId, threadId: newest.threadId }] : []
  })
