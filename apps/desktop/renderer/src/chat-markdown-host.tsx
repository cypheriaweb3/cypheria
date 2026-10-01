import type { CypheriaApi } from "@cypheria/client"
import type {
  ChatMarkdownHost,
  ChatResolvedFile,
  ChatResolvedPath,
} from "@cypheria/ui/components/chat"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useMemo } from "react"

import { clientStateStore, threadFilesAtom } from "./client-state.js"
import { ensureCypheriaClient } from "./cypheria-client.js"

type Options = {
  readonly openFilesPanel: () => void
  readonly openReviewPanel: () => void
  readonly openThread: (threadId: string) => void
  readonly sendFollowUp: (prompt: string) => void
  readonly threadId: string | null
}

type ThreadFileReadResult = Awaited<ReturnType<CypheriaApi["threads"]["files"]["read"]>>

const blobFor = (result: ThreadFileReadResult): Blob | null => {
  if (result.kind === "binary") {
    return new Blob([Uint8Array.from(result.bytes).buffer], { type: result.mimeType })
  }
  if (result.kind === "text") return new Blob([result.content], { type: result.mimeType })
  return null
}

/** Points the Files panel at a path the Agent mentioned. */
export const showThreadPath = (threadId: string, resolved: ChatResolvedPath): void => {
  if (resolved.kind !== "file" && resolved.kind !== "directory") return
  const atom = threadFilesAtom(threadId)
  const current = clientStateStore.get(atom)
  const expanded = new Set(current.expandedByRoot[resolved.root] ?? [])
  if (resolved.kind === "directory" && resolved.path) {
    expanded.add(`${resolved.path.replace(/\/$/u, "")}/`)
  }
  clientStateStore.set(atom, {
    ...current,
    activeRoot: resolved.root,
    expandedByRoot: { ...current.expandedByRoot, [resolved.root]: [...expanded] },
    selectedByRoot:
      resolved.kind === "file"
        ? { ...current.selectedByRoot, [resolved.root]: resolved.path }
        : current.selectedByRoot,
    treeOpen: true,
  })
}

/**
 * What the conversation does with the files, links, and directives in an Agent's reply. Paths are
 * Server-host paths, so every read goes through the Server's file API; the renderer never touches
 * its own file system for them.
 */
export function useThreadMarkdownHost({
  openFilesPanel,
  openReviewPanel,
  openThread,
  sendFollowUp,
  threadId,
}: Options): ChatMarkdownHost | null {
  const { i18n } = useLingui()
  return useMemo(() => {
    if (!threadId) return null
    return {
      labels: {
        codeCommentPriority: (priority) =>
          i18n._({
            ...msg({ id: "chat.markdown.priority", message: "P{priority}" }),
            values: { priority },
          }),
        createdThread: i18n._(
          msg({ id: "chat.markdown.createdThread", message: "Open the new chat" })
        ),
        fileOutside: i18n._(
          msg({ id: "chat.markdown.fileOutside", message: "Outside this chat's folders" })
        ),
        fileUnavailable: i18n._(
          msg({ id: "chat.markdown.fileUnavailable", message: "This file is not available" })
        ),
        mediaUnavailable: i18n._(
          msg({ id: "chat.markdown.mediaUnavailable", message: "Cannot be shown" })
        ),
        openFile: i18n._(msg({ id: "chat.markdown.openFile", message: "Open in Files" })),
      },
      loadFile: async (file: ChatResolvedFile, signal?: AbortSignal) => {
        const client = await ensureCypheriaClient()
        const result = await client.threads.files.read(
          { path: file.path, root: file.root, threadId },
          signal ? { signal } : undefined
        )
        const blob = blobFor(result)
        if (!blob) return null
        const url = URL.createObjectURL(blob)
        return { release: () => URL.revokeObjectURL(url), url }
      },
      openPath: (resolved) => {
        showThreadPath(threadId, resolved)
        openFilesPanel()
      },
      openReview: () => openReviewPanel(),
      openThread,
      resolvePath: async (path, signal) => {
        const client = await ensureCypheriaClient()
        return client.threads.paths.resolve(
          { path, threadId },
          signal ? { signal } : undefined
        ) as Promise<ChatResolvedPath>
      },
      sendFollowUp,
    } satisfies ChatMarkdownHost
  }, [i18n, openFilesPanel, openReviewPanel, openThread, sendFollowUp, threadId])
}
