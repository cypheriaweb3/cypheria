import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react"
import { cn } from "#lib/utils"
import { ChevronRightIcon } from "../icons/index.js"

export type ChatSummaryMode = "overlay" | "shift" | "gutter"

export function ChatSummarySurface({
  className,
  mode = "overlay",
  open,
  pinned,
  ...props
}: HTMLAttributes<HTMLElement> & { mode?: ChatSummaryMode; open: boolean; pinned: boolean }) {
  return (
    <aside
      aria-hidden={!open}
      data-mode={mode}
      data-open={open}
      data-pinned={pinned}
      data-slot="chat-summary-surface"
      inert={!open}
      className={cn(
        "absolute inset-y-3 right-3 z-30 flex w-[min(300px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border bg-background shadow-lg transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-4 opacity-0",
        pinned && mode !== "overlay" && "shadow-none",
        className
      )}
      {...props}
    />
  )
}

export function ChatSummaryHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header
      data-slot="chat-summary-header"
      className={cn(
        "flex min-h-10 items-center gap-1 border-b px-3 text-sm font-medium",
        className
      )}
      {...props}
    />
  )
}

export function ChatSummaryBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-summary-body"
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-2", className)}
      {...props}
    />
  )
}

export function ChatSummaryGroup({
  children,
  className,
  count,
  expanded,
  onExpandedChange,
  title,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  count: number
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  title: ReactNode
}) {
  return (
    <section
      data-slot="chat-summary-group"
      data-state={expanded ? "open" : "closed"}
      className={cn("py-0.5", className)}
      {...props}
    >
      <button
        aria-expanded={expanded}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => onExpandedChange(!expanded)}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 transition-transform motion-reduce:transition-none",
            expanded && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="tabular-nums">{count}</span>
      </button>
      {expanded ? (
        <div data-slot="chat-summary-group-content" className="space-y-0.5 px-1">
          {children}
        </div>
      ) : null}
    </section>
  )
}

export function ChatSummaryRow({
  children,
  className,
  detail,
  status,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { detail?: ReactNode; status?: ReactNode }) {
  return (
    <button
      data-slot="chat-summary-row"
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        className
      )}
      type="button"
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail ? (
        <span className="max-w-20 shrink-0 truncate text-xs text-muted-foreground">{detail}</span>
      ) : null}
      {status ? <span className="shrink-0 text-xs text-muted-foreground">{status}</span> : null}
    </button>
  )
}

export function ChatSummaryStaticRow({
  children,
  className,
  detail,
  status,
  ...props
}: HTMLAttributes<HTMLDivElement> & { detail?: ReactNode; status?: ReactNode }) {
  return (
    <div
      data-slot="chat-summary-static-row"
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail ? (
        <span className="max-w-20 shrink-0 truncate text-xs text-muted-foreground">{detail}</span>
      ) : null}
      {status ? <span className="shrink-0 text-xs text-muted-foreground">{status}</span> : null}
    </div>
  )
}

export function ChatSummaryMessage({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="chat-summary-message"
      className={cn("px-2 py-2 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export function ChatSummaryMore({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      data-slot="chat-summary-more"
      className={cn(
        "rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
        className
      )}
      type="button"
      {...props}
    />
  )
}
