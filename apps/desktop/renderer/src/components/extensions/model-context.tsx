import type { ExtensionModelContext } from "@cypheria/protocol"
import { ChatComposerAttachmentList, ChatComposerHeader } from "@cypheria/ui/components/chat"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { ensureCypheriaClient } from "../../cypheria-client.js"

type Block = {
  _meta?: Record<string, unknown>
  annotations?: { audience?: string[] }
  data?: string
  mimeType?: string
  name?: string
  resource?: { uri?: string }
  text?: string
  title?: string
  type?: string
}

const contextQueryKey = (threadId: string) => ["extensions", "context", threadId] as const

/** The model context Apps attached to a Thread's next message. */
export function useModelContext(threadId: string | null): ExtensionModelContext[] {
  const queryClient = useQueryClient()
  const query = useQuery({
    enabled: Boolean(threadId),
    queryFn: async () => (await ensureCypheriaClient()).extensions.context.list(threadId as string),
    queryKey: contextQueryKey(threadId ?? ""),
  })
  useEffect(() => {
    if (!threadId) return
    let unsubscribe: (() => void) | undefined
    let disposed = false
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribe = client.on("extension.context.updated.notification", (message) => {
        if (message.payload.threadId !== threadId) return
        void queryClient.invalidateQueries({ queryKey: contextQueryKey(threadId) })
      })
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [queryClient, threadId])
  return query.data ?? []
}

/** A block's attachment label: its `openai/title`, or what it shows. */
const blockName = (block: Block): string => {
  const title = block._meta?.["openai/title"]
  if (typeof title === "string" && title.trim()) return title.trim()
  if (block.type === "text") return (block.text ?? "").slice(0, 80) || "Text"
  if (block.type === "image") return "Image"
  if (block.type === "resource_link") return block.title ?? block.name ?? "Resource"
  return block.resource?.uri ?? "Resource"
}

const blockPreview = (block: Block): string | undefined => {
  if (block.type === "image" && block.data && block.mimeType) {
    return `data:${block.mimeType};base64,${block.data}`
  }
  const thumbnail = block._meta?.["openai/thumbnail"] as { src?: unknown } | undefined
  return typeof thumbnail?.src === "string" &&
    (thumbnail.src.startsWith("https:") || thumbnail.src.startsWith("data:image/"))
    ? thumbnail.src
    : undefined
}

/**
 * App model context as removable composer attachments. Blocks meant only for the assistant are
 * sent without being shown, as the extensions specification asks.
 */
export function ExtensionContextAttachments({ threadId }: Readonly<{ threadId: string }>) {
  const { i18n } = useLingui()
  const entries = useModelContext(threadId)
  const items = entries.flatMap((entry) =>
    (entry.content as Block[]).flatMap((block, index) => {
      const audience = block.annotations?.audience
      if (audience && !audience.includes("user")) return []
      const previewUrl = blockPreview(block)
      return [
        {
          detail: entry.title,
          id: JSON.stringify([entry.key, index]),
          kind: "context" as const,
          name: blockName(block),
          ...(previewUrl ? { previewUrl } : {}),
        },
      ]
    })
  )
  if (items.length === 0) return null
  return (
    <ChatComposerHeader>
      <ChatComposerAttachmentList
        aria-label={i18n._(msg({ id: "extension.context.label", message: "App context" }))}
        items={items}
        removeLabel={(item) =>
          `${i18n._(msg({ id: "common.remove", message: "Remove" }))} ${item.name}`
        }
        onRemove={(id) => {
          const [key, index] = JSON.parse(id) as [string, number]
          void ensureCypheriaClient().then((client) =>
            client.extensions.context.remove({ index, key, threadId })
          )
        }}
      />
    </ChatComposerHeader>
  )
}
