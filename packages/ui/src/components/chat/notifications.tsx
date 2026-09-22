import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "#lib/utils"
import {
  BellIcon,
  CheckCircleIcon,
  LockIcon,
  QuestionMarkCircleIcon,
  WebsiteNetworkIcon,
} from "../icons/index.js"

import type { ChatDesktopNotificationKind } from "./types.js"

const notificationIcon = (kind: ChatDesktopNotificationKind) => {
  if (kind === "turn-complete") return <CheckCircleIcon />
  if (kind === "approval") return <LockIcon />
  if (kind === "question") return <QuestionMarkCircleIcon />
  if (kind === "remote-task") return <WebsiteNetworkIcon />
  return <BellIcon />
}

type ChatDesktopNotificationPreviewProps = HTMLAttributes<HTMLElement> & {
  kind: ChatDesktopNotificationKind
  appName: ReactNode
  title: ReactNode
  body?: ReactNode
  timestamp?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}

export function ChatDesktopNotificationPreview({
  className,
  kind,
  appName,
  title,
  body,
  timestamp,
  icon,
  actions,
  ...props
}: ChatDesktopNotificationPreviewProps) {
  return (
    <aside
      data-slot="chat-desktop-notification-preview"
      data-kind={kind}
      className={cn(
        "pointer-events-auto w-full max-w-88 rounded-2xl border bg-background/95 p-3 text-sm shadow-lg backdrop-blur-xl",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span aria-hidden="true" className="[&_svg]:size-3.5">
          <BellIcon />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium uppercase tracking-wide">
          {appName}
        </span>
        {timestamp ? <span className="shrink-0">{timestamp}</span> : null}
      </div>
      <div className="mt-2 flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          {icon ?? notificationIcon(kind)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          {body ? (
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{body}</span>
          ) : null}
        </span>
      </div>
      {actions ? <div className="mt-3 flex justify-end gap-1.5">{actions}</div> : null}
    </aside>
  )
}

export type { ChatDesktopNotificationPreviewProps }
