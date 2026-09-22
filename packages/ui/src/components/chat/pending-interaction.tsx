import type { ComponentProps, HTMLAttributes, ReactNode } from "react"

import { Button } from "#components/button"
import { Textarea } from "#components/textarea"
import { cn } from "#lib/utils"
import {
  CheckIcon,
  LockIcon,
  McpIcon,
  PinIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
} from "../icons/index.js"

import type { ChatPendingRequestKind } from "./types.js"

const requestIcon = (kind: ChatPendingRequestKind) => {
  if (kind === "approval") return <ShieldCheckIcon />
  if (kind === "permission") return <LockIcon />
  if (kind === "mcp-elicitation") return <McpIcon />
  if (kind === "implement-plan") return <PinIcon />
  return <QuestionMarkCircleIcon />
}

type ChatPendingInteractionProps = HTMLAttributes<HTMLElement> & {
  kind: ChatPendingRequestKind
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  badge?: ReactNode
}

export function ChatPendingInteraction({
  className,
  kind,
  title,
  description,
  icon,
  badge,
  children,
  ...props
}: ChatPendingInteractionProps) {
  return (
    <section
      aria-labelledby={props["aria-labelledby"]}
      data-slot="chat-pending-interaction"
      data-kind={kind}
      className={cn("flex min-w-0 flex-col bg-background", className)}
      {...props}
    >
      <ChatPendingInteractionHeader>
        <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
          {icon ?? requestIcon(kind)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          {description ? (
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
        {badge ? <span className="shrink-0 text-xs text-muted-foreground">{badge}</span> : null}
      </ChatPendingInteractionHeader>
      {children}
    </section>
  )
}

export function ChatPendingInteractionHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-pending-interaction-header"
      className={cn("flex min-w-0 items-start gap-2 px-3 pt-3 pb-2", className)}
      {...props}
    />
  )
}

export function ChatPendingInteractionBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-pending-interaction-body"
      className={cn("min-w-0 space-y-3 px-3 py-2", className)}
      {...props}
    />
  )
}

export function ChatPendingInteractionFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-pending-interaction-footer"
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-end gap-1.5 px-3 pt-2 pb-3",
        className
      )}
      {...props}
    />
  )
}

type ChatPendingQuestionProps = ComponentProps<"fieldset"> & {
  legend: ReactNode
  description?: ReactNode
}

export function ChatPendingQuestion({
  className,
  legend,
  description,
  children,
  ...props
}: ChatPendingQuestionProps) {
  return (
    <fieldset
      data-slot="chat-pending-question"
      className={cn("min-w-0 space-y-2", className)}
      {...props}
    >
      <legend className="text-sm font-medium">{legend}</legend>
      {description ? (
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      ) : null}
      <div className="grid gap-1.5">{children}</div>
    </fieldset>
  )
}

type ChatPendingOptionProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string
  description?: ReactNode
  selected?: boolean
  indicator?: ReactNode
}

export function ChatPendingOption({
  className,
  label,
  description,
  selected = false,
  indicator,
  ...props
}: ChatPendingOptionProps) {
  return (
    <Button
      aria-label={label}
      aria-pressed={selected}
      data-slot="chat-pending-option"
      data-selected={selected || undefined}
      className={cn(
        "h-auto min-h-10 w-full justify-start gap-2 rounded-xl border bg-background px-3 py-2 text-left font-normal",
        "hover:bg-muted/50 data-[selected=true]:border-ring/50 data-[selected=true]:bg-muted",
        className
      )}
      type="button"
      variant="ghost"
      {...props}
    >
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center rounded-full border text-primary data-[selected=true]:border-primary data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground [&_svg]:size-3"
        data-selected={selected || undefined}
      >
        {selected ? (indicator ?? <CheckIcon />) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </Button>
  )
}

export function ChatPendingTextInput({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="chat-pending-text-input"
      className={cn("min-h-18 resize-none rounded-xl bg-muted/20 text-sm", className)}
      {...props}
    />
  )
}

export function ChatPendingCode({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      data-slot="chat-pending-code"
      className={cn(
        "max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl border bg-muted/35 px-3 py-2 font-mono text-xs leading-5",
        className
      )}
      {...props}
    />
  )
}

type NamedPendingInteractionProps = Omit<ChatPendingInteractionProps, "kind">

const pendingSurface = (kind: ChatPendingRequestKind, slot: string) => {
  function NamedPendingInteraction({ className, ...props }: NamedPendingInteractionProps) {
    return <ChatPendingInteraction data-slot={slot} kind={kind} className={className} {...props} />
  }
  NamedPendingInteraction.displayName = slot
  return NamedPendingInteraction
}

export const ChatApprovalRequest = pendingSurface("approval", "chat-approval-request")
export const ChatPermissionRequest = pendingSurface("permission", "chat-permission-request")
export const ChatUserInputRequest = pendingSurface("user-input", "chat-user-input-request")
export const ChatMcpElicitationRequest = pendingSurface(
  "mcp-elicitation",
  "chat-mcp-elicitation-request"
)
export const ChatPlanImplementationRequest = pendingSurface(
  "implement-plan",
  "chat-plan-implementation-request"
)
export const ChatOptionPickerRequest = pendingSurface("option-picker", "chat-option-picker-request")
export const ChatSetupStepRequest = pendingSurface("setup-step", "chat-setup-step-request")

export type {
  ChatPendingInteractionProps,
  ChatPendingOptionProps,
  ChatPendingQuestionProps,
  NamedPendingInteractionProps,
}
