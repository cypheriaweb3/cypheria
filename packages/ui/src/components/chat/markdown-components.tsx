"use client"

import type { ComponentProps, ReactNode } from "react"
import { useEffect, useState } from "react"
import {
  CHAT_CODE_COMMENT_TAG,
  CHAT_CREATED_THREAD_TAG,
  CHAT_DEEP_LINK_TAG,
  CHAT_FOLLOWUP_TAG,
  CHAT_PATH_LINK_TAG,
  CHAT_PATH_MEDIA_TAG,
  chatLineNumber,
  chatMediaKindFor,
} from "./markdown-extensions.js"
import {
  type ChatResolvedFile,
  type ChatResolvedPath,
  type ChatReviewTarget,
  useChatMarkdownHost,
} from "./markdown-host.js"

type TargetProps = { "data-target"?: string; children?: ReactNode }

const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u)
    .at(-1) ?? path

/** Resolves once per target, on the Server, and re-resolves when the target changes. */
function useResolvedPath(target: string | undefined): ChatResolvedPath | "loading" | null {
  const host = useChatMarkdownHost()
  const [resolved, setResolved] = useState<ChatResolvedPath | "loading" | null>(null)
  useEffect(() => {
    if (!host || !target) {
      setResolved(null)
      return
    }
    const abort = new AbortController()
    setResolved("loading")
    host
      .resolvePath(target, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setResolved(value)
      })
      .catch(() => {
        if (!abort.signal.aborted) setResolved({ kind: "missing" })
      })
    return () => abort.abort()
  }, [host, target])
  return resolved
}

const unavailableLabel = (
  labels: { fileOutside: string; fileUnavailable: string },
  resolved: ChatResolvedPath
) => (resolved.kind === "outside" ? labels.fileOutside : labels.fileUnavailable)

/** A link to a file or directory on the Server host. */
export function ChatPathLink({ children, "data-target": target }: TargetProps) {
  const host = useChatMarkdownHost()
  const [failure, setFailure] = useState<string | null>(null)
  if (!host || !target) return <span>{children}</span>
  const open = async () => {
    try {
      const resolved = await host.resolvePath(target)
      if (resolved.kind === "file" || resolved.kind === "directory") {
        setFailure(null)
        host.openPath(resolved)
      } else setFailure(unavailableLabel(host.labels, resolved))
    } catch {
      setFailure(host.labels.fileUnavailable)
    }
  }
  return (
    <button
      aria-disabled={failure !== null}
      className="inline cursor-pointer break-all border-0 bg-transparent p-0 text-left text-inherit underline underline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:line-through"
      data-slot="chat-path-link"
      onClick={() => void open()}
      title={failure ?? target}
      type="button"
    >
      {children}
    </button>
  )
}

/** An image, audio clip, or video that lives on the Server host. */
export function ChatPathMedia({
  "data-alt": alt = "",
  "data-target": target,
}: {
  "data-alt"?: string
  "data-target"?: string
}) {
  const host = useChatMarkdownHost()
  const resolved = useResolvedPath(target)
  const [media, setMedia] = useState<{ kind: "audio" | "image" | "video"; url: string } | null>(
    null
  )
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setMedia(null)
    setFailed(false)
    if (!host || !resolved || resolved === "loading") return
    if (resolved.kind !== "file") {
      setFailed(true)
      return
    }
    const kind = mediaKindOf(resolved)
    if (!kind) {
      setFailed(true)
      return
    }
    const abort = new AbortController()
    let release: (() => void) | undefined
    host
      .loadFile(resolved, abort.signal)
      .then((loaded) => {
        if (abort.signal.aborted) {
          loaded?.release()
          return
        }
        if (!loaded) {
          setFailed(true)
          return
        }
        release = loaded.release
        setMedia({ kind, url: loaded.url })
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true)
      })
    return () => {
      abort.abort()
      release?.()
    }
  }, [host, resolved])

  const label = alt || (target ? baseName(target) : "")
  if (!host) return <span>{label}</span>
  if (media?.kind === "image") {
    return (
      <img
        alt={alt}
        className="my-2 max-h-[28rem] max-w-full rounded-md border border-border"
        data-slot="chat-path-media"
        src={media.url}
      />
    )
  }
  if (media?.kind === "audio") {
    // biome-ignore lint/a11y/useMediaCaption: an Agent-written clip has no caption track
    return <audio className="my-2 w-full" controls data-slot="chat-path-media" src={media.url} />
  }
  if (media?.kind === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: an Agent-written clip has no caption track
      <video
        className="my-2 max-h-[28rem] max-w-full rounded-md border border-border"
        controls
        data-slot="chat-path-media"
        src={media.url}
      />
    )
  }
  return (
    <span
      aria-busy={!failed}
      className="inline-flex max-w-full items-center rounded-md border border-border px-2 py-0.5 text-sm text-muted-foreground"
      data-slot="chat-path-media"
      title={failed ? host.labels.mediaUnavailable : target}
    >
      {label}
      {failed ? ` · ${host.labels.mediaUnavailable}` : null}
    </span>
  )
}

