import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "#lib/utils"
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  ClockIcon,
  ErrorIcon,
  FileIcon,
  TerminalIcon,
} from "../icons/index.js"

import type { ChatActivityState } from "./types.js"

const activityIcon = (state: ChatActivityState) => {
  if (state === "completed") return <CheckCircleIcon />
  if (state === "error") return <ErrorIcon />
  if (state === "waiting") return <ClockIcon />
  if (state === "running") return <CircleDashedIcon className="animate-spin" />
  return <CircleIcon />
}

export function ChatActivityList({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      data-slot="chat-activity-list"
      className={cn("flex min-w-0 flex-col gap-3", className)}
      {...props}
    />
  )
}

type ChatActivityItemProps = HTMLAttributes<HTMLLIElement> & {
  title: ReactNode
  state: ChatActivityState
  stateLabel: ReactNode
  description?: ReactNode
  metadata?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}

export function ChatActivityItem({
  className,
  title,
  state,
  stateLabel,
  description,
  metadata,
  icon,
  actions,
  ...props
}: ChatActivityItemProps) {
  return (
    <li
      data-slot="chat-activity-item"
      data-state={state}
      className={cn("relative flex min-w-0 items-start gap-2.5 text-sm", className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5",
          "data-[state=completed]:text-emerald-600 data-[state=error]:text-destructive"
        )}
        data-state={state}
      >
        {icon ?? activityIcon(state)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{title}</span>
          {metadata && <span className="text-xs text-muted-foreground">{metadata}</span>}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <span className="sr-only">{stateLabel}</span>
      {actions}
    </li>
  )
}

type ChatCommandBlockProps = HTMLAttributes<HTMLElement> & {
  command: ReactNode
  state: ChatActivityState
  stateLabel: ReactNode
  title?: ReactNode
  duration?: ReactNode
  output?: ReactNode
  actions?: ReactNode
}

export function ChatCommandBlock({
  className,
  command,
  state,
  stateLabel,
  title,
  duration,
  output,
  actions,
  ...props
}: ChatCommandBlockProps) {
  return (
    <section
      data-slot="chat-command-block"
      data-state={state}
      className={cn("overflow-hidden rounded-xl border bg-muted/20 text-sm", className)}
      {...props}
    >
      <div className="flex min-h-9 min-w-0 items-center gap-2 border-b px-3 text-xs">
        <TerminalIcon className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {duration && <span className="shrink-0 text-muted-foreground">{duration}</span>}
        <span
          className="inline-flex shrink-0 items-center gap-1 text-muted-foreground data-[state=error]:text-destructive"
          data-state={state}
        >
          <span aria-hidden="true" className="[&_svg]:size-3">
            {activityIcon(state)}
          </span>
          {stateLabel}
        </span>
        {actions}
      </div>
      <div className="min-w-0 px-3 py-2 font-mono text-xs leading-relaxed">
        <div className="flex min-w-0 gap-2">
          <span aria-hidden="true" className="select-none text-muted-foreground">
            $
          </span>
          <code className="min-w-0 break-all text-foreground">{command}</code>
        </div>
        {output && (
          <div
            data-slot="chat-command-output"
            className="mt-2 whitespace-pre-wrap break-words border-t pt-2 text-muted-foreground"
          >
            {output}
          </div>
        )}
      </div>
    </section>
  )
}

type ChatFileChangesProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  summary?: ReactNode
  actions?: ReactNode
}

export function ChatFileChanges({
  className,
  title,
  summary,
  actions,
  children,
  ...props
}: ChatFileChangesProps) {
  return (
    <section
      data-slot="chat-file-changes"
      className={cn("overflow-hidden rounded-xl border bg-background text-sm", className)}
      {...props}
    >
      <div className="flex min-h-10 min-w-0 items-center gap-2 border-b px-3">
        <FileIcon className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {summary && <span className="shrink-0 text-xs text-muted-foreground">{summary}</span>}
        {actions}
      </div>
      <ul className="divide-y">{children}</ul>
    </section>
  )
}

type ChatFileChangeProps = HTMLAttributes<HTMLLIElement> & {
  path: ReactNode
  statusLabel: ReactNode
  additions?: number
  deletions?: number
  icon?: ReactNode
}

export function ChatFileChange({
  className,
  path,
  statusLabel,
  additions,
  deletions,
  icon,
  ...props
}: ChatFileChangeProps) {
  return (
    <li
      data-slot="chat-file-change"
      className={cn("flex min-w-0 items-center gap-2 px-3 py-2 text-xs", className)}
      {...props}
    >
      <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">
        {icon ?? <FileIcon />}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
      <span className="shrink-0 text-muted-foreground">{statusLabel}</span>
      {(additions !== undefined || deletions !== undefined) && (
        <span className="flex shrink-0 gap-1 font-mono tabular-nums">
          {additions !== undefined && <span className="text-emerald-600">+{additions}</span>}
          {deletions !== undefined && <span className="text-destructive">-{deletions}</span>}
        </span>
      )}
    </li>
  )
}

type ChatTurnNoticeProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  tone?: "neutral" | "info" | "success" | "warning" | "error"
  icon?: ReactNode
  actions?: ReactNode
}

export function ChatTurnNotice({
  className,
  title,
  tone = "neutral",
  icon,
  actions,
  children,
  ...props
}: ChatTurnNoticeProps) {
  return (
    <aside
      data-slot="chat-turn-notice"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-xl border bg-muted/25 px-3 py-2.5 text-sm",
        "data-[tone=error]:border-destructive/25 data-[tone=error]:bg-destructive/5",
        "data-[tone=success]:border-emerald-600/20 data-[tone=success]:bg-emerald-600/5",
        "data-[tone=warning]:border-amber-600/20 data-[tone=warning]:bg-amber-500/5",
        className
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        {children && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {children}
          </span>
        )}
      </span>
      {actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
    </aside>
  )
}

export type {
  ChatActivityItemProps,
  ChatCommandBlockProps,
  ChatFileChangeProps,
  ChatFileChangesProps,
  ChatTurnNoticeProps,
}
