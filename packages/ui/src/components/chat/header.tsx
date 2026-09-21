import type { ComponentProps, HTMLAttributes, ReactNode } from "react"

import { Button } from "#components/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/tooltip"
import { cn } from "#lib/utils"

import type { ChatActivityState, ChatPanelPlacement } from "./types.js"

export function ChatHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header
      data-slot="chat-header"
      className={cn(
        "z-20 flex h-(--chat-header-height) min-h-(--chat-header-height) items-center gap-2 border-b bg-background px-3 text-sm",
        className
      )}
      {...props}
    />
  )
}

export function ChatHeaderBreadcrumb({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-header-breadcrumb"
      className={cn("flex min-w-0 shrink-0 items-center gap-1 text-muted-foreground", className)}
      {...props}
    />
  )
}

export function ChatHeaderTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      data-slot="chat-header-title"
      className={cn("min-w-0 max-w-80 truncate font-medium text-sm", className)}
      {...props}
    />
  )
}

type ChatHeaderStatusProps = HTMLAttributes<HTMLDivElement> & {
  state?: ChatActivityState
}

export function ChatHeaderStatus({ className, state = "idle", ...props }: ChatHeaderStatusProps) {
  return (
    <div
      data-slot="chat-header-status"
      data-state={state}
      role="status"
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
        "data-[state=error]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

export function ChatHeaderActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-header-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  )
}

type ChatPanelToggleProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string
  panel: ChatPanelPlacement | "summary"
  pressed: boolean
  tooltip?: ReactNode
}

export function ChatPanelToggle({
  label,
  panel,
  pressed,
  tooltip,
  children,
  ...props
}: ChatPanelToggleProps) {
  const button = (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      data-slot="chat-panel-toggle"
      data-panel={panel}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children}
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

export function ChatPinnedSummary({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <aside
      data-slot="chat-pinned-summary"
      className={cn(
        "mx-auto w-full max-w-(--chat-content-max-width) border-b bg-background/95 px-4 py-3 text-sm backdrop-blur",
        className
      )}
      {...props}
    />
  )
}

export type { ChatHeaderStatusProps, ChatPanelToggleProps }