function mediaKindOf(file: ChatResolvedFile): "audio" | "image" | "video" | null {
  if (file.mimeType.startsWith("image/")) return "image"
  if (file.mimeType.startsWith("audio/")) return "audio"
  if (file.mimeType.startsWith("video/")) return "video"
  return chatMediaKindFor(file.path)
}

/** `cypheria://review?pr=…&path=…&line=…&side=…`. */
export function ChatDeepLink({ children, "data-target": target }: TargetProps) {
  const host = useChatMarkdownHost()
  const review = target ? parseReviewLink(target) : null
  if (!host?.openReview || !review) return <span>{children}</span>
  return (
    <button
      className="inline cursor-pointer break-all border-0 bg-transparent p-0 text-left text-inherit underline underline-offset-2"
      data-slot="chat-deep-link"
      onClick={() => host.openReview?.(review)}
      type="button"
    >
      {children}
    </button>
  )
}

export function parseReviewLink(target: string): ChatReviewTarget | null {
  try {
    const url = new URL(target)
    if (url.protocol !== "cypheria:" || url.hostname !== "review") return null
    const pr = url.searchParams.get("pr")
    if (!pr) return null
    const side = url.searchParams.get("side")
    const line = chatLineNumber(url.searchParams.get("line") ?? undefined)
    const path = url.searchParams.get("path")
    return {
      pr,
      ...(path ? { path } : {}),
      ...(line ? { line } : {}),
      ...(side === "left" || side === "right" ? { side } : {}),
    }
  } catch {
    return null
  }
}

type CodeCommentProps = {
  "data-body"?: string
  "data-end"?: string
  "data-file"?: string
  "data-priority"?: string
  "data-start"?: string
  "data-title"?: string
}

/** `::code-comment{…}`: feedback attached to specific lines of a file. */
export function ChatCodeComment(props: CodeCommentProps) {
  const host = useChatMarkdownHost()
  const file = props["data-file"]
  const start = chatLineNumber(props["data-start"])
  const end = chatLineNumber(props["data-end"])
  const location = file
    ? `${file}${start ? `:${start}${end && end !== start ? `-${end}` : ""}` : ""}`
    : ""
  const priority = props["data-priority"]
  const open = async () => {
    if (!host || !file) return
    const resolved = await host.resolvePath(start ? `${file}#L${start}` : file).catch(() => null)
    if (resolved && (resolved.kind === "file" || resolved.kind === "directory"))
      host.openPath(resolved)
  }
  return (
    <aside
      className="my-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
      data-slot="chat-code-comment"
    >
      <div className="flex items-baseline gap-2">
        {priority && host ? (
          <span className="shrink-0 rounded border border-border px-1 text-xs text-muted-foreground">
            {host.labels.codeCommentPriority(priority)}
          </span>
        ) : null}
        <strong className="font-medium">{props["data-title"]}</strong>
      </div>
      {props["data-body"] ? <p className="mt-1 whitespace-pre-wrap">{props["data-body"]}</p> : null}
      {location ? (
        host ? (
          <button
            className="mt-2 cursor-pointer break-all border-0 bg-transparent p-0 text-left font-mono text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => void open()}
            title={host.labels.openFile}
            type="button"
          >
            {location}
          </button>
        ) : (
          <code className="mt-2 block break-all text-xs text-muted-foreground">{location}</code>
        )
      ) : null}
    </aside>
  )
}

/** `:codex-followup[phrase]{prompt="…"}`: a suggested next message. */
export function ChatFollowUp({
  children,
  "data-prompt": prompt,
}: {
  children?: ReactNode
  "data-prompt"?: string
}) {
  const host = useChatMarkdownHost()
  if (!host?.sendFollowUp || !prompt) return <span>{children}</span>
  return (
    <button
      className="cursor-pointer rounded-full border border-border bg-transparent px-3 py-0.5 text-left text-sm hover:bg-muted"
      data-slot="chat-followup"
      onClick={() => host.sendFollowUp?.(prompt)}
      type="button"
    >
      {children}
    </button>
  )
}

/** `::created-thread{threadId="…"}`: a link to a Thread the Agent just created. */
export function ChatCreatedThread(props: {
  "data-client-thread-id"?: string
  "data-thread-id"?: string
}) {
  const host = useChatMarkdownHost()
  const threadId = props["data-thread-id"]
  if (!host?.openThread || !threadId) return null
  return (
    <button
      className="my-1 cursor-pointer rounded-md border border-border bg-transparent px-3 py-1 text-left text-sm hover:bg-muted"
      data-slot="chat-created-thread"
      onClick={() => host.openThread?.(threadId)}
      type="button"
    >
      {host.labels.createdThread}
    </button>
  )
}

export const chatMarkdownComponents = {
  [CHAT_CODE_COMMENT_TAG]: ChatCodeComment,
  [CHAT_CREATED_THREAD_TAG]: ChatCreatedThread,
  [CHAT_DEEP_LINK_TAG]: ChatDeepLink,
  [CHAT_FOLLOWUP_TAG]: ChatFollowUp,
  [CHAT_PATH_LINK_TAG]: ChatPathLink,
  [CHAT_PATH_MEDIA_TAG]: ChatPathMedia,
} as unknown as NonNullable<ComponentProps<typeof import("streamdown").Streamdown>["components"]>
