import { type HTMLAttributes, type ReactNode, useState } from "react"

import { Button } from "#components/button"
import { cn } from "#lib/utils"
import { CloseBoldIcon, FileIcon, FileImageIcon, WarningIcon } from "../icons/index.js"

export type ChatComposerAttachmentItem = {
  id: string
  kind: "image" | "file" | "pasted-text" | "appshot" | "context"
  name: string
  detail?: string
  previewUrl?: string
  icon?: ReactNode
  status?: "ready" | "uploading" | "error"
}

export type ChatComposerAttachmentListProps = Omit<HTMLAttributes<HTMLUListElement>, "onChange"> & {
  items: ChatComposerAttachmentItem[]
  removeLabel: (item: ChatComposerAttachmentItem) => string
  openLabel?: (item: ChatComposerAttachmentItem) => string
  onRemove: (id: string) => void
  onOpen?: (id: string) => void
  onReorder?: (ids: string[]) => void
  uploadingLabel?: string
  errorLabel?: string
}

/** Controlled visual tray. Files, upload progress, and persistence remain caller-owned. */
export function ChatComposerAttachmentList({
  items,
  removeLabel,
  openLabel,
  onRemove,
  onOpen,
  onReorder,
  uploadingLabel,
  errorLabel,
  className,
  ...props
}: ChatComposerAttachmentListProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  if (!items.length) return null

  const move = (sourceId: string, targetId: string) => {
    if (!onReorder || sourceId === targetId) return
    const ids = items.map((item) => item.id)
    const source = ids.indexOf(sourceId)
    const target = ids.indexOf(targetId)
    if (source < 0 || target < 0) return
    ids.splice(source, 1)
    ids.splice(target, 0, sourceId)
    onReorder(ids)
  }

  return (
    <ul
      aria-label={props["aria-label"]}
      className={cn("flex min-w-0 list-none gap-2 overflow-x-auto py-1", className)}
      data-slot="chat-composer-attachment-list"
      {...props}
    >
      {items.map((item, index) => (
        <li
          key={item.id}
          className={cn(
            "group relative flex h-14 max-w-64 min-w-36 shrink-0 items-center gap-2 rounded-xl border bg-muted/25 p-1.5 pe-7 text-xs",
            draggedId === item.id && "opacity-50"
          )}
          data-kind={item.kind}
          data-slot="chat-composer-attachment-item"
          data-state={item.status ?? "ready"}
          draggable={Boolean(onReorder)}
          onDragStart={(event) => {
            setDraggedId(item.id)
            event.dataTransfer.effectAllowed = "move"
            event.dataTransfer.setData("text/plain", item.id)
          }}
          onDragEnd={() => setDraggedId(null)}
          onDragOver={(event) => {
            if (draggedId) event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            move(draggedId ?? event.dataTransfer.getData("text/plain"), item.id)
            setDraggedId(null)
          }}
          onKeyDown={(event) => {
            if (!event.altKey || !onReorder) return
            if (event.key === "ArrowLeft" && index > 0) {
              event.preventDefault()
              const previous = items[index - 1]
              if (previous) move(item.id, previous.id)
            } else if (event.key === "ArrowRight" && index < items.length - 1) {
              event.preventDefault()
              const next = items[index + 1]
              if (next) move(item.id, next.id)
            }
          }}
          tabIndex={onReorder ? 0 : undefined}
        >
          <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground [&_img]:size-full [&_img]:object-cover [&_svg]:size-4">
            {item.previewUrl ? (
              <img alt="" src={item.previewUrl} />
            ) : (
              (item.icon ??
              (item.kind === "image" || item.kind === "appshot" ? <FileImageIcon /> : <FileIcon />))
            )}
          </span>
          <span className="min-w-0 flex-1">
            {onOpen ? (
              <button
                aria-label={openLabel?.(item) ?? item.name}
                className="block max-w-full truncate text-start font-medium hover:underline"
                onClick={() => onOpen(item.id)}
                type="button"
              >
                {item.name}
              </button>
            ) : (
              <span className="block truncate font-medium">{item.name}</span>
            )}
            <span className="mt-0.5 flex items-center gap-1 truncate text-muted-foreground">
              {item.status === "uploading" ? (
                <span
                  aria-hidden="true"
                  className="size-2.5 animate-spin rounded-full border border-current border-r-transparent"
                />
              ) : null}
              {item.status === "error" ? (
                <WarningIcon aria-hidden="true" className="size-3 text-destructive" />
              ) : null}
              {item.status === "uploading"
                ? uploadingLabel
                : item.status === "error"
                  ? errorLabel
                  : item.detail}
            </span>
          </span>
          <Button
            aria-label={removeLabel(item)}
            className="absolute top-1 end-1 size-5 rounded-full opacity-75 group-hover:opacity-100"
            onClick={() => onRemove(item.id)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <CloseBoldIcon />
          </Button>
          {onReorder ? (
            <span className="sr-only">
              {index + 1} / {items.length}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
