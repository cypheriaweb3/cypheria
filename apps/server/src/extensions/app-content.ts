import type { ExtensionModelContext, ThreadInputBlock } from "@cypheria/protocol"
import { z } from "zod"
import type { UntrustedAppInput } from "../thread/harness-adapter.js"

/**
 * The content blocks MCP Apps send with `ui/update-model-context` and `ui/message`: text, image,
 * resource link, and embedded resource. Audio is not supported, as in ChatGPT.
 */
const meta = z.record(z.string(), z.unknown()).optional()
const annotations = z
  .object({ audience: z.array(z.string()).optional() })
  .passthrough()
  .optional()

export const AppContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ _meta: meta, annotations, text: z.string(), type: z.literal("text") }).passthrough(),
  z
    .object({
      _meta: meta,
      annotations,
      data: z.string().min(1),
      mimeType: z.string().startsWith("image/"),
      type: z.literal("image"),
    })
    .passthrough(),
  z
    .object({
      _meta: meta,
      annotations,
      description: z.string().optional(),
      mimeType: z.string().optional(),
      name: z.string(),
      title: z.string().optional(),
      type: z.literal("resource_link"),
      uri: z.string().min(1),
    })
    .passthrough(),
  z
    .object({
      _meta: meta,
      annotations,
      resource: z.union([
        z.object({ mimeType: z.string().optional(), text: z.string(), uri: z.string().min(1) }),
        z.object({ blob: z.string(), mimeType: z.string().optional(), uri: z.string().min(1) }),
      ]),
      type: z.literal("resource"),
    })
    .passthrough(),
])
export type AppContentBlock = z.infer<typeof AppContentBlockSchema>

/** How much model context or message content one App may send at once. */
export const MAX_APP_CONTENT_BYTES = 512 * 1024

export const parseAppContent = (value: unknown): AppContentBlock[] => {
  const blocks = z
    .array(AppContentBlockSchema)
    .max(64)
    .safeParse(value ?? [])
  if (!blocks.success) {
    throw new Error("Apps may send text, image, resource link, and embedded resource blocks only")
  }
  if (Buffer.byteLength(JSON.stringify(blocks.data)) > MAX_APP_CONTENT_BYTES) {
    throw new Error("The App sent more content than Cypheria accepts at once")
  }
  return blocks.data
}

/**
 * App content as Thread input. Block `_meta` never reaches the model; images stay images, and
 * everything else becomes text the Agent can read.
 */
export const appContentToInput = (blocks: readonly AppContentBlock[]): ThreadInputBlock[] =>
  blocks.flatMap((block): ThreadInputBlock[] => {
    switch (block.type) {
      case "text":
        return [{ text: block.text, type: "text" }]
      case "image":
        return [{ data: block.data, mimeType: block.mimeType, type: "image" }]
      case "resource_link":
        return [
          {
            text: `${block.title ?? block.name} <${block.uri}>${block.description ? `: ${block.description}` : ""}`,
            type: "text",
          },
        ]
      case "resource": {
        const { resource } = block
        if ("text" in resource) {
          return [{ text: `Resource ${resource.uri}:\n${resource.text}`, type: "text" }]
        }
        if (resource.mimeType?.startsWith("image/")) {
          return [{ data: resource.blob, mimeType: resource.mimeType, type: "image" }]
        }
        return [
          {
            text: `Resource ${resource.uri} (${resource.mimeType ?? "binary"}) is not readable as text.`,
            type: "text",
          },
        ]
      }
      default:
        return []
    }
  })

/** App content as one `untrusted_input` item: its text, structured content, and images apart. */
export const untrustedAppInput = (input: {
  kind: UntrustedAppInput["kind"]
  sourceId: string
  server: string
  title: string
  content: readonly AppContentBlock[]
  structuredContent?: Record<string, unknown> | null
}): UntrustedAppInput => {
  const blocks = appContentToInput(input.content)
  return {
    images: blocks.flatMap((block) =>
      block.type === "image" ? [{ data: block.data, mimeType: block.mimeType }] : []
    ),
    kind: input.kind,
    server: input.server,
    source: "mcp_app",
    sourceId: input.sourceId,
    ...(input.structuredContent ? { structuredContent: input.structuredContent } : {}),
    text: blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
    title: input.title,
  }
}

/** Model context as `untrusted_input` items, one per App. */
export const modelContextToUntrusted = (
  entries: readonly ExtensionModelContext[]
): UntrustedAppInput[] =>
  entries.flatMap((entry) => {
    const content = parseAppContent(entry.content)
    if (content.length === 0 && !entry.structuredContent) return []
    return [
      untrustedAppInput({
        content,
        kind: "model_context",
        server: entry.server,
        sourceId: entry.key,
        structuredContent: entry.structuredContent,
        title: entry.title,
      }),
    ]
  })

/** Model context as the input of a Thread's next message, each App's context under its name. */
export const modelContextToInput = (
  entries: readonly ExtensionModelContext[]
): ThreadInputBlock[] =>
  entries.flatMap((entry) => {
    const blocks = parseAppContent(entry.content)
    const structured = entry.structuredContent
      ? [{ text: JSON.stringify(entry.structuredContent), type: "text" as const }]
      : []
    if (blocks.length === 0 && structured.length === 0) return []
    return [
      { text: `\nContext from ${entry.title}:\n`, type: "text" as const },
      ...appContentToInput(blocks),
      ...structured,
    ]
  })

/**
 * MCP App model context, per Thread and App. Each `ui/update-model-context` replaces that App's
 * entry; the next message in the Thread carries every entry and clears them.
 */
export class ModelContextStore {
  readonly #threads = new Map<string, Map<string, ExtensionModelContext>>()

  list(threadId: string): ExtensionModelContext[] {
    return [...(this.#threads.get(threadId)?.values() ?? [])]
  }

  get(threadId: string, key: string): ExtensionModelContext | null {
    return this.#threads.get(threadId)?.get(key) ?? null
  }

  /** Replaces an App's context; empty content removes it. */
  set(threadId: string, entry: ExtensionModelContext): void {
    const entries = this.#threads.get(threadId) ?? new Map<string, ExtensionModelContext>()
    if (entry.content.length === 0 && !entry.structuredContent) entries.delete(entry.key)
    else entries.set(entry.key, entry)
    if (entries.size > 0) this.#threads.set(threadId, entries)
    else this.#threads.delete(threadId)
  }

  /** Removes one block, or the App's whole context, and returns what remains. */
  remove(threadId: string, key: string, index?: number): ExtensionModelContext | null {
    const entry = this.get(threadId, key)
    if (!entry) return null
    if (index === undefined) {
      this.set(threadId, { ...entry, content: [], structuredContent: null })
      return null
    }
    const content = entry.content.filter((_, position) => position !== index)
    const next = { ...entry, content }
    this.set(threadId, next)
    return content.length > 0 || next.structuredContent ? next : null
  }

  clear(threadId: string): ExtensionModelContext[] {
    const entries = this.list(threadId)
    this.#threads.delete(threadId)
    return entries
  }
}
