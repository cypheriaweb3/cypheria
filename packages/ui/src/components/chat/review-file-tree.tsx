import type { FileTreeOptions, GitStatusEntry } from "@pierre/trees"
import { FileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react"
import { useEffect, useLayoutEffect, useMemo, useRef } from "react"

import { InputGroup, InputGroupAddon, InputGroupInput } from "#components/input-group"
import { useDocumentThemeMode } from "#hooks/use-document-theme-mode"
import { cn } from "#lib/utils"
import { SearchIcon } from "../icons/index.js"
import { chatTreeThemeStyle } from "./files-panel.js"

export type ChatReviewTreeFile = {
  readonly additions?: number
  readonly comments?: number
  readonly deletions?: number
  readonly path: string
  readonly status: GitStatusEntry["status"]
  /** The reader marked this file's current diff as viewed. */
  readonly viewed?: boolean
}

export type ChatReviewFileTreeLabels = {
  readonly filter: string
  readonly noMatches: string
  readonly tree: string
  /** Screen-reader text for one row's counts. */
  readonly rowSummary: (file: ChatReviewTreeFile) => string
}

export type ChatReviewFileTreeProps = {
  readonly className?: string
  readonly filter: string
  readonly files: readonly ChatReviewTreeFile[]
  readonly labels: ChatReviewFileTreeLabels
  readonly onFilterChange: (value: string) => void
  readonly onSelectFile: (path: string) => void
  readonly selectedPath: string | null
}

const ADDED = "var(--diff-added, #00a240)"
const REMOVED = "var(--diff-removed, #e5484d)"
const MUTED = "var(--muted-foreground, #6c6c71)"

/** The changed-file text a row carries: `+12 -3`, then the comment count when there is one. */
export const reviewRowDecoration = (file: ChatReviewTreeFile | undefined, summary: string) => {
  if (!file) return null
  const parts: Array<{ color?: string; text: string }> = []
  if (file.additions !== undefined) parts.push({ color: ADDED, text: `+${file.additions}` })
  if (file.deletions !== undefined) {
    parts.push({ color: REMOVED, text: `${parts.length ? "\u00a0" : ""}-${file.deletions}` })
  }
  if (file.comments) {
    parts.push({
      color: MUTED,
      text: `${parts.length ? "\u00a0\u00a0" : ""}💬\u00a0${file.comments}`,
    })
  }
  if (file.viewed) {
    parts.push({ color: MUTED, text: `${parts.length ? "\u00a0\u00a0" : ""}✓` })
  }
  if (parts.length === 0) return null
  return { parts, text: parts.map((part) => part.text).join(""), title: summary }
}

/** Every directory that holds one of the paths, in the tree's `dir/` form, so all stay open. */
export const directoriesOf = (paths: readonly string[]): string[] => {
  const directories = new Set<string>()
  for (const path of paths) {
    const segments = path.split("/").slice(0, -1)
    for (let index = 1; index <= segments.length; index += 1) {
      directories.add(`${segments.slice(0, index).join("/")}/`)
    }
  }
  return [...directories]
}

/**
 * The changed files of a Review as a tree on the same component as the Files panel: Git status
 * colors, added and removed line counts, comment counts, and a filter that hides non-matches.
 */
export function ChatReviewFileTree({
  className,
  files,
  filter,
  labels,
  onFilterChange,
  onSelectFile,
  selectedPath,
}: ChatReviewFileTreeProps) {
  const themeMode = useDocumentThemeMode()
  const paths = useMemo(() => files.map((file) => file.path), [files])
  const byPath = useRef(new Map<string, ChatReviewTreeFile>())
  const handlers = useRef({ labels, onSelectFile })
  useLayoutEffect(() => {
    byPath.current = new Map(files.map((file) => [file.path, file]))
    handlers.current = { labels, onSelectFile }
  })
  const gitStatus = useMemo(
    () => files.map((file): GitStatusEntry => ({ path: file.path, status: file.status })),
    [files]
  )
  const { model } = useFileTree({
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    gitStatus,
    icons: { colored: true, set: "complete" },
    initialExpansion: "open",
    ...(selectedPath ? { initialSelectedPaths: [selectedPath] } : {}),
    onSelectionChange: (selected) => {
      const next = selected.findLast((path) => byPath.current.has(path))
      if (next) handlers.current.onSelectFile(next)
    },
    paths,
    renderRowDecoration: ({ row }) => {
      const file = byPath.current.get(row.path)
      return reviewRowDecoration(file, file ? handlers.current.labels.rowSummary(file) : "")
    },
  } satisfies FileTreeOptions)

  const knownPaths = useRef(paths)
  useEffect(() => {
    if (knownPaths.current === paths) return
    knownPaths.current = paths
    model.resetPaths(paths, { initialExpandedPaths: directoriesOf(paths) })
  }, [model, paths])
  // A new status list also redraws the rows, so changed counts show up.
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [gitStatus, model])
  useEffect(() => {
    model.setSearch(filter.trim() || null)
  }, [filter, model])

  const selection = useFileTreeSelection(model)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an outside selection drives the tree
  useEffect(() => {
    if (!selectedPath || (selection.length === 1 && selection[0] === selectedPath)) return
    const item = model.getItem(selectedPath)
    if (!item) return
    for (const path of selection) if (path !== selectedPath) model.getItem(path)?.deselect()
    item.select()
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" })
  }, [model, selectedPath])

  const term = filter.trim().toLowerCase()
  const matches = term ? files.some((file) => file.path.toLowerCase().includes(term)) : true

  return (
    <div
      data-slot="chat-review-file-tree"
      className={cn("flex min-h-0 min-w-0 flex-col", className)}
    >
      <InputGroup className="m-2 h-8 w-auto">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={labels.filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={labels.filter}
          value={filter}
        />
      </InputGroup>
      {matches ? (
        <FileTree
          aria-label={labels.tree}
          className="block min-h-0 flex-1"
          model={model}
          style={{ ...chatTreeThemeStyle, colorScheme: themeMode }}
        />
      ) : (
        <p className="p-3 text-muted-foreground text-sm">{labels.noMatches}</p>
      )}
    </div>
  )
}
