import { createContext } from "react"

/** The chat an App is shown in, and how it opens files there. */
export type ExtensionWorkspace = {
  readonly threadId: string | null
  /** Opens a file of the chat's workspace, by absolute path, in its file tabs. */
  readonly openFile: (path: string) => void
}

export const ExtensionWorkspaceContext = createContext<ExtensionWorkspace>({
  openFile: () => undefined,
  threadId: null,
})

/** The file entry points that open `name`: those with the longest matching extension first. */
export const fileHandlers = <T extends { extensions: readonly string[] }>(
  name: string,
  handlers: readonly T[]
): T[] => {
  const lower = name.toLowerCase()
  const match = (handler: T) =>
    Math.max(
      0,
      ...handler.extensions
        .filter((extension) => lower.endsWith(`.${extension}`))
        .map((e) => e.length)
    )
  return handlers
    .map((handler) => ({ handler, length: match(handler) }))
    .filter(({ length }) => length > 0)
    .sort((a, b) => b.length - a.length)
    .map(({ handler }) => handler)
}
