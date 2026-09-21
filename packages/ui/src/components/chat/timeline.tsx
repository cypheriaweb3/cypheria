import type { ComponentProps, CSSProperties, HTMLAttributes, ReactNode } from "react"

import { Button } from "#components/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/tooltip"
import { cn } from "#lib/utils"
import { ArrowDownIcon } from "../icons/index.js"

import type { ChatActivityState } from "./types.js"

export function ChatTimeline({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-live="polite"
      data-slot="chat-timeline"
      role="log"
      className={cn(
        "cypheria-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth",
        className
      )}
      {...props}
    />
  )
}

export function ChatTimelineContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-timeline-content"
      className={cn(
        "mx-auto flex min-h-full w-full max-w-(--chat-content-max-width) flex-col justify-end gap-6 px-4 pt-6 pb-(--chat-composer-safe-area)",
        className
      )}
      {...props}
    />
  )
}

type ChatTimelineItemProps = HTMLAttributes<HTMLElement> & {
  kind?: "user" | "assistant" | "activity" | "system"
  state?: ChatActivityState
}

export function ChatTimelineItem({
  className,
  kind = "assistant",
  state = "idle",
  ...props
}: ChatTimelineItemProps) {
  return (
    <article
      data-slot="chat-timeline-item"
      data-kind={kind}
      data-state={state}
      className={cn("group/chat-item relative flex w-full min-w-0 flex-col gap-2", className)}
      {...props}
    />
  )
}

type ChatUserMessageProps = HTMLAttributes<HTMLDivElement> & {
  compact?: boolean
}

export function ChatUserMessage({ className, compact = false, ...props }: ChatUserMessageProps) {
  return (
    <div
      data-slot="chat-user-message"
      data-compact={compact || undefined}
      className={cn(
        "ml-auto w-fit max-w-[70%] rounded-3xl bg-secondary px-4 py-2.5 text-sm text-foreground",
        "data-[compact=true]:max-w-[28.5rem]",
        className
      )}
      {...props}
    />
  )
}

export function ChatAssistantMessage({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-assistant-message"
      className={cn("min-w-0 max-w-full text-sm text-foreground", className)}
      {...props}
    />
  )
}

type ChatTurnActivityProps = HTMLAttributes<HTMLDivElement> & {
  state?: ChatActivityState
  icon?: ReactNode
}

export function ChatTurnActivity({
  className,
  state = "running",
  icon,
  children,
  ...props
}: ChatTurnActivityProps) {
  return (
    <div
      data-slot="chat-turn-activity"
      data-state={state}
      role="status"
      className={cn(
        "flex min-w-0 items-start gap-2 text-xs text-muted-foreground",
        "data-[state=error]:text-destructive",
        className
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function ChatMessageActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-message-actions"
      className={cn(
        "flex min-h-7 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/chat-item:opacity-100 group-hover/chat-item:opacity-100",
        className
      )}
      {...props}
    />
  )
}

type ChatTurnNavigatorProps = HTMLAttributes<HTMLElement> & {
  label: string
}

export function ChatTurnNavigator({ className, label, ...props }: ChatTurnNavigatorProps) {
  return (
    <nav
      aria-label={label}
      data-slot="chat-turn-navigator"
      className={cn(
        "absolute inset-y-12 left-2 z-10 hidden w-9 flex-col items-center justify-center gap-px lg:flex",
        className
      )}
      {...props}
    />
  )
}

type ChatTurnMarkerProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string
  active?: boolean
}

export function ChatTurnMarker({
  className,
  label,
  active = false,
  children,
  ...props
}: ChatTurnMarkerProps) {
  return (
    <Button
      aria-current={active ? "step" : undefined}
      aria-label={label}
      data-slot="chat-turn-marker"
      data-active={active || undefined}
      className={cn(
        "h-2.5 w-9 rounded-none p-0 text-muted-foreground opacity-50 hover:opacity-100 data-[active=true]:opacity-100",
        className
      )}
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <span className="h-px w-2 rounded-full bg-current" />}
    </Button>
  )
}

type ChatTimelineStateProps = HTMLAttributes<HTMLDivElement> & {
  state: "empty" | "loading" | "loading-history" | "error"
  icon?: ReactNode
}

export function ChatTimelineState({
  className,
  state,
  icon,
  children,
  ...props
}: ChatTimelineStateProps) {
  return (
    <div
      data-slot="chat-timeline-state"
      data-state={state}
      role={state === "error" ? "alert" : "status"}
      className={cn(
        "flex w-full items-center justify-center gap-2 py-4 text-center text-sm text-muted-foreground",
        "data-[state=empty]:min-h-48 data-[state=error]:text-destructive",
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </div>
  )
}

type ChatResponseSpacerProps = HTMLAttributes<HTMLDivElement> & {
  height?: number | string
}

export function ChatResponseSpacer({ height = 0, style, ...props }: ChatResponseSpacerProps) {
  const spacerStyle = {
    height: typeof height === "number" ? `${height}px` : height,
    ...style,
  } as CSSProperties
  return (
    <div
      aria-hidden="true"
      data-slot="chat-response-spacer"
      className="shrink-0 transition-[height] duration-200"
      style={spacerStyle}
      {...props}
    />
  )
}

type ChatScrollToLatestProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string
  tooltip?: ReactNode
}

export function ChatScrollToLatest({
  className,
  label,
  tooltip,
  children,
  ...props
}: ChatScrollToLatestProps) {
  const button = (
    <Button
      aria-label={label}
      data-slot="chat-scroll-to-latest"
      className={cn(
        "absolute bottom-(--chat-composer-safe-area) left-1/2 z-20 -translate-x-1/2 rounded-full bg-background shadow-sm",
        className
      )}
      size="icon-sm"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <ArrowDownIcon />}
    </Button>
  )

  if (!tooltip) return button
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export type {
  ChatResponseSpacerProps,
  ChatScrollToLatestProps,
  ChatTimelineItemProps,
  ChatTimelineStateProps,
  ChatTurnActivityProps,
  ChatTurnMarkerProps,
  ChatTurnNavigatorProps,
  ChatUserMessageProps,
}
