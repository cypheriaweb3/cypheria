import type { HTMLAttributes, ReactNode } from "react"

import { Button } from "#components/button"
import { cn } from "#lib/utils"
import {
  AddSourcesIcon,
  AgentIcon,
  BranchIcon,
  FileIcon,
  GlobeIcon,
  PullRequestOpenIcon,
  TerminalIcon,
} from "../icons/index.js"

import { ChatPanelContent, ChatPanelList, ChatPanelListItem, ChatPanelSection } from "./panel.js"
import type {
  ChatActivityState,
  ChatReviewFileDescriptor,
  ChatSourceDescriptor,
  ChatSourceKind,
  ChatSubagentDescriptor,
  ChatTerminalStatus,
  ChatTerminalTabDescriptor,
} from "./types.js"

export function ChatSourcesPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <ChatPanelContent data-slot="chat-sources-panel" className={cn("p-2", className)} {...props} />
  )
}

type ChatSourceGroupProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  count?: ReactNode
}

export function ChatSourceGroup({ title, count, children, ...props }: ChatSourceGroupProps) {
  return (
    <ChatPanelSection data-slot="chat-source-group" {...props}>
      <div className="flex min-w-0 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{title}</span>
        {count && <span className="ml-auto tabular-nums">{count}</span>}
      </div>
      <ChatPanelList>{children}</ChatPanelList>
    </ChatPanelSection>
  )
}

const sourceKindIcon = (kind: ChatSourceKind) => {
  if (kind === "web") return <GlobeIcon />
  if (kind === "attached") return <AddSourcesIcon />
  return <FileIcon />
}

type ChatSourceItemProps = HTMLAttributes<HTMLLIElement> & {
  source: ChatSourceDescriptor
}

export function ChatSourceItem({ className, source, ...props }: ChatSourceItemProps) {
  return (
    <ChatPanelListItem
      data-slot="chat-source-item"
      data-kind={source.kind}
      className={cn("flex items-start gap-2", className)}
      {...props}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
        {source.icon ?? sourceKindIcon(source.kind)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{source.label}</span>
        {source.description && (
          <span className="block truncate text-xs text-muted-foreground">{source.description}</span>
        )}
      </span>
      {source.metadata && (
        <span className="shrink-0 text-xs text-muted-foreground">{source.metadata}</span>
      )}
    </ChatPanelListItem>
  )
}

export function ChatSubagentsPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <ChatPanelContent
      data-slot="chat-subagents-panel"
      className={cn("p-2", className)}
      {...props}
    />
  )
}

type ChatSubagentGroupProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  count?: ReactNode
}

export function ChatSubagentGroup({ title, count, children, ...props }: ChatSubagentGroupProps) {
  return (
    <ChatPanelSection data-slot="chat-subagent-group" {...props}>
      <div className="flex min-w-0 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{title}</span>
        {count && <span className="ml-auto tabular-nums">{count}</span>}
      </div>
      <ChatPanelList>{children}</ChatPanelList>
    </ChatPanelSection>
  )
}

type ChatSubagentItemProps = HTMLAttributes<HTMLLIElement> & {
  agent: ChatSubagentDescriptor
  stateLabel: ReactNode
}

export function ChatSubagentItem({
  className,
  agent,
  stateLabel,
  ...props
}: ChatSubagentItemProps) {
  return (
    <ChatPanelListItem
      data-slot="chat-subagent-item"
      data-state={agent.state}
      className={cn("flex items-start gap-2", className)}
      {...props}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
        {agent.icon ?? <AgentIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{agent.title}</span>
        {agent.description && (
          <span className="block truncate text-xs text-muted-foreground">{agent.description}</span>
        )}
        {(agent.model || agent.reasoningEffort) && (
          <span className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
            {agent.model}
            {agent.reasoningEffort}
          </span>
        )}
      </span>
      <span
        data-slot="chat-subagent-state"
        className="shrink-0 text-xs text-muted-foreground data-[state=error]:text-destructive"
        data-state={agent.state}
      >
        {stateLabel}
      </span>
    </ChatPanelListItem>
  )
}

export function ChatPlanPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <ChatPanelContent data-slot="chat-plan-panel" className={className} {...props} />
}

type ChatPlanStepProps = HTMLAttributes<HTMLLIElement> & {
  state: ChatActivityState
  stateLabel: ReactNode
  icon?: ReactNode
}

export function ChatPlanStep({
  className,
  state,
  stateLabel,
  icon,
  children,
  ...props
}: ChatPlanStepProps) {
  return (
    <li
      data-slot="chat-plan-step"
      data-state={state}
      className={cn("flex items-start gap-2 py-1.5 text-sm", className)}
      {...props}
    >
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{stateLabel}</span>
    </li>
  )
}

export function ChatSummaryPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <ChatPanelContent data-slot="chat-summary-panel" className={className} {...props} />
}

type ChatSummarySectionProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
}

export function ChatSummarySection({ title, children, ...props }: ChatSummarySectionProps) {
  return (
    <ChatPanelSection data-slot="chat-summary-section" {...props}>
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="text-sm">{children}</div>
    </ChatPanelSection>
  )
}

export function ChatReviewPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <ChatPanelContent data-slot="chat-review-panel" className={cn("p-0", className)} {...props} />
  )
}

export function ChatReviewToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-review-toolbar"
      className={cn(
        "sticky top-0 z-10 flex min-h-10 items-center gap-1 border-b bg-background px-2",
        className
      )}
      {...props}
    />
  )
}

