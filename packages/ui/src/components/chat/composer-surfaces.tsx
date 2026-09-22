import type { HTMLAttributes, ReactNode } from "react"

import { Button } from "#components/button"
import { cn } from "#lib/utils"
import {
  AgentIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  ClockIcon,
  CloseBoldIcon,
  CompareIcon,
  ErrorIcon,
  FileIcon,
  InfoCircleIcon,
  PinIcon,
  WarningIcon,
} from "../icons/index.js"

import type {
  ChatActivityState,
  ChatComposerNoticeTone,
  ChatFixedTurnSummaryKind,
  ChatQueuedInputState,
} from "./types.js"

export function ChatComposerTopTray({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-composer-top-tray"
      className={cn(
        "pointer-events-auto flex w-full min-w-0 flex-col gap-1.5 rounded-2xl border bg-background/98 p-1.5 shadow-sm backdrop-blur",
        className
      )}
      {...props}
    />
  )
}

type ChatComposerPanelProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}

export function ChatComposerPanel({
  className,
  title,
  description,
  icon,
  actions,
  children,
  ...props
}: ChatComposerPanelProps) {
  return (
    <section
      data-slot="chat-composer-panel"
      className={cn("min-w-0 rounded-xl px-2.5 py-2 text-sm", className)}
      {...props}
    >
      {title || description || icon || actions ? (
        <div className="flex min-w-0 items-start gap-2">
          {icon ? (
            <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
          ) : null}
          <span className="min-w-0 flex-1">
            {title ? <span className="block truncate font-medium">{title}</span> : null}
            {description ? (
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {description}
              </span>
            ) : null}
          </span>
          {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
        </div>
      ) : null}
      {children ? (
        <div className={cn(title || description ? "mt-2" : undefined)}>{children}</div>
      ) : null}
    </section>
  )
}

const noticeIcon = (tone: ChatComposerNoticeTone) => {
  if (tone === "success") return <CheckCircleIcon />
  if (tone === "warning") return <WarningIcon />
  if (tone === "error") return <ErrorIcon />
  return <InfoCircleIcon />
}

type ChatComposerBannerProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  description?: ReactNode
  tone?: ChatComposerNoticeTone
  icon?: ReactNode
  actions?: ReactNode
  dismissLabel?: string
  onDismiss?: () => void
}

export function ChatComposerBanner({
  className,
  title,
  description,
  tone = "neutral",
  icon,
  actions,
  dismissLabel,
  onDismiss,
  ...props
}: ChatComposerBannerProps) {
  return (
    <aside
      data-slot="chat-composer-banner"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-xl px-2.5 py-2 text-sm",
        "data-[tone=info]:bg-blue-500/7 data-[tone=success]:bg-emerald-500/7",
        "data-[tone=warning]:bg-amber-500/10 data-[tone=error]:bg-destructive/8",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-muted-foreground data-[tone=error]:text-destructive data-[tone=warning]:text-amber-600 [&_svg]:size-4"
        data-tone={tone}
      >
        {icon ?? noticeIcon(tone)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
      {onDismiss && dismissLabel ? (
        <Button
          aria-label={dismissLabel}
          className="-mt-1 -me-1 shrink-0"
          onClick={onDismiss}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <CloseBoldIcon />
        </Button>
      ) : null}
    </aside>
  )
}

type ChatComposerStatusMessageProps = HTMLAttributes<HTMLDivElement> & {
  state?: ChatActivityState
  icon?: ReactNode
}

export function ChatComposerStatusMessage({
  className,
  state = "idle",
  icon,
  ...props
}: ChatComposerStatusMessageProps) {
  return (
    <div
      aria-live="polite"
      data-slot="chat-composer-status-message"
      data-state={state}
      role="status"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground",
        "data-[state=error]:text-destructive",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
        {icon ??
          (state === "running" ? (
            <CircleDashedIcon className="animate-spin" />
          ) : state === "error" ? (
            <ErrorIcon />
          ) : (
            <InfoCircleIcon />
          ))}
      </span>
      <span className="min-w-0 flex-1 truncate">{props.children}</span>
    </div>
  )
}

export function ChatQueuedInputList({ className, ...props }: HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      data-slot="chat-queued-input-list"
      className={cn("flex min-w-0 flex-col gap-0.5", className)}
      {...props}
    />
  )
}

