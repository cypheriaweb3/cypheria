import type { ThreadFileRef } from "./thread-files-panel.js"

const prefix = "file:"

/** The right-panel tab id of a workspace file: one tab per root and path. */
export const fileTabId = (file: ThreadFileRef): string =>
  `${prefix}${encodeURIComponent(file.root)}:${encodeURIComponent(file.path)}`

/** The file a tab id names, or null for any other tab. */
export const parseFileTabId = (id: string): ThreadFileRef | null => {
  if (!id.startsWith(prefix)) return null
  const [root, path, extra] = id.slice(prefix.length).split(":")
  if (root === undefined || path === undefined || extra !== undefined) return null
  try {
    const file = { path: decodeURIComponent(path), root: decodeURIComponent(root) }
    return file.root && file.path ? file : null
  } catch {
    return null
  }
}

/** The tab list with `id` opened after `after` when given and present, otherwise at the end. */
export const withOpenedTab = (tabs: readonly string[], id: string, after?: string): string[] => {
  if (tabs.includes(id)) return [...tabs]
  const index = after ? tabs.indexOf(after) : -1
  return index < 0 ? [...tabs, id] : [...tabs.slice(0, index + 1), id, ...tabs.slice(index + 1)]
}
