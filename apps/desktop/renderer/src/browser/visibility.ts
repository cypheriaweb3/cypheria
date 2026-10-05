/**
 * Whether this window shows a Thread's built-in browser, for the `visibility` browser
 * capability. Conversation workspaces report their browser pane and act on requests to show or
 * hide it; Computer Use reads and requests through here.
 */
type Request = { readonly threadId: string; readonly visible: boolean }

const shown = new Set<string>()
const listeners = new Set<(request: Request) => void>()

/** Records whether a workspace currently shows the Thread's browser pane. */
export const reportBrowserPaneShown = (threadId: string, visible: boolean): void => {
  if (visible) shown.add(threadId)
  else shown.delete(threadId)
}

export const isBrowserPaneShown = (threadId: string): boolean => shown.has(threadId)

/** Asks the workspaces showing the Thread to open or hide its browser pane. */
export const requestBrowserPane = (threadId: string, visible: boolean): void => {
  for (const listener of listeners) listener({ threadId, visible })
}

export const onBrowserPaneRequest = (listener: (request: Request) => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
