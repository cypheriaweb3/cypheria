import { type ReactNode, useMemo, useState } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#components/table"
import { cn } from "#lib/utils"

import { chatFileBaseName } from "./file-paths.js"
import { ChatMessageContent } from "./message-content.js"

export type ChatFilePreviewKind = "image" | "markdown" | "svg" | "table"

const previewKindsByExtension: Record<string, ChatFilePreviewKind> = {
  avif: "image",
  bmp: "image",
  csv: "table",
  gif: "image",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  png: "image",
  svg: "svg",
  tsv: "table",
  webp: "image",
}

export function chatFilePreviewKind(path: string): ChatFilePreviewKind | null {
  const extension = chatFileBaseName(path).split(".").at(-1)?.toLowerCase()
  if (!extension || !chatFileBaseName(path).includes(".")) return null
  return previewKindsByExtension[extension] ?? null
}

/** Raster images have no meaningful source view; every other preview kind also has one. */
export const chatFilePreviewHasSource = (kind: ChatFilePreviewKind | null): boolean =>
  kind !== "image"

/** Removes a leading YAML frontmatter block, which Markdown and MDX tooling treat as metadata. */
export function stripChatFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  return match ? text.slice(match[0].length).replace(/^\s*\n/, "") : text
}

/**
 * Parses RFC 4180-style delimited text: quoted fields may contain delimiters, doubled quotes,
 * and line breaks. A trailing line break does not produce an empty row.
 */
export function parseChatDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field === "") quoted = true
    else if (character === delimiter) {
      row.push(field)
      field = ""
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += character
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface ChatFilePreviewLabels {
  readonly previewUnavailable: string
  readonly tableTruncated: (shown: number, total: number) => string
}

type ChatFilePreviewProps = {
  contents?: string
  kind: ChatFilePreviewKind
  labels: ChatFilePreviewLabels
  path: string
  url?: string
  /** Rows rendered for a delimited file before the table is truncated. */
  maxTableRows?: number
}

export function ChatFilePreview({
  contents,
  kind,
  labels,
  maxTableRows = 1000,
  path,
  url,
}: ChatFilePreviewProps) {
  switch (kind) {
    case "markdown":
      return contents === undefined ? (
        <ChatFilePreviewUnavailable>{labels.previewUnavailable}</ChatFilePreviewUnavailable>
      ) : (
        <div
          data-slot="chat-file-preview"
          data-kind={kind}
          className="min-h-0 flex-1 overflow-auto"
        >
          <ChatMessageContent className="mx-auto max-w-3xl px-6 py-5">
            {stripChatFrontmatter(contents)}
          </ChatMessageContent>
        </div>
      )
    case "image":
    case "svg": {
      // SVG renders through <img>, so its scripts and external references never execute.
      const source =
        url ??
        (kind === "svg" && contents !== undefined
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(contents)}`
          : undefined)
      return source ? (
        <ChatImagePreview alt={chatFileBaseName(path)} kind={kind} src={source} />
      ) : (
        <ChatFilePreviewUnavailable>{labels.previewUnavailable}</ChatFilePreviewUnavailable>
      )
    }
    case "table":
      return contents === undefined ? (
        <ChatFilePreviewUnavailable>{labels.previewUnavailable}</ChatFilePreviewUnavailable>
      ) : (
        <ChatTablePreview
          contents={contents}
          delimiter={path.toLowerCase().endsWith(".tsv") ? "\t" : ","}
          labels={labels}
          maxRows={maxTableRows}
        />
      )
  }
}

function ChatFilePreviewUnavailable({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ChatImagePreview({ alt, kind, src }: { alt: string; kind: "image" | "svg"; src: string }) {
  const [size, setSize] = useState<{ height: number; width: number } | null>(null)
  return (
    <div
      data-slot="chat-file-preview"
      data-kind={kind}
      className="flex min-h-0 flex-1 flex-col overflow-auto"
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center p-6",
          // A quiet checkerboard exposes transparency without competing with the image.
          "bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)] bg-size-[16px_16px]"
        )}
      >
        <img
          alt={alt}
          className="max-h-full max-w-full object-contain"
          onLoad={(event) =>
            setSize({
              height: event.currentTarget.naturalHeight,
              width: event.currentTarget.naturalWidth,
            })
          }
          src={src}
        />
      </div>
      {size && (
        <div className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
          {size.width} × {size.height}
        </div>
      )}
    </div>
  )
}

function ChatTablePreview({
  contents,
  delimiter,
  labels,
  maxRows,
}: {
  contents: string
  delimiter: string
  labels: ChatFilePreviewLabels
  maxRows: number
}) {
  const rows = useMemo(() => parseChatDelimitedText(contents, delimiter), [contents, delimiter])
  const [header = [], ...body] = rows
  const columnCount = Math.max(header.length, ...body.map((row) => row.length))
  const shown = body.slice(0, maxRows)
  const columns = Array.from({ length: columnCount }, (_, index) => index)
  return (
    <div data-slot="chat-file-preview" data-kind="table" className="min-h-0 flex-1 overflow-auto">
      <Table className="text-xs">
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead className="w-10 text-right text-muted-foreground">#</TableHead>
            {columns.map((column) => (
              <TableHead key={column}>{header[column] ?? ""}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row, rowIndex) => (
            // Delimited rows have no identity beyond their position.
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            <TableRow key={rowIndex}>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {rowIndex + 1}
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column} className="max-w-80 truncate" title={row[column]}>
                  {row[column] ?? ""}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {body.length > shown.length && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          {labels.tableTruncated(shown.length, body.length)}
        </div>
      )}
    </div>
  )
}
