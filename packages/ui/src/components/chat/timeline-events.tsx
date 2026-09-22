import type { HTMLAttributes, ReactNode } from "react"

import { Button } from "#components/button"
import { cn } from "#lib/utils"
import {
  AgentIcon,
  ArrowRightIcon,
  BoltIcon,
  BranchIcon,
  CalendarIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  ClockIcon,
  CollapseIcon,
  CompareIcon,
  ErrorIcon,
  FileIcon,
  GlobeIcon,
  ImageSquareIcon,
  InfoCircleIcon,
  LockIcon,
  McpIcon,
  MicIcon,
  PinIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  ToolsIcon,
  UserIcon,
  WebsiteNetworkIcon,
  WorkspaceIcon,
} from "../icons/index.js"

import type {
  ChatActivityState,
  ChatApprovalState,
  ChatResourceKind,
  ChatTimelineEventType,
  ChatTimelineTone,
} from "./types.js"

const eventIcon = (type: ChatTimelineEventType) => {
  if (type === "realtime-transcript") return <MicIcon />
  if (type === "exec") return <TerminalIcon />
  if (type === "patch" || type === "turn-diff") return <CompareIcon />
  if (type === "mcp-tool-call" || type === "mcp-server-elicitation") return <McpIcon />
  if (type === "web-search") return <GlobeIcon />
  if (type === "generated-image" || type === "image-view") return <ImageSquareIcon />
  if (type === "subagent-activity" || type === "multi-agent-action") return <AgentIcon />
  if (type === "permission-request" || type === "automatic-approval-review") return <LockIcon />
  if (type === "context-compaction") return <CollapseIcon />
  if (type === "worktree-init") return <BranchIcon />
  if (type === "automation-update") return <CalendarIcon />
  if (type === "remote-task-created") return <WebsiteNetworkIcon />
  if (type === "model-changed" || type === "model-rerouted") return <SparklesIcon />
  if (type === "strict-review-notice" || type === "auto-review-interruption-warning") {
    return <ShieldCheckIcon />
  }
  if (type === "system-error" || type === "stream-error") return <ErrorIcon />
  if (type === "userInput" || type === "user-input-response") return <UserIcon />
  if (type === "proposed-plan" || type === "todo-list" || type === "plan-implementation") {
    return <PinIcon />
  }
  if (type === "external-event") return <BoltIcon />
  return <ToolsIcon />
}

type ChatTimelineEventProps = HTMLAttributes<HTMLElement> & {
  type: ChatTimelineEventType
  title: ReactNode
  description?: ReactNode
  metadata?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  tone?: ChatTimelineTone
  state?: ChatActivityState
}

export function ChatTimelineEvent({
  className,
  type,
  title,
  description,
  metadata,
  icon,
  actions,
  tone = "neutral",
  state = "idle",
  ...props
}: ChatTimelineEventProps) {
  const role =
    tone === "error" || type.endsWith("error")
      ? "alert"
      : state === "running" || state === "waiting"
        ? "status"
        : undefined
  return (
    <section
      data-slot="chat-timeline-event"
      data-state={state}
      data-tone={tone}
      data-type={type}
      role={role}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-xl px-2 py-1.5 text-sm",
        "data-[tone=info]:bg-blue-500/5 data-[tone=success]:bg-emerald-500/5",
        "data-[tone=warning]:bg-amber-500/7 data-[tone=error]:bg-destructive/5",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5",
          "group-data-[tone=error]:text-destructive"
        )}
      >
        {icon ?? eventIcon(type)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{title}</span>
          {metadata ? <span className="text-xs text-muted-foreground">{metadata}</span> : null}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
    </section>
  )
}

export function ChatTimestampSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-timestamp-separator"
      className={cn("flex items-center gap-3 py-1 text-[11px] text-muted-foreground", className)}
      {...props}
    >
      <span className="h-px flex-1 bg-border/70" />
      <span>{props.children}</span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  )
}

type ChatThinkingPlaceholderProps = HTMLAttributes<HTMLDivElement> & {
  visible?: boolean
  icon?: ReactNode
}

export function ChatThinkingPlaceholder({
  className,
  visible = true,
  icon,
  ...props
}: ChatThinkingPlaceholderProps) {
  return (
    <div
      aria-hidden={!visible}
      data-slot="chat-thinking-placeholder"
      data-visible={visible}
      role="status"
      className={cn(
        "flex min-w-0 items-center gap-2 text-sm text-muted-foreground",
        "data-[visible=false]:invisible",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="[&_svg]:size-3.5">
        {icon ?? <CircleDashedIcon className="animate-spin" />}
      </span>
      <span className="loading-shimmer-pure-text truncate">{props.children}</span>
    </div>
  )
}

export function ChatActivitySummary({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-activity-summary"
      className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)}
      {...props}
    />
  )
}

