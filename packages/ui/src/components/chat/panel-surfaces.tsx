import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "#lib/utils"

import { ChatPreviewPanel } from "./panel-content.js"
import type { ChatPanelContentKind } from "./types.js"

type ChatPanelSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  kind: ChatPanelContentKind
  toolbar?: ReactNode
  statusBar?: ReactNode
}

export function ChatPanelSurface({
  className,
  kind,
  toolbar,
  statusBar,
  ...props
}: ChatPanelSurfaceProps) {
  return (
    <ChatPreviewPanel
      data-kind={kind}
      data-slot="chat-panel-surface"
      className={cn("isolate", className)}
      statusBar={statusBar}
      toolbar={toolbar}
      {...props}
    />
  )
}

type NamedPanelSurfaceProps = Omit<ChatPanelSurfaceProps, "kind">

const surface = (kind: ChatPanelContentKind, slot: string) => {
  function NamedPanelSurface({ className, ...props }: NamedPanelSurfaceProps) {
    return <ChatPanelSurface data-slot={slot} kind={kind} className={className} {...props} />
  }
  NamedPanelSurface.displayName = slot
  return NamedPanelSurface
}

export const ChatGoalPanel = surface("goal", "chat-goal-panel")
export const ChatPullRequestPanel = surface("pull-request", "chat-pull-request-panel")
export const ChatFilePreviewPanel = surface("file", "chat-file-preview-panel")
export const ChatImagePreviewPanel = surface("image", "chat-image-preview-panel")
export const ChatBrowserPanel = surface("browser", "chat-browser-panel")
export const ChatMcpAppPanel = surface("mcp-app", "chat-mcp-app-panel")
export const ChatAutomationPanel = surface("automation", "chat-automation-panel")
export const ChatArtifactPanel = surface("artifact", "chat-artifact-panel")
export const ChatPdfPanel = surface("pdf", "chat-pdf-panel")
export const ChatDocumentPanel = surface("document", "chat-document-panel")
export const ChatNotebookPanel = surface("notebook", "chat-notebook-panel")
export const ChatPresentationPanel = surface("presentation", "chat-presentation-panel")
export const ChatWorkbookPanel = surface("workbook", "chat-workbook-panel")
export const ChatEntityPanel = surface("entity", "chat-entity-panel")
export const ChatSideChatPanel = surface("side-chat", "chat-side-chat-panel")
export const ChatMcpThreadPanel = surface("mcp-extension-thread", "chat-mcp-thread-panel")
export const ChatMcpFilePanel = surface("mcp-extension-file", "chat-mcp-file-panel")
export const ChatSandboxPanel = surface("sandbox", "chat-sandbox-panel")
export const ChatSecondaryTimelinePanel = surface("timeline", "chat-secondary-timeline-panel")

export type { ChatPanelSurfaceProps, NamedPanelSurfaceProps }
