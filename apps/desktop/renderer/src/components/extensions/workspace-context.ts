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

/** The longest extension of `name` a handler matches, which keys the person's viewer choice. */
export const fileViewerExtension = (
  name: string,
  handlers: readonly { extensions: readonly string[] }[]
): string | null => {
  const lower = name.toLowerCase()
  let longest: string | null = null
  for (const extension of handlers.flatMap((handler) => handler.extensions)) {
    const candidate = extension.toLowerCase()
    if (lower.endsWith(`.${candidate}`) && candidate.length > (longest?.length ?? 0)) {
      longest = candidate
    }
  }
  return longest
}

/**
 * The viewer a file opens in, as ChatGPT chooses it: the viewer the person chose for the
 * extension while it is still installed, else Cypheria's own viewer when it previews the type,
 * else the plugin viewer with the longest matching extension. `builtin` names Cypheria's viewer.
 */
export const pickFileViewer = (input: {
  readonly handlers: readonly { id: string }[]
  readonly preferred: string | undefined
  readonly builtin: string
  readonly builtinPreviews: boolean
}): string => {
  const { builtin, handlers, preferred } = input
  if (preferred === builtin || handlers.some((handler) => handler.id === preferred)) {
    return preferred as string
  }
  if (input.builtinPreviews) return builtin
  return handlers[0]?.id ?? builtin
}
