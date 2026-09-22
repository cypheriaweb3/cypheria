import type { ReactNode } from "react"

export type ChatPanelPlacement = "right" | "bottom"

export type ChatPanelVisibility = "closed" | "hidden" | "visible"

export type ChatActivityState = "idle" | "running" | "waiting" | "completed" | "error"

export type ChatTimelineEventType =
  | "assistant-message"
  | "auto-review-interruption-warning"
  | "automatic-approval-review"
  | "automation-update"
  | "context-compaction"
  | "dynamic-tool-call"
  | "exec"
  | "external-event"
  | "forked-from-conversation"
  | "generated-image"
  | "image-view"
  | "mcp-server-elicitation"
  | "mcp-tool-call"
  | "model-changed"
  | "model-rerouted"
  | "multi-agent-action"
  | "patch"
  | "permission-request"
  | "personality-changed"
  | "plan-implementation"
  | "proposed-plan"
  | "reasoning"
  | "realtime-transcript"
  | "remote-task-created"
  | "steered"
  | "stream-error"
  | "strict-review-notice"
  | "subagent-activity"
  | "system-error"
  | "todo-list"
  | "turn-diff"
  | "user-input-response"
  | "user-message"
  | "userInput"
  | "web-search"
  | "worked-for"
  | "worktree-init"

export type ChatTimelineTone = "neutral" | "info" | "success" | "warning" | "error"

export type ChatResourceKind = "file" | "website" | "appgen-app" | "artifact-session" | "image"

export type ChatPanelContentKind =
  | "artifact"
  | "automation"
  | "browser"
  | "diff"
  | "document"
  | "entity"
  | "file"
  | "goal"
  | "image"
  | "mcp-app"
  | "mcp-extension-file"
  | "mcp-extension-thread"
  | "notebook"
  | "pdf"
  | "plan"
  | "presentation"
  | "pull-request"
  | "sandbox"
  | "side-chat"
  | "sources"
  | "subagents"
  | "summary"
  | "terminal"
  | "timeline"
  | "workbook"

export type ChatApprovalState = "pending" | "approved" | "rejected" | "timed-out" | "aborted"

export type ChatComposerLayout = "floating" | "panel-overlay"

export type ChatComposerStatus = "ready" | "submitted" | "streaming" | "error"

export type ChatPendingRequestKind =
  | "approval"
  | "permission"
  | "user-input"
  | "mcp-elicitation"
  | "implement-plan"
  | "option-picker"
  | "setup-step"

export type ChatComposerNoticeTone = "neutral" | "info" | "success" | "warning" | "error"

export type ChatQueuedInputState = "queued" | "sending" | "paused" | "error"

export type ChatFixedTurnSummaryKind = "goal" | "todo" | "diff" | "subagents" | "status"

export type ChatDesktopNotificationKind = "turn-complete" | "approval" | "question" | "remote-task"

export interface ChatPanelTabDescriptor {
  readonly id: string
  readonly title: ReactNode
  readonly icon?: ReactNode
  readonly badge?: ReactNode
  readonly content?: ReactNode
  readonly closable?: boolean
  readonly movable?: boolean
  readonly disabled?: boolean
}

export interface ChatPanelLauncherItem {
  readonly id: string
  readonly label: ReactNode
  readonly icon?: ReactNode
  readonly description?: ReactNode
  readonly disabled?: boolean
}

export type ChatSourceKind =
  | "attached"
  | "read"
  | "created"
  | "updated"
  | "web"
  | "tool-input"
  | "tool-result"

export interface ChatSourceDescriptor {
  readonly id: string
  readonly label: ReactNode
  readonly kind: ChatSourceKind
  readonly description?: ReactNode
  readonly metadata?: ReactNode
  readonly icon?: ReactNode
}

export interface ChatSubagentDescriptor {
  readonly id: string
  readonly title: ReactNode
  readonly state: ChatActivityState
  readonly description?: ReactNode
  readonly model?: ReactNode
  readonly reasoningEffort?: ReactNode
  readonly icon?: ReactNode
}

export type ChatReviewFileStatus = "added" | "modified" | "deleted" | "renamed"

export interface ChatReviewFileDescriptor {
  readonly id: string
  readonly path: ReactNode
  readonly additions?: number
  readonly deletions?: number
  readonly status?: ChatReviewFileStatus
  readonly selected?: boolean
}

export type ChatTerminalStatus = "idle" | "running" | "exited" | "failed"

export interface ChatTerminalTabDescriptor {
  readonly id: string
  readonly title: ReactNode
  readonly status?: ChatTerminalStatus
  readonly closable?: boolean
}
