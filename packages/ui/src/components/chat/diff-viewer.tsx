import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs"
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react"
import { type ReactNode, useEffect, useMemo, useRef } from "react"
import { useDocumentThemeMode } from "#hooks/use-document-theme-mode"
import { cn } from "#lib/utils"
import { chatCodeThemeStyle } from "./files-panel.js"

export type ChatDiffSide = "additions" | "deletions"

/** Something drawn under a changed line: a review thread, a draft comment, a build note. */
export type ChatDiffAnnotation = {
  key: string
  /** Path as it appears in the patch, on the side the line belongs to. */
  path: string
  side: ChatDiffSide
  lineNumber: number
  content: ReactNode
}

export type ChatDiffTarget = { lineNumber: number; path: string; side: ChatDiffSide }

export type ChatDiffFocus = ChatDiffTarget & {
  /** A new value scrolls to the line again, even when the target did not change. */
  nonce?: number | string
}

export type ChatDiffViewerProps = {
  annotations?: readonly ChatDiffAnnotation[]
  className?: string
  focus?: ChatDiffFocus | null
  /** When set, hovering a line shows a button that reports the line to comment on. */
  onRequestComment?: (target: ChatDiffTarget) => void
  /** A unified diff with `diff --git` headers, one file or many. */
  patch: string
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

const itemIdFor = (
  files: ReadonlyArray<{ file: FileDiffMetadata; id: string }>,
  path: string
): string | undefined =>
  files.find(({ file }) => file.name === path)?.id ??
  files.find(({ file }) => file.prevName === path)?.id

/**
 * A scrollable diff of one or more files on the shared code viewer: syntax highlighting, unified or
 * split layout, collapsed context, and inline annotations. Large patches stay responsive because
 * the viewer only renders the files near the viewport.
 */
export function ChatDiffViewer({
  annotations = [],
  className,
  fallback,
  focus,
  onRequestComment,
  patch,
}: ChatDiffViewerProps) {
  const themeMode = useDocumentThemeMode()
  const handle = useRef<CodeViewHandle<ChatDiffAnnotation, undefined>>(null)
  const files = useMemo(() => parseChatDiffFiles(patch), [patch])
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
        fileDiff: file,
        id,
        type: "diff" as const,
        version: annotations.length,
      })),
    [annotations, files]
  )
  const canComment = Boolean(onRequestComment)
  const options = useMemo(
    () => ({
      diffStyle: "unified" as const,
      enableGutterUtility: canComment,
      onGutterUtilityClick: (
        range: { end: number; side?: ChatDiffSide; start: number },
        context: { item: { id: string } }
      ) => {
        const file = files.find(({ id }) => id === context.item.id)?.file
        if (!file) return
        onRequestComment?.({
          lineNumber: range.end,
          path: file.name,
          side: range.side ?? "additions",
        })
      },
      overflow: "wrap" as const,
      themeType: themeMode,
    }),
    [canComment, files, onRequestComment, themeMode]
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
      handle.current?.scrollTo({
        align: "center",
        id,
        lineNumber: focus.lineNumber,
        side: focus.side,
        type: "line",
      })
      handle.current?.setSelectedLines({
        id,
        range: { end: focus.lineNumber, side: focus.side, start: focus.lineNumber },
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusKey, files])

  if (files.length === 0) return <>{fallback ?? null}</>
  return (
    <CodeView<ChatDiffAnnotation>
      ref={handle}
      className={cn("min-h-0 min-w-0 flex-1 overflow-auto bg-background", className)}
      items={items}
      options={options}
      renderAnnotation={(annotation) => (annotation.metadata as ChatDiffAnnotation).content}
      style={chatCodeThemeStyle}
    />
  )
}