type ChatActivitySummaryPartProps = HTMLAttributes<HTMLSpanElement> & {
  icon?: ReactNode
  active?: boolean
}

export function ChatActivitySummaryPart({
  className,
  icon,
  active = false,
  ...props
}: ChatActivitySummaryPartProps) {
  return (
    <span
      data-slot="chat-activity-summary-part"
      data-active={active || undefined}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-muted-foreground",
        "data-[active=true]:text-foreground",
        className
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 [&_svg]:size-3.5">{icon}</span> : null}
      <span className="truncate">{props.children}</span>
    </span>
  )
}

export function ChatPlanCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-slot="chat-plan-card"
      className={cn("overflow-hidden rounded-xl border bg-muted/15", className)}
      {...props}
    />
  )
}

export function ChatTodoList({ className, ...props }: HTMLAttributes<HTMLOListElement>) {
  return <ol data-slot="chat-todo-list" className={cn("divide-y", className)} {...props} />
}

type ChatTodoItemProps = HTMLAttributes<HTMLLIElement> & {
  state: ChatActivityState
  stateLabel: ReactNode
}

export function ChatTodoItem({ className, state, stateLabel, ...props }: ChatTodoItemProps) {
  return (
    <li
      data-slot="chat-todo-item"
      data-state={state}
      className={cn("flex min-w-0 items-start gap-2.5 px-3 py-2 text-sm", className)}
      {...props}
    >
      <span aria-hidden="true" className="mt-0.5 text-muted-foreground [&_svg]:size-3.5">
        {state === "completed" ? (
          <CheckCircleIcon className="text-emerald-600" />
        ) : state === "running" ? (
          <CircleDashedIcon className="animate-spin" />
        ) : (
          <ClockIcon />
        )}
      </span>
      <span className="min-w-0 flex-1">{props.children}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{stateLabel}</span>
    </li>
  )
}

type ChatApprovalCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  state: ChatApprovalState
  stateLabel: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}

export function ChatApprovalCard({
  className,
  title,
  state,
  stateLabel,
  icon,
  actions,
  children,
  ...props
}: ChatApprovalCardProps) {
  return (
    <section
      data-slot="chat-approval-card"
      data-state={state}
      role={state === "pending" ? "status" : undefined}
      className={cn(
        "rounded-xl border bg-background p-3 text-sm",
        "data-[state=pending]:border-amber-600/25 data-[state=rejected]:border-destructive/25",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground [&_svg]:size-4">{icon ?? <ShieldCheckIcon />}</span>
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{stateLabel}</span>
      </div>
      {children ? (
        <div className="mt-2 text-xs leading-5 text-muted-foreground">{children}</div>
      ) : null}
      {actions ? <div className="mt-3 flex justify-end gap-1">{actions}</div> : null}
    </section>
  )
}

type ChatUserInputCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function ChatUserInputCard({
  className,
  title,
  description,
  actions,
  children,
  ...props
}: ChatUserInputCardProps) {
  return (
    <section
      data-slot="chat-user-input-card"
      className={cn("rounded-xl border bg-background p-3 text-sm", className)}
      {...props}
    >
      <div className="flex items-start gap-2">
        <UserIcon className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          {description ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
          ) : null}
        </div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
      {actions ? <div className="mt-3 flex flex-wrap justify-end gap-1">{actions}</div> : null}
    </section>
  )
}

type ChatAgentCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  state: ChatActivityState
  stateLabel: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
}

export function ChatAgentCard({
  className,
  title,
  state,
  stateLabel,
  metadata,
  actions,
  children,
  ...props
}: ChatAgentCardProps) {
  return (
    <section
      data-slot="chat-agent-card"
      data-state={state}
      className={cn("rounded-xl border bg-muted/10 p-3 text-sm", className)}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AgentIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {metadata ? <span className="text-xs text-muted-foreground">{metadata}</span> : null}
        <span className="text-xs text-muted-foreground">{stateLabel}</span>
      </div>
      {children ? <div className="mt-2 text-xs text-muted-foreground">{children}</div> : null}
      {actions ? <div className="mt-2 flex justify-end gap-1">{actions}</div> : null}
    </section>
  )
}

export function ChatGeneratedImageGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-generated-image-grid"
      className={cn("grid grid-cols-2 gap-2 overflow-hidden rounded-xl", className)}
      {...props}
    />
  )
}

type ChatGeneratedImageProps = HTMLAttributes<HTMLElement> & {
  src?: string
  alt: string
  pending?: boolean
  actions?: ReactNode
}

