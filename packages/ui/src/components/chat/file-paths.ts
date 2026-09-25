/**
 * File panel paths are workspace-relative and path-first: directories end with `/`, files do not.
 * Parent directories may be implicit.
 */
export type ChatFileTreeMutation =
  | { readonly type: "add"; readonly path: string }
  | { readonly type: "remove"; readonly path: string }
  | { readonly type: "move"; readonly from: string; readonly to: string }

export const isChatDirectoryPath = (path: string): boolean => path.endsWith("/")

export const chatFileBaseName = (path: string): string =>
  path.replace(/\/$/, "").split("/").at(-1) ?? path

export const chatFileParentPath = (path: string): string => {
  const trimmed = path.replace(/\/$/, "")
  const index = trimmed.lastIndexOf("/")
  return index < 0 ? "" : trimmed.slice(0, index + 1)
}

/** Returns where `path` lives after `from` moves to `to`, or `path` when the move does not affect it. */
export function moveChatFilePath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (isChatDirectoryPath(from) && path.startsWith(from)) return `${to}${path.slice(from.length)}`
  return path
}

export const isChatFilePathRemoved = (path: string, removed: string): boolean =>
  path === removed || (isChatDirectoryPath(removed) && path.startsWith(removed))

export function applyChatFileTreeMutation(
  paths: readonly string[],
  mutation: ChatFileTreeMutation
): string[] {
  switch (mutation.type) {
    case "add":
      return paths.includes(mutation.path) ? [...paths] : [...paths, mutation.path]
    case "remove":
      return paths.filter((path) => !isChatFilePathRemoved(path, mutation.path))
    case "move":
      return paths.map((path) => moveChatFilePath(path, mutation.from, mutation.to))
  }
}

/** Picks a name that does not collide with an existing entry in `directory`. */
export function uniqueChatFilePath(
  paths: readonly string[],
  directory: string,
  name: string,
  kind: "directory" | "file"
): string {
  const suffix = kind === "directory" ? "/" : ""
  const existing = new Set(paths.map((path) => path.replace(/\/$/, "")))
  const dot = kind === "file" ? name.lastIndexOf(".") : -1
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ""
  for (let index = 1; ; index += 1) {
    const candidate = `${directory}${index === 1 ? name : `${stem}-${index}${extension}`}`
    if (!existing.has(candidate)) return `${candidate}${suffix}`
  }
}
