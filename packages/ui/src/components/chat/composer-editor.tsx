import { type JSONContent, Node } from "@tiptap/core"
import { Placeholder } from "@tiptap/extension-placeholder"
import { PluginKey } from "@tiptap/pm/state"
import { EditorContent, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion"
import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react"

import { cn } from "#lib/utils"

export type ChatComposerMentionKind =
  | "file"
  | "agent"
  | "skill"
  | "app"
  | "plugin"
  | "resource"
  | "browser-tab"

export type ChatComposerSuggestion = {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  kind: ChatComposerMentionKind | "command"
  /** A path or URI, not the contents of the referenced resource. */
  target?: string
}

export type ChatComposerDocument = JSONContent

const nodeNameByKind: Record<ChatComposerMentionKind, string> = {
  file: "fileMention",
  agent: "agentMention",
  skill: "skillMention",
  app: "appMention",
  plugin: "pluginMention",
  resource: "resourceMention",
  "browser-tab": "browserTabMention",
}

const kindByNodeName = Object.fromEntries(
  Object.entries(nodeNameByKind).map(([kind, name]) => [name, kind])
) as Record<string, ChatComposerMentionKind>

function mentionNode(kind: ChatComposerMentionKind) {
  const name = nodeNameByKind[kind]
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    addAttributes() {
      return {
        id: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-id") ?? "",
        },
        label: {
          default: "",
          parseHTML: (element: HTMLElement) => element.textContent?.replace(/^[@$]/, "") ?? "",
        },
        target: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-target") ?? "",
        },
      }
    },
    parseHTML() {
      return [{ tag: `span[data-chat-mention="${kind}"]` }]
    },
    renderHTML({ node }) {
      return [
        "span",
        {
          "data-chat-mention": kind,
          "data-id": node.attrs.id,
          "data-target": node.attrs.target,
          class:
            "inline-flex max-w-full items-baseline rounded-md bg-primary/8 px-1.5 py-0.5 text-primary align-baseline",
          contenteditable: "false",
        },
        `${kind === "skill" || kind === "app" ? "$" : "@"}${node.attrs.label}`,
      ]
    },
    renderText({ node }) {
      return `${kind === "skill" || kind === "app" ? "$" : "@"}${node.attrs.label}`
    },
  })
}

export function createChatComposerDocument(text: string): ChatComposerDocument {
  const inline = (line: string): JSONContent[] => {
    const content: JSONContent[] = []
    const links = /\[([^\]]+)\]\(([^)]+)\)/gu
    let cursor = 0
    for (const match of line.matchAll(links)) {
      const start = match.index ?? cursor
      if (start > cursor) content.push({ type: "text", text: line.slice(cursor, start) })
      const label = match[1] ?? ""
      const target = match[2] ?? ""
      let kind: ChatComposerMentionKind | null = null
      if (/^https?:\/\//u.test(target)) kind = null
      else if (label.startsWith("$")) kind = target.startsWith("app://") ? "app" : "skill"
      else if (label.startsWith("@")) {
        kind = target.startsWith("agent://")
          ? "agent"
          : target.startsWith("mcp://")
            ? "resource"
            : target.startsWith("browser://")
              ? "browser-tab"
              : target.startsWith("plugin://")
                ? "plugin"
                : "file"
      }
      content.push(
        kind
          ? {
              type: nodeNameByKind[kind],
              attrs: { id: target, label: label.slice(1), target },
            }
          : { type: "text", text: label, marks: [{ type: "link", attrs: { href: target } }] }
      )
      cursor = start + match[0].length
    }
    if (cursor < line.length) content.push({ type: "text", text: line.slice(cursor) })
    return content
  }
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? inline(line) : undefined,
    })),
  }
}

function serializeInline(node: JSONContent): string {
  if (node.type === "text") {
    let text = node.text ?? ""
    for (const mark of node.marks ?? []) {
      if (mark.type === "link" && typeof mark.attrs?.href === "string") {
        text = `[${text}](${mark.attrs.href})`
      } else if (mark.type === "bold") text = `**${text}**`
      else if (mark.type === "italic") text = `*${text}*`
      else if (mark.type === "code") text = `\`${text}\``
    }
    return text
  }
  const kind = kindByNodeName[node.type ?? ""]
  if (kind) {
    const label = String(node.attrs?.label ?? "")
    const target = String(node.attrs?.target ?? "")
    const prefix = kind === "skill" || kind === "app" ? "$" : "@"
    return target ? `[${prefix}${label}](${target})` : `${prefix}${label}`
  }
  if (node.type === "hardBreak") return "\n"
  return (node.content ?? []).map(serializeInline).join("")
}