type ChatQueuedInputItemProps = HTMLAttributes<HTMLLIElement> & {
  state: ChatQueuedInputState
  stateLabel: ReactNode
  position?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}

export function ChatQueuedInputItem({
  className,
  state,
  stateLabel,
  position,
  actions,
  icon,
  children,
  ...props
}: ChatQueuedInputItemProps) {
  return (
    <li
      data-slot="chat-queued-input-item"
      data-state={state}
      className={cn(
        "group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/60",
        "data-[state=error]:text-destructive",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="shrink-0 text-muted-foreground [&_svg]:size-3.5">
        {icon ??
          (state === "sending" ? <CircleDashedIcon className="animate-spin" /> : <ClockIcon />)}
      </span>
      {position ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">{position}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="sr-only">{stateLabel}</span>
      {actions ? <span className="flex shrink-0 items-center gap-0.5">{actions}</span> : null}
    </li>
  )
}

export function ChatFixedTurnSummary({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-fixed-turn-summary"
      className={cn(
        "pointer-events-auto flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full border bg-background/98 p-1 text-xs shadow-sm backdrop-blur",
        className
      )}
      {...props}
    />
  )
}

const summaryIcon = (kind: ChatFixedTurnSummaryKind) => {
  if (kind === "goal") return <PinIcon />
  if (kind === "diff") return <CompareIcon />
  if (kind === "subagents") return <AgentIcon />
  if (kind === "todo") return <CheckCircleIcon />
  return <InfoCircleIcon />
}

type ChatFixedTurnSummaryItemProps = HTMLAttributes<HTMLDivElement> & {
  kind: ChatFixedTurnSummaryKind
  label: ReactNode
  value?: ReactNode
  progress?: number
  icon?: ReactNode
}

export function ChatFixedTurnSummaryItem({
  className,
  kind,
  label,
  value,
  progress,
  icon,
  ...props
}: ChatFixedTurnSummaryItemProps) {
  const normalizedProgress =
    progress === undefined ? undefined : Math.min(100, Math.max(0, progress))
  return (
    <div
      data-slot="chat-fixed-turn-summary-item"
      data-kind={kind}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      {normalizedProgress === undefined ? (
        <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
          {icon ?? summaryIcon(kind)}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="grid size-3.5 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(currentColor ${normalizedProgress}%, transparent 0)`,
          }}
        >
          <span className="size-2 rounded-full bg-background" />
        </span>
      )}
      <span className="min-w-0 truncate">{label}</span>
      {value ? <span className="shrink-0 font-medium text-foreground">{value}</span> : null}
    </div>
  )
}

type ChatContextChipProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode
  metadata?: ReactNode
  icon?: ReactNode
  removeLabel?: string
  onRemove?: () => void
}

export function ChatContextChip({
  className,
  label,
  metadata,
  icon,
  removeLabel,
  onRemove,
  ...props
}: ChatContextChipProps) {
  return (
    <div
      data-slot="chat-context-chip"
      className={cn(
        "inline-flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-lg border bg-muted/35 px-2 text-xs",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="shrink-0 text-muted-foreground [&_svg]:size-3.5">
        {icon ?? <FileIcon />}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {metadata ? <span className="shrink-0 text-muted-foreground">{metadata}</span> : null}
      {onRemove && removeLabel ? (
        <Button
          aria-label={removeLabel}
          className="-me-1 size-5 shrink-0"
          onClick={onRemove}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <CloseBoldIcon />
        </Button>
      ) : null}
    </div>
  )
}

type ChatComposerMeterProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode
  value: number
  max?: number
  detail?: ReactNode
}

export function ChatComposerMeter({
  className,
  label,
  value,
  max = 100,
  detail,
  ...props
}: ChatComposerMeterProps) {
  return (
    <div
      data-slot="chat-composer-meter"
      className={cn("flex min-w-0 items-center gap-2 text-xs", className)}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <progress
        aria-label={typeof label === "string" ? label : undefined}
        max={max}
        value={value}
      />
      {detail ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  )
}

export type {
  ChatComposerBannerProps,
  ChatComposerMeterProps,
  ChatComposerPanelProps,
  ChatComposerStatusMessageProps,
  ChatContextChipProps,
  ChatFixedTurnSummaryItemProps,
  ChatQueuedInputItemProps,
}
