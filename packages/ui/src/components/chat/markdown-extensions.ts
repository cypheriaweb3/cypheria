import type { Image, Link, Root } from "mdast"
import { visit } from "unist-util-visit"

/**
 * Markdown extensions an Agent's reply may use.
 *
 * Streamdown hardens every link and image, which blocks file paths and custom schemes, so these
 * plugins run first and turn each reference into a custom element that the renderer maps to a
 * component: `cypheria-path-link`, `cypheria-path-media`, `cypheria-code-comment`,
 * `cypheria-followup`, and `cypheria-created-thread`. The directive names and attributes are the
 * ones the Codex desktop teaches the model.
 */

export const CHAT_PATH_LINK_TAG = "cypheria-path-link"
export const CHAT_PATH_MEDIA_TAG = "cypheria-path-media"
export const CHAT_DEEP_LINK_TAG = "cypheria-deep-link"
export const CHAT_CODE_COMMENT_TAG = "cypheria-code-comment"
export const CHAT_FOLLOWUP_TAG = "cypheria-followup"
export const CHAT_CREATED_THREAD_TAG = "cypheria-created-thread"

/** Attribute names (as HTML sees them) each custom element may carry through sanitization. */
export const CHAT_ALLOWED_TAGS: Readonly<Record<string, string[]>> = {
  [CHAT_CODE_COMMENT_TAG]: [
    "dataBody",
    "dataEnd",
    "dataFile",
    "dataPriority",
    "dataStart",
    "dataTitle",
  ],
  [CHAT_CREATED_THREAD_TAG]: ["dataClientThreadId", "dataThreadId"],
  [CHAT_DEEP_LINK_TAG]: ["dataTarget"],
  [CHAT_FOLLOWUP_TAG]: ["dataPrompt"],
  [CHAT_PATH_LINK_TAG]: ["dataTarget"],
  [CHAT_PATH_MEDIA_TAG]: ["dataAlt", "dataTarget"],
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/u
const DEEP_LINK_SCHEME = "cypheria:"

export type ChatLinkKind = "deep-link" | "external" | "path"

/** Tells a file reference from a web link, a fragment, or a deep link. */
export function classifyChatLink(url: string): ChatLinkKind {
  const value = url.trim()
  if (!value || value.startsWith("#") || value.startsWith("?") || value.startsWith("//")) {
    return "external"
  }
  if (WINDOWS_DRIVE.test(value) || value.startsWith("file:")) return "path"
  if (value.toLowerCase().startsWith(DEEP_LINK_SCHEME)) return "deep-link"
  return SCHEME.test(value) ? "external" : "path"
}

const mediaExtensions = {
  audio: ["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav"],
  image: ["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"],
  video: ["m4v", "mov", "mp4", "ogv", "webm"],
} as const

/** The media element a file name suggests; the Server's MIME type decides once it is resolved. */
export function chatMediaKindFor(path: string): "audio" | "image" | "video" | null {
  const extension = path.split(/[?#]/u)[0]?.toLowerCase().split(".").at(-1) ?? ""
  for (const [kind, extensions] of Object.entries(mediaExtensions)) {
    if ((extensions as readonly string[]).includes(extension)) {
      return kind as "audio" | "image" | "video"
    }
  }
  return null
}

type Directive = {
  attributes?: Record<string, string | null | undefined>
  children?: unknown[]
  data?: Record<string, unknown>
  name: string
  position?: { end: { offset?: number }; start: { offset?: number } }
  type: "containerDirective" | "leafDirective" | "textDirective"
}

const props = (values: Record<string, string | null | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string"))

/** Link and image references to files and deep links. Runs before the directive plugin. */
export function remarkChatReferences() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type !== "link" && node.type !== "image") return
      const reference = node as Link | Image
      const kind = classifyChatLink(reference.url)
      if (kind === "external") return
      reference.data ??= {}
      const data = reference.data
      if (reference.type === "image") {
        data.hName = CHAT_PATH_MEDIA_TAG
        data.hProperties = props({ dataAlt: reference.alt, dataTarget: reference.url })
        return
      }
      data.hName = kind === "deep-link" ? CHAT_DEEP_LINK_TAG : CHAT_PATH_LINK_TAG
      data.hProperties = { dataTarget: reference.url }
    })
  }
}

/**
 * `::code-comment{…}`, `:codex-followup[…]{…}`, and `::created-thread{…}`. Any other directive is
 * ordinary prose that happened to look like one (`:smile`, `a:b`), so its source text is restored.
 */
export function remarkChatDirectives() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : null
    visit(tree, (node, index, parent) => {
      if (
        node.type !== "textDirective" &&
        node.type !== "leafDirective" &&
        node.type !== "containerDirective"
      ) {
        return
      }
      const directive = node as unknown as Directive
      const attributes = directive.attributes ?? {}
      directive.data ??= {}
      const data = directive.data
      if (directive.type === "leafDirective" && directive.name === "code-comment") {
        data.hName = CHAT_CODE_COMMENT_TAG
        data.hProperties = props({
          dataBody: attributes.body,
          dataEnd: attributes.end,
          dataFile: attributes.file,
          dataPriority: attributes.priority,
          dataStart: attributes.start,
          dataTitle: attributes.title,
        })
        directive.children = []
        return
      }
      if (directive.type === "textDirective" && directive.name === "codex-followup") {
        data.hName = CHAT_FOLLOWUP_TAG
        data.hProperties = props({ dataPrompt: attributes.prompt })
        return
      }
      if (directive.type === "leafDirective" && directive.name === "created-thread") {
        data.hName = CHAT_CREATED_THREAD_TAG
        data.hProperties = props({
          dataClientThreadId: attributes.clientThreadId,
          dataThreadId: attributes.threadId,
        })
        directive.children = []
        return
      }
      const start = directive.position?.start.offset
      const end = directive.position?.end.offset
      if (
        source === null ||
        start === undefined ||
        end === undefined ||
        !parent ||
        index === undefined
      ) {
        return
      }
      const restored = source.slice(start, end)
      ;(parent.children as unknown[])[index] =
        directive.type === "textDirective"
          ? { type: "text", value: restored }
          : { children: [{ type: "text", value: restored }], type: "paragraph" }
    })
  }
}

/** The bare, `#L`, or `:` line reference a code comment carries. */
export function chatLineNumber(value: string | undefined): number | undefined {
  const line = Number(value)
  return Number.isInteger(line) && line > 0 ? line : undefined
}