type ChatReviewFileListProps = HTMLAttributes<HTMLUListElement> & {
  files: readonly ChatReviewFileDescriptor[]
  onSelectFile?: (fileId: string) => void
  selectFileLabel?: (file: ChatReviewFileDescriptor) => string
  statusLabel?: (file: ChatReviewFileDescriptor) => ReactNode
}

export function ChatReviewFileList({
  className,
  files,
  onSelectFile,
  selectFileLabel,
  statusLabel,
  ...props
}: ChatReviewFileListProps) {
  return (
    <ul data-slot="chat-review-file-list" className={cn("p-2", className)} {...props}>
      {files.map((file) => (
        <li key={file.id}>
          <Button
            aria-label={selectFileLabel?.(file)}
            aria-pressed={file.selected}
            className="h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5 text-left font-normal"
            disabled={!onSelectFile}
            onClick={() => onSelectFile?.(file.id)}
            type="button"
            variant={file.selected ? "secondary" : "ghost"}
          >
            <FileIcon className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{file.path}</span>
            {statusLabel && (
              <span className="text-xs text-muted-foreground">{statusLabel(file)}</span>
            )}
            {(file.additions !== undefined || file.deletions !== undefined) && (
              <span className="flex shrink-0 gap-1 font-mono text-xs tabular-nums">
                {file.additions !== undefined && (
                  <span className="text-emerald-600">+{file.additions}</span>
                )}
                {file.deletions !== undefined && (
                  <span className="text-destructive">-{file.deletions}</span>
                )}
              </span>
            )}
          </Button>
        </li>
      ))}
    </ul>
  )
}

export function ChatReviewDiffHost({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-review-diff-host"
      className={cn(
        "min-h-0 min-w-0 overflow-auto border-t bg-muted/20 font-mono text-xs",
        className
      )}
      {...props}
    />
  )
}

type ChatPullRequestCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode
  branch?: ReactNode
  status?: ReactNode
  actions?: ReactNode
}

export function ChatPullRequestCard({
  className,
  title,
  branch,
  status,
  actions,
  children,
  ...props
}: ChatPullRequestCardProps) {
  return (
    <article
      data-slot="chat-pull-request-card"
      className={cn("m-2 rounded-xl border bg-card p-3 text-card-foreground", className)}
      {...props}
    >
      <div className="flex items-start gap-2">
        <PullRequestOpenIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {(branch || status) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {branch && (
                <span className="inline-flex items-center gap-1">
                  <BranchIcon className="size-3" />
                  {branch}
                </span>
              )}
              {status}
            </div>
          )}
        </div>
        {actions}
      </div>
      {children && <div className="mt-3 text-sm">{children}</div>}
    </article>
  )
}

export function ChatTerminalPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-terminal-panel"
      className={cn("flex size-full min-h-0 flex-col bg-background", className)}
      {...props}
    />
  )
}

type ChatTerminalTabsProps = HTMLAttributes<HTMLDivElement> & {
  tabs: readonly ChatTerminalTabDescriptor[]
  activeTabId?: string
  onSelectTab?: (tabId: string) => void
  selectTabLabel?: (tab: ChatTerminalTabDescriptor) => string
  statusLabel?: (status: ChatTerminalStatus) => ReactNode
}

export function ChatTerminalTabs({
  className,
  tabs,
  activeTabId,
  onSelectTab,
  selectTabLabel,
  statusLabel,
  ...props
}: ChatTerminalTabsProps) {
  return (
    <div
      data-slot="chat-terminal-tabs"
      className={cn("flex min-h-9 items-center gap-0.5 overflow-x-auto border-b px-2", className)}
      role="tablist"
      {...props}
    >
      {tabs.map((tab) => (
        <Button
          aria-label={selectTabLabel?.(tab)}
          aria-selected={tab.id === activeTabId}
          className="h-7 max-w-56 gap-1.5 px-2 font-normal"
          data-state={tab.status}
          key={tab.id}
          onClick={() => onSelectTab?.(tab.id)}
          role="tab"
          size="sm"
          type="button"
          variant={tab.id === activeTabId ? "secondary" : "ghost"}
        >
          <TerminalIcon className="shrink-0" />
          <span className="truncate">{tab.title}</span>
          {tab.status && statusLabel && (
            <span className="text-xs text-muted-foreground">{statusLabel(tab.status)}</span>
          )}
        </Button>
      ))}
    </div>
  )
}

type ChatTerminalStatusProps = HTMLAttributes<HTMLDivElement> & {
  status: ChatTerminalStatus
}

export function ChatTerminalStatusBar({ className, status, ...props }: ChatTerminalStatusProps) {
  return (
    <div
      data-slot="chat-terminal-status"
      data-state={status}
      role="status"
      className={cn(
        "flex min-h-7 items-center gap-2 border-t px-2 text-xs text-muted-foreground",
        "data-[state=failed]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

export function ChatTerminalOutputHost({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-terminal-output-host"
      className={cn("min-h-0 flex-1 overflow-hidden bg-background font-mono text-xs", className)}
      {...props}
    />
  )
}

export type {
  ChatPlanStepProps,
  ChatPullRequestCardProps,
  ChatReviewFileListProps,
  ChatSourceGroupProps,
  ChatSourceItemProps,
  ChatSubagentGroupProps,
  ChatSubagentItemProps,
  ChatSummarySectionProps,
  ChatTerminalStatusProps,
  ChatTerminalTabsProps,
}
