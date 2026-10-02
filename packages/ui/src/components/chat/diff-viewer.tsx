import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs"
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Checkbox } from "#components/checkbox"
import { useDocumentThemeMode } from "#hooks/use-document-theme-mode"
import { cn } from "#lib/utils"
import { ChevronDownIcon } from "../icons/index.js"
import { chatCodeThemeStyle } from "./files-panel.js"

export type ChatDiffSide = "additions" | "deletions"

/** Old and new side by side, interleaved, or chosen from the width and the kind of change. */
export type ChatDiffStyle = "auto" | "split" | "unified"

/** Something drawn under a changed line: a review thread, a draft comment, a build note. */
export type ChatDiffAnnotation = {
  key: string
  /** Path as it appears in the patch, on the side the line belongs to. */
  path: string
  side: ChatDiffSide
  lineNumber: number
  content: ReactNode
}

/** A line, or a range ending at `lineNumber` when `startLineNumber` is set and smaller. */
export type ChatDiffTarget = {
  lineNumber: number
  path: string
  side: ChatDiffSide
  startLineNumber?: number
}

/** A line to scroll to and select; line 0 scrolls to the top of the file instead. */
export type ChatDiffFocus = ChatDiffTarget & {
  /** A new value scrolls to the line again, even when the target did not change. */
  nonce?: number | string
}

/** A file of the patch: its path, and its previous path when it was renamed. */
export type ChatDiffFileRef = { path: string; prevPath?: string }

/** Both complete versions of a file; `oldContents` is null for a pure rename. */
export type ChatDiffLoadedFiles = { oldContents: string | null; newContents: string }

export type ChatDiffViewerLabels = {
  collapse: string
  expand: string
  viewed: string
}

const defaultLabels: ChatDiffViewerLabels = {
  collapse: "Collapse file",
  expand: "Expand file",
  viewed: "Viewed",
}

export type ChatDiffViewerProps = {
  annotations?: readonly ChatDiffAnnotation[]
  className?: string
  focus?: ChatDiffFocus | null
  /** When set, hovering a line shows a button that reports the line, or a selected range. */
  onRequestComment?: (target: ChatDiffTarget) => void
  /** A unified diff with `diff --git` headers, one file or many. */
  patch: string
  /** Unified by default; `auto` splits wide views of files that both add and remove lines. */
  diffStyle?: ChatDiffStyle
  /** Wrap long lines instead of scrolling them. On by default. */
  wrap?: boolean
  /** Highlight the changed words inside a changed line. On by default. */
  wordDiffs?: boolean
  /** Files shown as a header only. */
  collapsedPaths?: ReadonlySet<string>
  /** When set, each file header offers a collapse toggle. */
  onToggleCollapsed?: (path: string) => void
  /** Files the reader has marked as viewed. */
  viewedPaths?: ReadonlySet<string>
  /** When set, each file header offers a Viewed checkbox. */
  onToggleViewed?: (path: string, viewed: boolean) => void
  /** Extra controls at the end of each file header, such as a menu of file actions. */
  renderFileActions?: (file: ChatDiffFileRef) => ReactNode
  /** Supplies both complete versions of a file so the unchanged lines between hunks can open. */
  loadFiles?: (file: ChatDiffFileRef) => Promise<ChatDiffLoadedFiles>
  /** Show every unchanged line once complete files are loaded. */
  expandUnchanged?: boolean
  labels?: Partial<ChatDiffViewerLabels>
  /** Shown in place of the viewer when the patch holds no file diff. */
  fallback?: ReactNode
}

/** Files of a unified diff, in order, each with an id that is unique within the patch. */
export const parseChatDiffFiles = (
  patch: string
): Array<{ file: FileDiffMetadata; id: string }> => {
  if (!patch.trim()) return []
  let parsed: ReturnType<typeof parsePatchFiles>
  try {
    parsed = parsePatchFiles(patch)
  } catch {
    return []
  }
  const seen = new Map<string, number>()
  return parsed
    .flatMap((entry) => entry.files)
    .map((file) => {
      const count = seen.get(file.name) ?? 0
      seen.set(file.name, count + 1)
      return { file, id: count === 0 ? file.name : `${file.name}#${count}` }
    })
}

