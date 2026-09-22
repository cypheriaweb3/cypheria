import type {
  ComponentProps,
  FormHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react"

import { Button } from "#components/button"
import { Textarea } from "#components/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/tooltip"
import { cn } from "#lib/utils"
import { ArrowUpIcon, ErrorIcon, PlusComposerIcon, StopIcon } from "../icons/index.js"

import type { ChatComposerLayout, ChatComposerStatus } from "./types.js"

type ChatComposerDockProps = HTMLAttributes<HTMLDivElement> & {
  layout?: ChatComposerLayout
  visible?: boolean
}

export function ChatComposerDock({
  className,
  layout = "floating",
  visible = true,
  ...props
}: ChatComposerDockProps) {
  return (
    <div
      aria-hidden={visible ? undefined : true}
      data-slot="chat-composer-dock"
      data-layout={layout}
      data-state={visible ? "visible" : "hidden"}
      hidden={!visible}
      inert={visible ? undefined : true}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center bg-gradient-to-t from-background via-background/95 to-transparent px-2 pt-12 pb-3 sm:px-3 sm:pb-4",
        "data-[layout=panel-overlay]:right-(--chat-composer-panel-offset)",
        className
      )}
      {...props}
    />
  )
}

export function ChatComposerFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-composer-frame"
      className={cn(
        "pointer-events-auto w-full max-w-(--chat-composer-max-width) overflow-hidden rounded-[1.25rem] border bg-background shadow-[0_8px_30px_rgb(0_0_0/0.08)]",
        "focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20",
        className
      )}
      {...props}
    />
  )
}

export function ChatComposerForm({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      data-slot="chat-composer-form"
      className={cn("flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  )
}

export function ChatComposerHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-align="block-start"
      data-slot="chat-composer-header"
      className={cn("order-first flex w-full min-w-0 flex-col gap-2 px-3 pt-3", className)}
      {...props}
    />
  )
}

export function ChatComposerBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-composer-body"
      className={cn("w-full min-h-12 min-w-0 px-3 py-2", className)}
      {...props}
    />
  )
}

type ChatComposerTextareaProps = ComponentProps<typeof Textarea> & {
  submitOnEnter?: boolean
}

export function ChatComposerTextarea({
  className,
  onKeyDown,
  submitOnEnter = true,
  ...props
}: ChatComposerTextareaProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event)
    if (
      event.defaultPrevented ||
      !submitOnEnter ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <Textarea
      data-slot="chat-composer-textarea"
      className={cn(
        "max-h-48 min-h-12 resize-none border-0 bg-transparent px-0 py-1 text-[15px] leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent",
        className
      )}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
}

export function ChatComposerFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-align="block-end"
      data-slot="chat-composer-footer"
      className={cn(
        "order-last flex min-h-11 w-full min-w-0 items-center gap-1 px-2 pb-2",
        className
      )}
      {...props}
    />
  )
}

export function ChatComposerUtilityBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-composer-utility-bar"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

type ChatComposerControlProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string
  tooltip?: ReactNode
}

export function ChatComposerControl({
  label,
  tooltip,
  children,
  variant = "ghost",
  size = "sm",
  ...props
}: ChatComposerControlProps) {
  const button = (
    <Button
      aria-label={label}
      data-slot="chat-composer-control"
      size={size}
      type="button"
      variant={variant}
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

export function ChatComposerContextTray({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-composer-context-tray"
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
      {...props}
    />
  )
}

type ChatComposerSubmitProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  status: ChatComposerStatus
  submitLabel: string
  stopLabel: string
  onStop?: () => void
}

export function ChatComposerSubmit({
  status,
  submitLabel,
  stopLabel,
  children,
  onClick,
  onStop,
  size = "icon",
  variant = "default",
  ...props
}: ChatComposerSubmitProps) {
  const generating = status === "submitted" || status === "streaming"
  const defaultIcon =
    status === "submitted" ? (
      <span
        aria-hidden="true"
        className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
      />
    ) : status === "streaming" ? (
      <StopIcon />
    ) : status === "error" ? (
      <ErrorIcon />
    ) : (
      <ArrowUpIcon />
    )
  return (
    <Button
      aria-label={generating ? stopLabel : submitLabel}
      data-slot="chat-composer-submit"
      data-state={status}
      size={size}
      type={generating ? "button" : "submit"}
      variant={variant}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && generating) onStop?.()
      }}
      {...props}
    >
      {children ?? defaultIcon}
    </Button>
  )
}

type ChatComposerRevealControlProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string
  tooltip?: ReactNode
}

export function ChatComposerRevealControl({
  className,
  label,
  tooltip,
  children,
  ...props
}: ChatComposerRevealControlProps) {
  const button = (
    <Button
      aria-label={label}
      data-slot="chat-composer-reveal-control"
      className={cn("pointer-events-auto rounded-full bg-background shadow-sm", className)}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <PlusComposerIcon />}
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
  ChatComposerControlProps,
  ChatComposerDockProps,
  ChatComposerRevealControlProps,
  ChatComposerSubmitProps,
  ChatComposerTextareaProps,
}