export function ChatGeneratedImage({
  className,
  src,
  alt,
  pending = false,
  actions,
  ...props
}: ChatGeneratedImageProps) {
  return (
    <figure
      data-slot="chat-generated-image"
      data-state={pending ? "pending" : "complete"}
      className={cn("group relative aspect-square overflow-hidden rounded-xl bg-muted", className)}
      {...props}
    >
      {src ? <img alt={alt} className="size-full object-cover" src={src} /> : null}
      {pending ? (
        <div className="absolute inset-0 grid place-items-center bg-muted text-xs text-muted-foreground">
          <CircleDashedIcon className="size-4 animate-spin" />
          <span className="sr-only">{alt}</span>
        </div>
      ) : null}
      {actions ? <div className="absolute right-2 bottom-2 flex gap-1">{actions}</div> : null}
    </figure>
  )
}

type ChatDiffCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  additions?: number
  deletions?: number
  actions?: ReactNode
}

export function ChatDiffCard({
  className,
  title,
  additions,
  deletions,
  actions,
  children,
  ...props
}: ChatDiffCardProps) {
  return (
    <section
      data-slot="chat-diff-card"
      className={cn("overflow-hidden rounded-xl border bg-background", className)}
      {...props}
    >
      <div className="flex min-h-10 items-center gap-2 border-b px-3 text-sm">
        <CompareIcon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {additions !== undefined ? (
          <span className="font-mono text-xs text-emerald-600">+{additions}</span>
        ) : null}
        {deletions !== undefined ? (
          <span className="font-mono text-xs text-destructive">-{deletions}</span>
        ) : null}
        {actions}
      </div>
      <div className="overflow-auto bg-muted/15 p-3 font-mono text-xs">{children}</div>
    </section>
  )
}

type ChatResourceGroupProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode
}

export function ChatResourceGroup({
  className,
  title,
  children,
  ...props
}: ChatResourceGroupProps) {
  return (
    <section data-slot="chat-resource-group" className={cn("space-y-2", className)} {...props}>
      {title ? <h3 className="text-xs font-medium text-muted-foreground">{title}</h3> : null}
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  )
}

const resourceIcon = (kind: ChatResourceKind) => {
  if (kind === "website") return <GlobeIcon />
  if (kind === "appgen-app") return <SparklesIcon />
  if (kind === "artifact-session") return <WorkspaceIcon />
  if (kind === "image") return <ImageSquareIcon />
  return <FileIcon />
}

type ChatResourceCardProps = HTMLAttributes<HTMLElement> & {
  kind: ChatResourceKind
  title: ReactNode
  description?: ReactNode
  metadata?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}

export function ChatResourceCard({
  className,
  kind,
  title,
  description,
  metadata,
  icon,
  actions,
  ...props
}: ChatResourceCardProps) {
  return (
    <article
      data-slot="chat-resource-card"
      data-kind={kind}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-xl border bg-background p-3",
        className
      )}
      {...props}
    >
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">
        {icon ?? resourceIcon(kind)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        ) : null}
        {metadata ? (
          <span className="mt-1 block text-[11px] text-muted-foreground">{metadata}</span>
        ) : null}
      </span>
      {actions}
    </article>
  )
}

type ChatThreadHandoffProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  destination?: ReactNode
  state: ChatActivityState
  stateLabel: ReactNode
  actionLabel?: string
  onOpen?: () => void
}

export function ChatThreadHandoff({
  className,
  title,
  destination,
  state,
  stateLabel,
  actionLabel,
  onOpen,
  ...props
}: ChatThreadHandoffProps) {
  return (
    <section
      data-slot="chat-thread-handoff"
      data-state={state}
      className={cn("flex items-center gap-2 rounded-xl border bg-muted/15 p-3 text-sm", className)}
      {...props}
    >
      <ArrowRightIcon className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        {destination ? (
          <span className="block text-xs text-muted-foreground">{destination}</span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">{stateLabel}</span>
      {onOpen && actionLabel ? (
        <Button onClick={onOpen} size="sm" type="button" variant="ghost">
          {actionLabel}
        </Button>
      ) : null}
    </section>
  )
}

export function ChatTranscriptLine({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-transcript-line"
      className={cn("flex min-w-0 items-start gap-2 text-sm", className)}
      {...props}
    >
      <MicIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 leading-6">{props.children}</div>
    </div>
  )
}

export function ChatInlineNotice({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-inline-notice"
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
      {...props}
    >
      <InfoCircleIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{props.children}</span>
    </div>
  )
}

export type {
  ChatActivitySummaryPartProps,
  ChatAgentCardProps,
  ChatApprovalCardProps,
  ChatDiffCardProps,
  ChatGeneratedImageProps,
  ChatResourceCardProps,
  ChatResourceGroupProps,
  ChatThinkingPlaceholderProps,
  ChatThreadHandoffProps,
  ChatTimelineEventProps,
  ChatTodoItemProps,
  ChatUserInputCardProps,
}
