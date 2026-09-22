"use client"

import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import type { ComponentProps, HTMLAttributes, ReactNode } from "react"
import { memo } from "react"
import { Streamdown } from "streamdown"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#components/collapsible"
import { cn } from "#lib/utils"
import {
  BrainIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  CircleIcon,
  ClockIcon,
  ErrorIcon,
  ToolsIcon,
} from "../icons/index.js"

import type { ChatActivityState } from "./types.js"

const streamdownPlugins = { cjk, code, math, mermaid }

type ChatMessageContentProps = ComponentProps<typeof Streamdown>

export const ChatMessageContent = memo(
  ({ className, ...props }: ChatMessageContentProps) => (
    <div
      data-slot="chat-message-content"
      className={cn(
        "w-full text-[15px] leading-7 text-foreground",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
        "[&_code:not(pre_code)]:rounded-sm [&_code:not(pre_code)]:bg-muted [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:text-[0.9em]",
        className
      )}
    >
      <Streamdown plugins={streamdownPlugins} {...props} />
    </div>
  ),
  (previous, next) =>
    previous.children === next.children && previous.isAnimating === next.isAnimating
)

ChatMessageContent.displayName = "ChatMessageContent"

type ChatReasoningProps = ComponentProps<typeof Collapsible>

export function ChatReasoning({ className, ...props }: ChatReasoningProps) {
  return (
    <Collapsible
      data-slot="chat-reasoning"
      className={cn("group/chat-reasoning min-w-0", className)}
      {...props}
    />
  )
}

type ChatReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  label: ReactNode
  icon?: ReactNode
}

export function ChatReasoningTrigger({
  className,
  label,
  icon,
  children,
  ...props
}: ChatReasoningTriggerProps) {
  return (
    <CollapsibleTrigger
      data-slot="chat-reasoning-trigger"
      className={cn(
        "flex min-h-7 max-w-full items-center gap-1.5 rounded-md text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
            {icon ?? <BrainIcon />}
          </span>
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform group-data-open/chat-reasoning:rotate-180"
          />
        </>
      )}
    </CollapsibleTrigger>
  )
}

type ChatReasoningContentProps = ComponentProps<typeof CollapsibleContent>

export function ChatReasoningContent({ className, ...props }: ChatReasoningContentProps) {
  return (
    <CollapsibleContent
      data-slot="chat-reasoning-content"
      className={cn(
        "mt-1.5 pl-5 text-sm leading-6 text-muted-foreground outline-none",
        "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-1 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top-1",
        className
      )}
      {...props}
    />
  )
}

const toolStateIcon = (state: ChatActivityState) => {
  if (state === "completed") return <CheckCircleIcon />
  if (state === "error") return <ErrorIcon />
  if (state === "waiting") return <ClockIcon />
  if (state === "running") return <CircleDashedIcon className="animate-spin" />
  return <CircleIcon />
}

type ChatToolProps = ComponentProps<typeof Collapsible> & {
  state?: ChatActivityState
}

export function ChatTool({ className, state = "idle", ...props }: ChatToolProps) {
  return (
    <Collapsible
      data-slot="chat-tool"
      data-state={state}
      className={cn("group/chat-tool min-w-0", className)}
      {...props}
    />
  )
}

type ChatToolTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: ReactNode
  state: ChatActivityState
  stateLabel: ReactNode
  metadata?: ReactNode
  icon?: ReactNode
}

export function ChatToolTrigger({
  className,
  title,
  state,
  stateLabel,
  metadata,
  icon,
  children,
  ...props
}: ChatToolTriggerProps) {
  return (
    <CollapsibleTrigger
      data-slot="chat-tool-trigger"
      data-state={state}
      className={cn(
        "flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md text-left text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <span
            aria-hidden="true"
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground data-[state=completed]:text-emerald-600 data-[state=error]:text-destructive [&_svg]:size-3.5"
            data-state={state}
          >
            {icon ?? (state === "idle" ? <ToolsIcon /> : toolStateIcon(state))}
          </span>
          <span className="min-w-0 truncate font-medium">{title}</span>
          {metadata ? (
            <span className="shrink-0 text-xs text-muted-foreground">{metadata}</span>
          ) : null}
          <span className="sr-only">{stateLabel}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-data-open/chat-tool:rotate-180"
          />
        </>
      )}
    </CollapsibleTrigger>
  )
}

type ChatToolContentProps = ComponentProps<typeof CollapsibleContent>

export function ChatToolContent({ className, ...props }: ChatToolContentProps) {
  return (
    <CollapsibleContent
      data-slot="chat-tool-content"
      className={cn(
        "mt-2 ml-6 space-y-3 overflow-hidden rounded-xl border bg-muted/15 p-3 text-sm outline-none",
        "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-1 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top-1",
        className
      )}
      {...props}
    />
  )
}

type ChatToolSectionProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode
  tone?: "default" | "error"
}

export function ChatToolSection({
  className,
  label,
  tone = "default",
  ...props
}: ChatToolSectionProps) {
  return (
    <div
      data-slot="chat-tool-section"
      data-tone={tone}
      className={cn("space-y-1.5 data-[tone=error]:text-destructive", className)}
      {...props}
    >
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="text-xs leading-5">{props.children}</div>
    </div>
  )
}

export function ChatToolCode({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      data-slot="chat-tool-code"
      className={cn(
        "overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs leading-5 text-foreground",
        className
      )}
      {...props}
    />
  )
}

export type {
  ChatMessageContentProps,
  ChatReasoningContentProps,
  ChatReasoningProps,
  ChatReasoningTriggerProps,
  ChatToolContentProps,
  ChatToolProps,
  ChatToolSectionProps,
  ChatToolTriggerProps,
}
