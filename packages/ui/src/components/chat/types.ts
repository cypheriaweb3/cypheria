import type { ReactNode } from "react"

export type ChatPanelPlacement = "right" | "bottom"

export type ChatPanelVisibility = "closed" | "hidden" | "visible"

export type ChatActivityState = "idle" | "running" | "waiting" | "completed" | "error"

export type ChatComposerLayout = "floating" | "panel-overlay"

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
