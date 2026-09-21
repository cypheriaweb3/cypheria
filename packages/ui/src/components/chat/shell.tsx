import type { CSSProperties, HTMLAttributes, ReactNode } from "react"

import { cn } from "#lib/utils"

import type { ChatPanelVisibility } from "./types.js"

type ChatWorkspaceShellProps = HTMLAttributes<HTMLDivElement> & {
  header?: ReactNode
  rightPanel?: ReactNode
  bottomPanel?: ReactNode
  rightPanelVisibility?: ChatPanelVisibility
  bottomPanelVisibility?: ChatPanelVisibility
  rightPanelSize?: number | string
  bottomPanelSize?: number | string
}

const panelSize = (value: number | string) => (typeof value === "number" ? `${value}px` : value)

const retainedPanelProps = (visibility: ChatPanelVisibility) => ({
  "aria-hidden": visibility === "visible" ? undefined : true,
  hidden: visibility !== "visible",
  inert: visibility === "visible" ? undefined : true,
})

export function ChatWorkspaceShell({
  className,
  children,
  header,
  rightPanel,
  bottomPanel,
  rightPanelVisibility = rightPanel ? "visible" : "closed",
  bottomPanelVisibility = bottomPanel ? "visible" : "closed",
  rightPanelSize = 320,
  bottomPanelSize = 288,
  style,
  ...props
}: ChatWorkspaceShellProps) {
  const shellStyle = {
    "--chat-right-panel-size": panelSize(rightPanelSize),
    "--chat-bottom-panel-size": panelSize(bottomPanelSize),
    ...style,
  } as CSSProperties

  return (
    <div
      data-slot="chat-workspace-shell"
      data-right-panel={rightPanelVisibility}
      data-bottom-panel={bottomPanelVisibility}
      className={cn(
        "flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className
      )}
      style={shellStyle}
      {...props}
    >
      {header}
      <div data-slot="chat-workspace-body" className="flex min-h-0 min-w-0 flex-1">
        <div
          data-slot="chat-workspace-main-stack"
          className="flex min-h-0 min-w-(--chat-main-min-width) flex-1 flex-col"
        >
          {children}
          {bottomPanelVisibility !== "closed" && (
            <div
              data-slot="chat-bottom-panel-surface"
              data-state={bottomPanelVisibility}
              className="h-(--chat-bottom-panel-size) max-h-[50%] min-h-(--chat-bottom-panel-min-height) shrink-0 border-t bg-background"
              {...retainedPanelProps(bottomPanelVisibility)}
            >
              {bottomPanel}
            </div>
          )}
        </div>
        {rightPanelVisibility !== "closed" && (
          <aside
            data-slot="chat-right-panel-surface"
            data-state={rightPanelVisibility}
            className="w-(--chat-right-panel-size) max-w-[50%] min-w-(--chat-right-panel-min-width) shrink-0 border-l bg-background"
            {...retainedPanelProps(rightPanelVisibility)}
          >
            {rightPanel}
          </aside>
        )}
      </div>
    </div>
  )
}

export function ChatMainColumn({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <main
      data-slot="chat-main-column"
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}
      {...props}
    />
  )
}

export type { ChatWorkspaceShellProps }
