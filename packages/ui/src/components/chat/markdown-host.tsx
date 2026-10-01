"use client"

import { createContext, useContext } from "react"

/**
 * What a client does with the references in an Agent's reply.
 *
 * The Agent runs on the Server host, so every path it writes is a path on that host. A client never
 * opens one itself: it asks the Server (`resolvePath`), then reads bytes or opens a panel through the
 * Server's own file API. A client without a host renders plain Markdown, and the references degrade
 * to readable text.
 */

export type ChatResolvedPath =
  | {
      readonly kind: "file"
      readonly endLine?: number
      readonly line?: number
      readonly mimeType: string
      readonly path: string
      readonly root: string
      readonly sizeBytes: number
    }
  | { readonly kind: "directory"; readonly path: string; readonly root: string }
  | { readonly kind: "missing" }
  | { readonly kind: "outside" }

export type ChatResolvedFile = Extract<ChatResolvedPath, { kind: "file" }>

export type ChatReviewTarget = {
  readonly line?: number
  readonly path?: string
  readonly pr: string
  readonly side?: "left" | "right"
}

/** Strings the Markdown extensions show; the application supplies them translated. */
export type ChatMarkdownLabels = {
  readonly codeCommentPriority: (priority: string) => string
  readonly createdThread: string
  readonly fileOutside: string
  readonly fileUnavailable: string
  readonly mediaUnavailable: string
  readonly openFile: string
}

export interface ChatMarkdownHost {
  readonly labels: ChatMarkdownLabels
  /** Resolves a path an Agent wrote against the Thread's roots on the Server host. */
  resolvePath(path: string, signal?: AbortSignal): Promise<ChatResolvedPath>
  /**
   * Reads a resolved file as an object URL, or null when it cannot be shown (too large, removed).
   * The caller calls `release` once the URL is no longer displayed.
   */
  loadFile(
    file: ChatResolvedFile,
    signal?: AbortSignal
  ): Promise<{ readonly release: () => void; readonly url: string } | null>
  /** Shows a resolved file or directory, for instance in the Files panel. */
  openPath(path: ChatResolvedPath): void
  openReview?(target: ChatReviewTarget): void
  openThread?(threadId: string): void
  /** Sends a suggested follow-up as the next message of the Thread. */
  sendFollowUp?(prompt: string): void
}

export const ChatMarkdownHostContext = createContext<ChatMarkdownHost | null>(null)

export function useChatMarkdownHost(): ChatMarkdownHost | null {
  return useContext(ChatMarkdownHostContext)
}