export function serializeChatComposerDocument(document: ChatComposerDocument): string {
  function block(node: JSONContent): string {
    if (node.type === "codeBlock") {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : ""
      return `\`\`\`${language}\n${(node.content ?? []).map(serializeInline).join("")}\n\`\`\``
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      return (node.content ?? [])
        .map(
          (item, index) =>
            `${node.type === "bulletList" ? "-" : `${index + 1}.`} ${(item.content ?? []).map(block).join("\n")}`
        )
        .join("\n")
    }
    return (node.content ?? []).map(serializeInline).join("")
  }
  return (document.content ?? []).map(block).join("\n")
}

type ActiveSuggestion = {
  trigger: "@" | "$" | "/"
  items: ChatComposerSuggestion[]
  command: (item: ChatComposerSuggestion) => void
  rect: DOMRect | null
}

export type ChatComposerEditorProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "aria-label"
> & {
  "aria-label": string
  value: string
  initialDocument?: ChatComposerDocument
  placeholder?: string
  disabled?: boolean
  plainTextMode?: boolean
  submitOnEnter?: boolean
  suggestions?: ChatComposerSuggestion[]
  onChange: (value: string, document: ChatComposerDocument) => void
  onSubmit?: () => void
  onAlternateSubmit?: () => void
  onCommand?: (id: string) => void
  onPasteFiles?: (files: File[]) => void
  onPasteLongText?: (text: string) => void
  longTextThreshold?: number
}