const fnv1a = (text: string, seed: number): string => {
  let hash = seed
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * A short fingerprint of each file's change in a patch, keyed by path, so a reader's "viewed"
 * mark can be dropped when that file's diff changes.
 */
export const chatDiffFingerprints = (patch: string): Map<string, string> => {
  const fingerprints = new Map<string, string>()
  for (const { file } of parseChatDiffFiles(patch)) {
    const text = [
      file.prevName ?? "",
      file.name,
      file.type,
      ...file.hunks.map(
        (hunk) =>
          `${hunk.deletionStart},${hunk.deletionCount},${hunk.additionStart},${hunk.additionCount}`
      ),
      file.deletionLines.join("\n"),
      "\u0000",
      file.additionLines.join("\n"),
    ].join("\u0001")
    fingerprints.set(file.name, `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01234567)}`)
  }
  return fingerprints
}

/** Width below which `auto` always interleaves the two sides. */
export const CHAT_DIFF_AUTO_SPLIT_WIDTH = 800

/**
 * The layout `auto` resolves to: split when the view is wide enough and some file both removes
 * and adds lines; unified when it is narrow or every change is one-sided.
 */
export const resolveChatDiffStyle = (
  style: ChatDiffStyle,
  width: number,
  files: readonly FileDiffMetadata[]
): "split" | "unified" => {
  if (style !== "auto") return style
  if (width < CHAT_DIFF_AUTO_SPLIT_WIDTH) return "unified"
  return files.some((file) =>
    file.hunks.some((hunk) => hunk.additionLines > 0 && hunk.deletionLines > 0)
  )
    ? "split"
    : "unified"
}

/** A comment target from a gutter click: one line, or the selected range on one side. */
export const chatDiffTargetFromRange = (
  path: string,
  range: { end: number; endSide?: ChatDiffSide; side?: ChatDiffSide; start: number }
): ChatDiffTarget => {
  const side = range.endSide ?? range.side ?? "additions"
  const sameSide = (range.side ?? side) === side
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  return sameSide && start !== end
    ? { lineNumber: end, path, side, startLineNumber: start }
    : { lineNumber: range.end, path, side }
}

const itemIdFor = (
  files: ReadonlyArray<{ file: FileDiffMetadata; id: string }>,
  path: string
): string | undefined =>
  files.find(({ file }) => file.name === path)?.id ??
  files.find(({ file }) => file.prevName === path)?.id

const fileRef = (file: FileDiffMetadata): ChatDiffFileRef =>
  file.prevName && file.prevName !== file.name
    ? { path: file.name, prevPath: file.prevName }
    : { path: file.name }

/**
 * A scrollable diff of one or more files on the shared code viewer: syntax highlighting, unified,
 * split, or automatic layout, word-level changes, collapsible and viewed files, expandable
 * context, and inline annotations. Large patches stay responsive because the viewer only renders
 * the files near the viewport.
 */
export function ChatDiffViewer({
  annotations = [],
  className,
  collapsedPaths,
  diffStyle = "unified",
  expandUnchanged = false,
  wrap = true,
  wordDiffs = true,
  fallback,
  focus,
  labels: labelOverrides,
  loadFiles,
  onRequestComment,
  onToggleCollapsed,
  onToggleViewed,
  patch,
  renderFileActions,
  viewedPaths,
}: ChatDiffViewerProps) {
  const themeMode = useDocumentThemeMode()
  const labels = { ...defaultLabels, ...labelOverrides }
  const handle = useRef<CodeViewHandle<ChatDiffAnnotation, undefined>>(null)
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const containerRef = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.current.observe(element)
  }, [])
  const files = useMemo(() => parseChatDiffFiles(patch), [patch])
  const resolvedStyle = resolveChatDiffStyle(
    diffStyle,
    width,
    files.map(({ file }) => file)
  )
  const items = useMemo(
    () =>
      files.map(({ file, id }) => ({
        annotations: annotations
          .filter((annotation) => itemIdFor([{ file, id }], annotation.path) === id)
          .map((annotation) => ({
            lineNumber: annotation.lineNumber,
            metadata: annotation,
            side: annotation.side,
          })),
        collapsed: collapsedPaths?.has(file.name) ?? false,
        fileDiff: file,
        id,
        type: "diff" as const,
        version: annotations.length,
      })),
    [annotations, collapsedPaths, files]
  )
  const canComment = Boolean(onRequestComment)
  const options = useMemo(
    () => ({
      diffStyle: resolvedStyle,
      enableGutterUtility: canComment,
      enableLineSelection: canComment,
      expandUnchanged: Boolean(loadFiles) && expandUnchanged,
      lineDiffType: wordDiffs ? ("word-alt" as const) : ("none" as const),
      ...(loadFiles
        ? {
            loadDiffFiles: async (fileDiff: FileDiffMetadata) => {
              const loaded = await loadFiles(fileRef(fileDiff))
              return loaded.oldContents === null
                ? { newFile: { contents: loaded.newContents, name: fileDiff.name }, oldFile: null }
                : {
                    newFile: { contents: loaded.newContents, name: fileDiff.name },
                    oldFile: {
                      contents: loaded.oldContents,
                      name: fileDiff.prevName ?? fileDiff.name,
                    },
                  }
            },
          }
        : {}),
      onGutterUtilityClick: (
        range: { end: number; endSide?: ChatDiffSide; side?: ChatDiffSide; start: number },
        context: { item: { id: string } }
      ) => {
        const file = files.find(({ id }) => id === context.item.id)?.file
        if (!file) return
        onRequestComment?.(chatDiffTargetFromRange(file.name, range))
      },
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      stickyHeaders: true,
      themeType: themeMode,
    }),
    [
      canComment,
      expandUnchanged,
      files,
      loadFiles,
      onRequestComment,
      resolvedStyle,
      themeMode,
      wordDiffs,
      wrap,
    ]
  )
  const focusKey = focus
    ? `${focus.path}:${focus.side}:${focus.lineNumber}:${focus.nonce ?? ""}`
    : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolling is driven by the focus key and the parsed files only
  useEffect(() => {
    if (!focus) return
    const id = itemIdFor(files, focus.path)
    if (!id) return
    const frame = requestAnimationFrame(() => {
      if (focus.lineNumber < 1) {
        handle.current?.scrollTo({ align: "start", id, type: "item" })
        return
      }
      handle.current?.scrollTo({
        align: "center",
        id,
        lineNumber: focus.lineNumber,
        side: focus.side,
        type: "line",
      })
      handle.current?.setSelectedLines({
        id,
        range: {
          end: focus.lineNumber,
          side: focus.side,
          start: focus.startLineNumber ?? focus.lineNumber,
        },
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusKey, files])

  const fileOf = (item: { id: string }) => files.find(({ id }) => id === item.id)?.file

  if (files.length === 0) return <>{fallback ?? null}</>
  return (
    <CodeView<ChatDiffAnnotation>
      ref={handle}
      className={cn("min-h-0 min-w-0 flex-1 overflow-auto bg-background", className)}
      containerRef={containerRef}
      items={items}
      options={options}
      renderAnnotation={(annotation) => (annotation.metadata as ChatDiffAnnotation).content}
      {...(onToggleCollapsed
        ? {
            renderHeaderPrefix: (item: { id: string }) => {
              const file = fileOf(item)
              if (!file) return null
              const collapsed = collapsedPaths?.has(file.name) ?? false
              return (
                <button
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? labels.expand : labels.collapse}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                  data-slot="chat-diff-collapse"
                  onClick={() => onToggleCollapsed(file.name)}
                  title={collapsed ? labels.expand : labels.collapse}
                  type="button"
                >
                  <ChevronDownIcon
                    className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
                  />
                </button>
              )
            },
          }
        : {})}
      {...(onToggleViewed || renderFileActions
        ? {
            renderHeaderMetadata: (item: { id: string }) => {
              const file = fileOf(item)
              if (!file) return null
              const viewed = viewedPaths?.has(file.name) ?? false
              return (
                <span className="inline-flex items-center gap-2" data-slot="chat-diff-file-meta">
                  {onToggleViewed ? (
                    // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox renders the control inside the label
                    <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                      <Checkbox
                        checked={viewed}
                        onCheckedChange={(checked) => onToggleViewed(file.name, checked === true)}
                      />
                      {labels.viewed}
                    </label>
                  ) : null}
                  {renderFileActions?.(fileRef(file))}
                </span>
              )
            },
          }
        : {})}
      style={chatCodeThemeStyle}
    />
  )
}
