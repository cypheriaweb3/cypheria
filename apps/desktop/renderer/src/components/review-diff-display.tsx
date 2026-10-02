import {
  ChatDiffOptionsMenu,
  type ChatDiffViewerLabels,
  ChatJumpToFile,
  chatGitApplyCommand,
} from "@cypheria/ui/components/chat"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useAtom } from "jotai"
import { type ReactNode, useEffect, useMemo } from "react"

import { gitReviewDiffDisplayAtom, reviewViewedAtom } from "../client-state.js"

/** The saved diff layout, word-change, and wrapping preferences shared by every Review diff. */
export const useReviewDiffDisplay = () => useAtom(gitReviewDiffDisplayAtom)

/** Header labels of the shared diff viewer in the current language. */
export const useDiffViewerLabels = (): ChatDiffViewerLabels => {
  const { i18n } = useLingui()
  return {
    collapse: i18n._(msg({ id: "git.diff.collapseFile", message: "Collapse file" })),
    expand: i18n._(msg({ id: "git.diff.expandFile", message: "Expand file" })),
    viewed: i18n._(msg({ id: "git.diff.viewed", message: "Viewed" })),
  }
}

/**
 * Files of one Review scope marked as viewed. A mark holds the fingerprint of the diff that was
 * viewed, so it lapses when that file's diff changes; marks of files outside `fingerprints` are
 * kept until their diff is seen again.
 */
export const useViewedFiles = (scope: string, fingerprints: ReadonlyMap<string, string>) => {
  const [stored, setStored] = useAtom(reviewViewedAtom(scope))
  useEffect(() => {
    const stale = Object.entries(stored).filter(([path, fingerprint]) => {
      const current = fingerprints.get(path)
      return current !== undefined && current !== fingerprint
    })
    if (stale.length === 0) return
    setStored((value) => {
      const next = { ...value }
      for (const [path] of stale) delete next[path]
      return next
    })
  }, [fingerprints, setStored, stored])
  const viewedPaths = useMemo(
    () =>
      new Set(
        Object.entries(stored)
          .filter(([path, fingerprint]) => fingerprints.get(path) === fingerprint)
          .map(([path]) => path)
      ),
    [fingerprints, stored]
  )
  const markedPaths = useMemo(() => new Set(Object.keys(stored)), [stored])
  const setViewed = (path: string, viewed: boolean) => {
    const fingerprint = fingerprints.get(path)
    setStored((value) => {
      const next = { ...value }
      if (viewed && fingerprint) next[path] = fingerprint
      else delete next[path]
      return next
    })
  }
  return { markedPaths, setViewed, viewedPaths }
}

/** The diff options menu and the jump-to-file list above a Review diff. */
export function ReviewDiffControls({
  children,
  files,
  fullFiles,
  onCollapseAll,
  onError,
  onExpandAll,
  onFullFilesChange,
  onJumpToFile,
  patch,
}: Readonly<{
  children?: ReactNode
  files: readonly string[]
  fullFiles?: boolean
  onCollapseAll?: () => void
  onError: (message: string) => void
  onExpandAll?: () => void
  onFullFilesChange?: (value: boolean) => void
  onJumpToFile: (path: string) => void
  /** The patch to copy as a `git apply` command, when there is one. */
  patch?: string
}>) {
  const { i18n } = useLingui()
  const [display, setDisplay] = useReviewDiffDisplay()
  return (
    <span className="inline-flex items-center gap-0.5">
      {files.length > 1 ? (
        <ChatJumpToFile
          files={files}
          labels={{
            empty: i18n._(msg({ id: "git.diff.jumpToFile.empty", message: "No matching files" })),
            placeholder: i18n._(
              msg({ id: "git.diff.jumpToFile.placeholder", message: "Jump to file…" })
            ),
            trigger: i18n._(msg({ id: "git.diff.jumpToFile", message: "Jump to file" })),
          }}
          onSelect={onJumpToFile}
        />
      ) : null}
      <ChatDiffOptionsMenu
        diffStyle={display.diffStyle}
        fullFiles={fullFiles ?? false}
        labels={{
          auto: i18n._(msg({ id: "git.diff.layout.auto", message: "Auto" })),
          collapseAll: i18n._(msg({ id: "git.diff.collapseAll", message: "Collapse all diffs" })),
          copyGitApply: i18n._(
            msg({ id: "git.diff.copyGitApply", message: "Copy git apply command" })
          ),
          expandAll: i18n._(msg({ id: "git.diff.expandAll", message: "Expand all diffs" })),
          fullFiles: i18n._(msg({ id: "git.diff.fullFiles", message: "Load full files" })),
          layout: i18n._(msg({ id: "git.diff.layout", message: "Layout" })),
          menu: i18n._(msg({ id: "git.diff.options", message: "Diff options" })),
          split: i18n._(msg({ id: "git.diff.layout.split", message: "Split" })),
          unified: i18n._(msg({ id: "git.diff.layout.unified", message: "Unified" })),
          wordDiffs: i18n._(msg({ id: "git.diff.wordDiffs", message: "Word diffs" })),
          wrap: i18n._(msg({ id: "git.diff.wrap", message: "Word wrap" })),
        }}
        onDiffStyleChange={(diffStyle) => setDisplay((value) => ({ ...value, diffStyle }))}
        onWordDiffsChange={(wordDiffs) => setDisplay((value) => ({ ...value, wordDiffs }))}
        onWrapChange={(wrap) => setDisplay((value) => ({ ...value, wrap }))}
        wordDiffs={display.wordDiffs}
        wrap={display.wrap}
        {...(onFullFilesChange ? { onFullFilesChange } : {})}
        {...(onExpandAll ? { onExpandAll } : {})}
        {...(onCollapseAll ? { onCollapseAll } : {})}
        {...(patch?.trim()
          ? {
              onCopyGitApply: () =>
                void navigator.clipboard
                  .writeText(chatGitApplyCommand(patch))
                  .catch((error: unknown) =>
                    onError(error instanceof Error ? error.message : String(error))
                  ),
            }
          : {})}
      >
        {children}
      </ChatDiffOptionsMenu>
    </span>
  )
}