export function ChatComposerEditor({
  value,
  initialDocument,
  placeholder = "",
  disabled = false,
  plainTextMode = false,
  submitOnEnter = true,
  suggestions = [],
  onChange,
  onSubmit,
  onAlternateSubmit,
  onCommand,
  onPasteFiles,
  onPasteLongText,
  longTextThreshold = 5_000,
  className,
  ...props
}: ChatComposerEditorProps) {
  const callbacks = useRef({
    onChange,
    onSubmit,
    onAlternateSubmit,
    onCommand,
    onPasteFiles,
    onPasteLongText,
  })
  callbacks.current = {
    onChange,
    onSubmit,
    onAlternateSubmit,
    onCommand,
    onPasteFiles,
    onPasteLongText,
  }
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions
  const valueRef = useRef(value)
  valueRef.current = value
  const placeholderRef = useRef(placeholder)
  placeholderRef.current = placeholder
  const submitOnEnterRef = useRef(submitOnEnter)
  submitOnEnterRef.current = submitOnEnter
  const plainTextModeRef = useRef(plainTextMode)
  plainTextModeRef.current = plainTextMode
  const longTextThresholdRef = useRef(longTextThreshold)
  longTextThresholdRef.current = longTextThreshold
  const menuRef = useRef<ActiveSuggestion | null>(null)
  const [menu, setMenu] = useState<ActiveSuggestion | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedIndexRef = useRef(0)
  const initializedDocument = useRef(initialDocument ?? createChatComposerDocument(value))

  const editor = useEditor(
    {
      immediatelyRender: false,
      content: initializedDocument.current,
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: () => placeholderRef.current }),
        ...Object.keys(nodeNameByKind).map((kind) => mentionNode(kind as ChatComposerMentionKind)),
        Node.create({
          name: "chatComposerSuggestions",
          addProseMirrorPlugins() {
            return (["@", "$", "/"] as const).map((trigger) =>
              Suggestion<ChatComposerSuggestion, ChatComposerSuggestion>({
                editor: this.editor,
                char: trigger,
                pluginKey: new PluginKey(`chat-composer-${trigger.charCodeAt(0)}`),
                items: ({ query }) => {
                  const allowed =
                    trigger === "$"
                      ? ["skill", "app"]
                      : trigger === "/"
                        ? ["command"]
                        : ["file", "agent", "plugin", "resource", "browser-tab"]
                  return suggestionsRef.current
                    .filter((item) => allowed.includes(item.kind))
                    .filter((item) =>
                      `${item.label} ${item.description ?? ""}`
                        .toLowerCase()
                        .includes(query.toLowerCase())
                    )
                    .slice(0, 12)
                },
                command: ({ editor, range, props: item }) => {
                  if (item.kind === "command") {
                    editor.chain().focus().deleteRange(range).run()
                    callbacks.current.onCommand?.(item.id)
                  } else {
                    editor
                      .chain()
                      .focus()
                      .insertContentAt(range, [
                        {
                          type: nodeNameByKind[item.kind],
                          attrs: { id: item.id, label: item.label, target: item.target ?? "" },
                        },
                        { type: "text", text: " " },
                      ])
                      .run()
                  }
                },
                render: () => {
                  const update = (props: SuggestionProps<ChatComposerSuggestion>) => {
                    const next = {
                      trigger,
                      items: props.items,
                      command: props.command,
                      rect: props.clientRect?.() ?? null,
                    }
                    menuRef.current = next
                    selectedIndexRef.current = 0
                    setSelectedIndex(0)
                    setMenu(next)
                  }
                  return {
                    onStart: update,
                    onUpdate: update,
                    onExit: () => {
                      menuRef.current = null
                      setMenu(null)
                    },
                    onKeyDown: ({ event }) => {
                      const active = menuRef.current
                      if (!active) return false
                      if (event.key === "Escape") {
                        menuRef.current = null
                        setMenu(null)
                        return true
                      }
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        const count = active.items.length
                        if (count) {
                          const next =
                            (selectedIndexRef.current +
                              (event.key === "ArrowDown" ? 1 : -1) +
                              count) %
                            count
                          selectedIndexRef.current = next
                          setSelectedIndex(next)
                        }
                        return true
                      }
                      if (event.key === "Enter" && active.items.length) {
                        const selected = active.items[selectedIndexRef.current]
                        if (selected) active.command(selected)
                        return true
                      }
                      return false
                    },
                  }
                },
              })
            )
          },
        }),
      ],
      editorProps: {
        attributes: {
          "aria-label": props["aria-label"],
          "aria-multiline": "true",
          role: "textbox",
          class:
            "min-h-12 max-h-48 overflow-y-auto outline-none text-[15px] leading-6 [&_p]:my-0 [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_pre]:my-2 [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-2",
        },
        handleKeyDown: (_view, event) => {
          if (event.key !== "Enter" || event.isComposing || menuRef.current?.items.length)
            return false
          if (
            event.shiftKey &&
            (event.metaKey || event.ctrlKey) &&
            callbacks.current.onAlternateSubmit
          ) {
            event.preventDefault()
            callbacks.current.onAlternateSubmit()
            return true
          }
          if (event.metaKey || event.ctrlKey || (submitOnEnterRef.current && !event.shiftKey)) {
            event.preventDefault()
            callbacks.current.onSubmit?.()
            return true
          }
          return false
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? [])
          if (files.length && callbacks.current.onPasteFiles) {
            event.preventDefault()
            callbacks.current.onPasteFiles(files)
            return true
          }
          const text = event.clipboardData?.getData("text/plain") ?? ""
          const selection = _view.state.selection
          if (
            !plainTextModeRef.current &&
            !selection.empty &&
            /^https?:\/\/\S+$/u.test(text.trim())
          ) {
            const link = _view.state.schema.marks.link
            if (link) {
              event.preventDefault()
              _view.dispatch(
                _view.state.tr.addMark(
                  selection.from,
                  selection.to,
                  link.create({ href: text.trim() })
                )
              )
              return true
            }
          }
          if (text.length >= longTextThresholdRef.current && callbacks.current.onPasteLongText) {
            event.preventDefault()
            callbacks.current.onPasteLongText(text)
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor }) => {
        const nextDocument = editor.getJSON()
        const nextValue = serializeChatComposerDocument(nextDocument)
        if (nextValue !== valueRef.current) callbacks.current.onChange(nextValue, nextDocument)
      },
    },
    []
  )

  useEffect(() => {
    editor?.view.dom.setAttribute("aria-label", props["aria-label"])
  }, [editor, props["aria-label"]])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor) return
    if (value !== serializeChatComposerDocument(editor.getJSON())) {
      editor.commands.setContent(createChatComposerDocument(value), { emitUpdate: false })
    }
  }, [editor, value])

  return (
    <div
      data-slot="chat-composer-editor"
      data-state={disabled ? "disabled" : "ready"}
      className={cn("relative min-w-0", className)}
      {...props}
    >
      <EditorContent editor={editor} />
      {menu?.items.length ? (
        <div
          aria-label={`${menu.trigger} suggestions`}
          className="fixed z-50 max-h-64 w-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
          data-slot="chat-composer-suggestions"
          role="listbox"
          style={{
            left: Math.min(menu.rect?.left ?? 0, Math.max(0, window.innerWidth - 300)),
            top: menu.rect
              ? window.innerHeight - menu.rect.bottom < Math.min(menu.items.length * 36 + 8, 256)
                ? Math.max(8, menu.rect.top - Math.min(menu.items.length * 36 + 8, 256) - 6)
                : menu.rect.bottom + 6
              : 0,
          }}
        >
          {menu.items.map((item, index) => (
            <div
              key={`${item.kind}:${item.id}`}
              aria-selected={index === selectedIndex}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm aria-selected:bg-accent"
              data-slot="chat-composer-suggestion"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => menu.command(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  menu.command(item)
                }
              }}
              role="option"
              tabIndex={0}
            >
              {item.icon ? <span className="shrink-0 [&_svg]:size-4">{item.icon}</span> : null}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.description ? (
                <span className="max-w-28 truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
