import type {
  AgentId,
  CodexPermissionsMode,
  ThreadInputBlock,
  ThreadInteraction,
  ThreadTimelineItem,
  ThreadTimelineProjectedItem,
} from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import {
  type ChatActivityState,
  ChatAgentCard,
  ChatArtifactPanel,
  ChatAssistantMessage,
  ChatBrowserPanel,
  ChatCommandBlock,
  ChatComposerAttachmentList,
  ChatComposerBanner,
  ChatComposerBody,
  ChatComposerControl,
  ChatComposerDock,
  type ChatComposerDocument,
  ChatComposerEditor,
  ChatComposerFooter,
  ChatComposerForm,
  ChatComposerFrame,
  ChatComposerHeader,
  ChatComposerMeter,
  ChatComposerSubmit,
  ChatComposerTextarea,
  ChatComposerUtilityBar,
  ChatContextChip,
  ChatFileChange,
  ChatFileChanges,
  ChatFixedTurnSummary,
  ChatFixedTurnSummaryItem,
  ChatGeneratedImage,
  ChatGeneratedImageGrid,
  ChatGoalPanel,
  ChatHeader,
  ChatHeaderBreadcrumb,
  ChatHeaderStatus,
  ChatHeaderTitle,
  ChatImagePreviewPanel,
  ChatInlineNotice,
  ChatMainColumn,
  ChatMarkdownHostContext,
  ChatMcpAppPanel,
  ChatMcpElicitationRequest,
  ChatMessageContent,
  ChatPanel,
  ChatPanelContent,
  ChatPanelEmptyState,
  ChatPanelLauncher,
  type ChatPanelLauncherItem,
  ChatPanelSection,
  type ChatPanelTabDescriptor,
  ChatPanelToggle,
  type ChatPanelVisibility,
  ChatPendingInteractionBody,
  ChatPendingInteractionFooter,
  ChatPendingOption,
  ChatPendingQuestion,
  ChatPendingTextInput,
  ChatPermissionRequest,
  ChatPlanCard,
  ChatPlanPanel,
  ChatPlanStep,
  ChatQueuedInputItem,
  ChatQueuedInputList,
  ChatReasoning,
  ChatReasoningContent,
  ChatReasoningTrigger,
  ChatReviewDiffHost,
  type ChatReviewFileDescriptor,
  ChatReviewFileList,
  ChatReviewPanel,
  ChatScrollToLatest,
  type ChatSourceDescriptor,
  ChatSourceGroup,
  ChatSourceItem,
  ChatSourcesPanel,
  type ChatSubagentDescriptor,
  ChatSubagentGroup,
  ChatSubagentItem,
  ChatSubagentsPanel,
  ChatTimeline,
  ChatTimelineEvent,
  ChatTimelineItem,
  ChatTimelineState,
  ChatTodoItem,
  ChatTodoList,
  ChatTool,
  ChatToolCode,
  ChatToolContent,
  ChatToolSection,
  ChatToolTrigger,
  ChatTurnGroup,
  ChatTurnNotice,
  ChatUserInputRequest,
  ChatUserMessage,
  ChatWorkspaceShell,
  chatComposerDocumentToInput,
  createChatComposerDocument,
  createChatComposerDocumentFromInput,
  extractChatCodeComments,
  serializeChatComposerDocument,
} from "@cypheria/ui/components/chat"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import {
  AgentIcon,
  ArrowDownIcon,
  BranchIcon,
  ChatIcon,
  CheckIcon,
  ClipIcon,
  CloseBoldIcon,
  CollapseIcon,
  DockIcon,
  ExpandIcon,
  FileIcon,
  FileImageIcon,
  FolderIcon,
  GlobeIcon,
  LockKeyHoleIcon,
  McpIcon,
  PinIcon,
  PlusIcon,
  PullRequestOpenIcon,
  SearchIcon,
  SidebarRightIcon,
  TasksIcon,
} from "@cypheria/ui/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@cypheria/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@cypheria/ui/components/tooltip"
import type { I18n } from "@lingui/core"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import { MoreHorizontal } from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type {
  ComposerDraft,
  ComposerDraftAttachment,
  PanelLayoutCheckpoint,
} from "../../../ipc/src/index.js"
import { BrowserPane } from "../browser/browser-pane.js"
import { useThreadMarkdownHost } from "../chat-markdown-host.js"
import {
  clientStateStore,
  composerDraftAtom,
  composerEnterBehaviorAtom,
  composerPlainTextModeAtom,
  defaultTerminalLocationAtom,
  followUpQueueModeAtom,
  gitReviewBaseAtom,
  gitReviewSourceAtom,
  panelLayoutAtom,
  projectlessWorkspaceRootAtom,
  showBottomPanelControlAtom,
  showContextWindowUsageAtom,
  summaryAtom,
} from "../client-state.js"
import { type CodexRenderRow, splitCodexRenderGroups } from "../codex-render-groups.js"
import {
  COMPOSER_DRAFT_WRITE_DELAY_MS,
  deleteDraftAttachments,
  draftAttachmentToInputBlock,
  inputBlocksToComposerDraft,
  isOwnedDraftAttachment,
  saveFileDraftAttachment,
  verifyDraftAttachments,
} from "../composer-draft-storage.js"
import { ensureCypheriaClient } from "../cypheria-client.js"
import { reviewFocusAtom, reviewPanelRequestAtom } from "../deep-links.js"
import { Route } from "../routes/index.js"
import { sidebarData, sidebarQueryKeys } from "../sidebar-data.js"
import { desktopClientStorage } from "../storage.js"
import {
  type ConversationSubmitMode,
  ThreadConversationController,
} from "../thread-conversation-controller.js"
import { ThreadPullRequestPanel } from "./code-review/thread-panel.js"
import { codeReviewPrompt } from "./code-review-prompt.js"
import { CodexSummary } from "./codex-summary.js"
import { ComposerModelSelector } from "./composer-model-selector.js"
import { ContextUsage } from "./context-usage.js"
import { useExtensionCatalog } from "./extensions/catalog.js"
import { ElicitationForm } from "./extensions/elicitation-form.js"
import { ExtensionAppPanel, extensionTabId } from "./extensions/extension-app-panel.js"
import { ExtensionIcon } from "./extensions/extension-icon.js"
import { ExtensionFileViewers } from "./extensions/file-viewers.js"
import { ExtensionContextAttachments } from "./extensions/model-context.js"
import { ToolCallApp } from "./extensions/tool-call-app.js"
import {
  type ExtensionWorkspace,
  ExtensionWorkspaceContext,
} from "./extensions/workspace-context.js"
import { fileTabId, parseFileTabId, withOpenedTab } from "./file-tabs.js"
import { type AgentReviewComment, GitReviewPanel } from "./git-review-panel.js"
import { type HookStats, HookStatsButton } from "./hook-stats-dialog.js"
import { ProjectCreateDialog } from "./project-create-dialog.js"
import { type ThreadFileRef, ThreadFilesPanel } from "./thread-files-panel.js"
import { ThreadGitActions } from "./thread-git-actions.js"
import { useWorkspaceTerminals, WorkspaceTerminalView } from "./workspace-terminal.js"

const agentDisplayNames: Partial<Record<string, string>> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
}

const jsonRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const formatted = (value: unknown): string => {
  if (value == null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const draftEditorDocument = (draft: ComposerDraft): ChatComposerDocument | null =>
  draft.blocks
    ? createChatComposerDocumentFromInput(
        draft.blocks.filter(
          (block): block is Extract<ThreadInputBlock, { type: "text" | "reference" }> =>
            block.type === "text" || block.type === "reference"
        )
      )
    : null

const draftAttachmentName = (attachment: ComposerDraftAttachment): string =>
  attachment.kind === "browser-tab"
    ? attachment.title
    : attachment.kind === "selected-text"
      ? "Selected text"
      : attachment.name

const draftAttachmentMimeType = (attachment: ComposerDraftAttachment): string => {
  if (isOwnedDraftAttachment(attachment)) return attachment.attachment.mimeType
  if (attachment.kind === "resource-link") return attachment.mimeType ?? "resource-link"
  if (attachment.kind === "selected-text" || attachment.kind === "app-context") {
    return "text/plain"
  }
  return attachment.kind
}

const activityState = (status?: string): ChatActivityState => {
  if (status === "completed") return "completed"
  if (status === "failed" || status === "cancelled") return "error"
  if (status === "pending") return "waiting"
  if (status === "running") return "running"
  return "idle"
}

const activityLabel = (i18n: I18n, status?: string): string => {
  if (status === "completed")
    return i18n._(msg({ id: "chat.state.completed", message: "Completed" }))
  if (status === "failed") return i18n._(msg({ id: "chat.state.failed", message: "Failed" }))
  if (status === "cancelled")
    return i18n._(msg({ id: "chat.state.cancelled", message: "Cancelled" }))
  if (status === "pending") return i18n._(msg({ id: "chat.state.pending", message: "Pending" }))
  if (status === "running") return i18n._(msg({ id: "chat.state.running", message: "Running" }))
  return i18n._(msg({ id: "chat.state.ready", message: "Ready" }))
}

const itemPayload = (item: ThreadTimelineItem): Record<string, unknown> => {
  if (item.type === "harness") return jsonRecord(item.payload)
  return jsonRecord(item.harnessData?.payload)
}

function TimelineItemView({
  entry,
  actionBusy,
  onFork,
  onRewind,
  renderKind,
}: {
  entry: ThreadTimelineProjectedItem
  actionBusy?: boolean
  onFork?: (entry: ThreadTimelineProjectedItem) => void
  onRewind?: (entry: ThreadTimelineProjectedItem) => void
  renderKind?: CodexRenderRow["kind"]
}) {
  const { i18n } = useLingui()
  const item = entry.item
  if (item.type === "message") {
    const forkAction =
      item.boundary === "turn-user" || item.boundary === "assistant-final" ? onFork : undefined
    const rewindAction = item.boundary === "turn-user" ? onRewind : undefined
    if (renderKind === "plan") {
      return (
        <ChatTimelineItem kind="activity">
          <ChatPlanCard>
            <ChatMessageContent isAnimating={false}>{item.text}</ChatMessageContent>
          </ChatPlanCard>
        </ChatTimelineItem>
      )
    }
    return (
      <div className="group/message relative">
        <ChatTimelineItem kind={renderKind === "activity" ? "activity" : item.role}>
          {item.role === "user" ? (
            <>
              {item.origin ? (
                <p className="mb-1 text-right text-muted-foreground text-xs">
                  {i18n._(
                    msg({ id: "chat.message.fromApp", message: `Sent by ${item.origin.title}` })
                  )}
                </p>
              ) : null}
              <ChatUserMessage>{item.text}</ChatUserMessage>
            </>
          ) : (
            <ChatAssistantMessage>
              <ChatMessageContent isAnimating={false}>{item.text}</ChatMessageContent>
            </ChatAssistantMessage>
          )}
        </ChatTimelineItem>
        <div className="absolute -bottom-7 right-0 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 data-[state=open]:opacity-100">
          {item.role === "assistant" && (item as { hookStats?: HookStats | null }).hookStats ? (
            <HookStatsButton stats={(item as { hookStats?: HookStats | null }).hookStats} />
          ) : null}
          {forkAction || rewindAction ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={i18n._(
                      msg({ id: "chat.message.actions", message: "Message actions" })
                    )}
                    className="size-7"
                    disabled={actionBusy}
                    size="icon"
                    variant="ghost"
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {rewindAction ? (
                  <DropdownMenuItem onClick={() => rewindAction(entry)}>
                    <Trans id="chat.message.rewind">Rewind to here</Trans>
                  </DropdownMenuItem>
                ) : null}
                {forkAction ? (
                  <DropdownMenuItem onClick={() => forkAction(entry)}>
                    <BranchIcon />
                    <Trans id="chat.message.fork">Fork in new chat</Trans>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    )
  }
  if (item.type === "reasoning") {
    return (
      <ChatTimelineItem kind="activity" state="running">
        <ChatReasoning>
          <ChatReasoningTrigger
            label={i18n._(msg({ id: "chat.reasoning", message: "Reasoning" }))}
          />
          <ChatReasoningContent>{item.text}</ChatReasoningContent>
        </ChatReasoning>
      </ChatTimelineItem>
    )
  }
  if (item.type === "command") {
    const state = activityState(item.status)
    return (
      <ChatTimelineItem kind="activity" state={state}>
        <ChatCommandBlock
          command={item.command}
          duration={item.durationMs == null ? undefined : `${item.durationMs} ms`}
          output={item.output || undefined}
          state={state}
          stateLabel={activityLabel(i18n, item.status)}
          title={item.cwd ?? i18n._(msg({ id: "chat.command", message: "Command" }))}
        />
      </ChatTimelineItem>
    )
  }
  if (item.type === "diff") {
    return (
      <ChatTimelineItem kind="activity" state={activityState(item.status)}>
        <ChatFileChanges
          title={i18n._(msg({ id: "chat.fileChanges", message: "File changes" }))}
          summary={`${item.changes.length} ${i18n._(msg({ id: "chat.files", message: "files" }))}`}
        >
          {item.changes.map((change) => (
            <ChatFileChange
              key={`${item.itemId}:${change.path}`}
              path={change.path}
              statusLabel={change.kind}
              additions={change.diff.split("\n").filter((line) => line.startsWith("+")).length}
              deletions={change.diff.split("\n").filter((line) => line.startsWith("-")).length}
            />
          ))}
        </ChatFileChanges>
      </ChatTimelineItem>
    )
  }
  if (item.type === "tool") {
    const state = activityState(item.status)
    return (
      <ChatTimelineItem kind="activity" state={state}>
        <ChatTool state={state}>
          <ChatToolTrigger
            state={state}
            stateLabel={activityLabel(i18n, item.status)}
            title={item.name}
          />
          <ChatToolContent>
            {item.input != null ? (
              <ChatToolSection label={i18n._(msg({ id: "chat.tool.input", message: "Input" }))}>
                <ChatToolCode>{formatted(item.input)}</ChatToolCode>
              </ChatToolSection>
            ) : null}
            {item.output != null ? (
              <ChatToolSection label={i18n._(msg({ id: "chat.tool.output", message: "Output" }))}>
                <ChatToolCode>{formatted(item.output)}</ChatToolCode>
              </ChatToolSection>
            ) : null}
            {item.error ? (
              <ChatToolSection
                label={i18n._(msg({ id: "chat.tool.error", message: "Error" }))}
                tone="error"
              >
                {item.error}
              </ChatToolSection>
            ) : null}
          </ChatToolContent>
        </ChatTool>
        {item.app && item.status !== "running" ? (
          <ToolCallApp app={item.app} itemId={item.itemId} />
        ) : null}
      </ChatTimelineItem>
    )
  }
  if (item.type === "plan") {
    return (
      <ChatTimelineItem kind="activity">
        <ChatPlanCard>
          <ChatTodoList>
            {item.entries.map((step) => (
              <ChatTodoItem
                key={`${item.itemId}:${step.status}:${step.text}`}
                state={activityState(step.status === "in_progress" ? "running" : step.status)}
                stateLabel={step.status}
              >
                {step.text}
              </ChatTodoItem>
            ))}
          </ChatTodoList>
        </ChatPlanCard>
      </ChatTimelineItem>
    )
  }
  if (item.type === "artifact") {
    if (item.kind === "image") {
      return (
        <ChatTimelineItem kind="assistant">
          <ChatGeneratedImageGrid>
            <ChatGeneratedImage alt={item.name} src={item.uri} />
          </ChatGeneratedImageGrid>
        </ChatTimelineItem>
      )
    }
    return (
      <ChatTimelineItem kind="activity">
        <ChatTimelineEvent type="external-event" title={item.name} description={item.uri} />
      </ChatTimelineItem>
    )
  }
  if (item.type === "status") {
    return (
      <ChatTimelineItem kind="system" state={activityState(item.status)}>
        <ChatTimelineEvent
          state={activityState(item.status)}
          title={item.message}
          type={item.harnessData?.nativeType.includes("rerout") ? "model-rerouted" : "worked-for"}
        />
      </ChatTimelineItem>
    )
  }
  if (item.type === "approval") {
    return (
      <ChatTimelineItem kind="system">
        <ChatInlineNotice>
          {item.title ?? i18n._(msg({ id: "chat.approval", message: "Approval" }))}: {item.message}
        </ChatInlineNotice>
      </ChatTimelineItem>
    )
  }
  if (item.type === "error") {
    return (
      <ChatTimelineItem kind="system" state="error">
        <ChatTurnNotice title={item.code} tone="error">
          {item.message}
        </ChatTurnNotice>
      </ChatTimelineItem>
    )
  }
  const payload = itemPayload(item)
  const nativeType =
    item.type === "harness"
      ? item.nativeType
      : i18n._(msg({ id: "chat.unknownItem", message: "Unknown item" }))
  if (nativeType === "turn/diff/updated") {
    return (
      <ChatTimelineItem kind="activity">
        <ChatTimelineEvent
          type="turn-diff"
          title={i18n._(msg({ id: "chat.turnDiffAvailable", message: "Turn diff available" }))}
        />
      </ChatTimelineItem>
    )
  }
  if (nativeType.includes("subAgentActivity")) {
    const raw = jsonRecord(payload.item ?? payload)
    return (
      <ChatTimelineItem kind="activity" state={activityState(item.status)}>
        <ChatAgentCard
          state={activityState(item.status)}
          stateLabel={activityLabel(i18n, item.status)}
          title={String(
            raw.agentPath ??
              raw.agentThreadId ??
              i18n._(msg({ id: "chat.subagent", message: "Subagent" }))
          )}
        >
          {String(raw.kind ?? "activity")}
        </ChatAgentCard>
      </ChatTimelineItem>
    )
  }
  return (
    <ChatTimelineItem kind="system" state={activityState(item.status)}>
      <ChatTimelineEvent
        description={formatted(payload)}
        state={activityState(item.status)}
        title={nativeType}
        type="external-event"
      />
    </ChatTimelineItem>
  )
}

export function VirtualTimeline({
  items,
  codex,
  activeTurnId,
  loading,
  loadingOlder,
  hasOlder,
  onLoadOlder,
  actionBusy,
  onForkAssistant,
  onForkUser,
  onRewind,
}: {
  items: readonly ThreadTimelineProjectedItem[]
  codex: boolean
  activeTurnId: string | null
  loading: boolean
  loadingOlder: boolean
  hasOlder: boolean
  onLoadOlder: () => void
  actionBusy?: boolean
  onForkAssistant?: (entry: ThreadTimelineProjectedItem) => void
  onForkUser?: (entry: ThreadTimelineProjectedItem) => void
  onRewind?: (entry: ThreadTimelineProjectedItem) => void
}) {
  const { i18n } = useLingui()
  const parentRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const initialPositioned = useRef(false)
  const rows = useMemo(
    () =>
      codex
        ? splitCodexRenderGroups(items, activeTurnId)
        : items.map((item) => ({
            id: `${item.turnId ?? "thread"}:${item.item.itemId}`,
            items: [item],
            kind: "activity" as const,
            turnId: item.turnId,
          })),
    [activeTurnId, codex, items]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 160,
    getItemKey: (index) => {
      return rows[index]?.id ?? index
    },
    getScrollElement: () => parentRef.current,
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useLayoutEffect(() => {
    if (!rows.length || initialPositioned.current) return
    initialPositioned.current = true
    virtualizer.scrollToIndex(rows.length - 1, { align: "end", behavior: "auto" })
  }, [rows.length, virtualizer])

  useLayoutEffect(() => {
    if (!following || !rows.length) return
    virtualizer.scrollToIndex(rows.length - 1, { align: "end", behavior: "auto" })
  }, [following, rows.length, virtualizer])

  return (
    <div className="relative min-h-0 flex-1">
      <ChatTimeline
        className="scroll-auto"
        onScroll={(event) => {
          const element = event.currentTarget
          const bottomDistance = element.scrollHeight - element.scrollTop - element.clientHeight
          setFollowing(bottomDistance < 96)
          if (element.scrollTop < 160 && hasOlder && !loadingOlder) onLoadOlder()
        }}
        ref={parentRef}
      >
        {loading ? (
          <ChatTimelineState state="loading">
            <Trans id="chat.loadingConversation">Loading conversation…</Trans>
          </ChatTimelineState>
        ) : rows.length === 0 ? (
          <ChatTimelineState state="empty">
            <Trans id="chat.empty.start">Start a conversation</Trans>
          </ChatTimelineState>
        ) : (
          <div
            className="relative mx-auto w-full max-w-(--chat-content-max-width) px-2 pt-8 sm:px-3"
            style={{ height: virtualizer.getTotalSize() + 190 }}
          >
            {loadingOlder ? (
              <div className="absolute top-2 inset-x-0 text-center text-xs text-muted-foreground">
                <Trans id="chat.loadingEarlier">Loading earlier messages…</Trans>
              </div>
            ) : null}
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index]
              if (!row) return null
              return (
                <div
                  className="absolute top-0 left-0 w-full px-2 pb-8 sm:px-3"
                  data-index={virtualItem.index}
                  data-render-kind={row.kind}
                  data-current-commentary={
                    ("currentCommentary" in row && row.currentCommentary) || undefined
                  }
                  data-tool-group-start={
                    ("toolGroupStart" in row && row.toolGroupStart) || undefined
                  }
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${virtualItem.start + 32}px)` }}
                >
                  {row.kind === "tools" || row.kind === "subagents" ? (
                    <ChatTurnGroup
                      current={"toolGroupStart" in row && row.toolGroupStart}
                      kind={row.kind}
                      label={
                        row.kind === "tools"
                          ? i18n._(msg({ id: "chat.group.tools", message: "Tool activity" }))
                          : i18n._(
                              msg({ id: "chat.group.subagents", message: "Subagent activity" })
                            )
                      }
                    >
                      {row.items.map((entry) => (
                        <TimelineItemView
                          actionBusy={actionBusy}
                          entry={entry}
                          key={entry.item.itemId}
                          onFork={
                            entry.item.type === "message" &&
                            entry.item.boundary === "assistant-final"
                              ? onForkAssistant
                              : onForkUser
                          }
                          onRewind={onRewind}
                          renderKind={row.kind}
                        />
                      ))}
                    </ChatTurnGroup>
                  ) : (
                    row.items.map((entry) => (
                      <TimelineItemView
                        actionBusy={actionBusy}
                        entry={entry}
                        key={entry.item.itemId}
                        onFork={
                          entry.item.type === "message" && entry.item.boundary === "assistant-final"
                            ? onForkAssistant
                            : onForkUser
                        }
                        onRewind={onRewind}
                        renderKind={row.kind}
                      />
                    ))
                  )}
                </div>
              )
            })}
          </div>
        )}
      </ChatTimeline>
      {!following ? (
        <ChatScrollToLatest
          label={i18n._(msg({ id: "chat.scrollToLatest", message: "Scroll to latest" }))}
          onClick={() => {
            virtualizer.scrollToIndex(rows.length - 1, { align: "end", behavior: "auto" })
            setFollowing(true)
          }}
        >
          <ArrowDownIcon />
        </ChatScrollToLatest>
      ) : null}
    </div>
  )
}

function PendingInteraction({
  interaction,
  onRespond,
}: {
  interaction: ThreadInteraction
  onRespond: (response: Parameters<ThreadConversationController["respond"]>[1]) => void
}) {
  const { i18n } = useLingui()
  const [selected, setSelected] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [elicitation, setElicitation] = useState("")
  const isPermission = interaction.kind === "permission"
  const isElicitation =
    interaction.harness?.agentId === "codex" &&
    interaction.harness.nativeType.includes("mcp_server.elicitation")
  const metadata = jsonRecord(interaction.harness?.metadata)
  const isComputerUse =
    isElicitation &&
    [metadata, jsonRecord(metadata.request), jsonRecord(metadata.elicitation)].some(
      (candidate) =>
        candidate.kind === "computerUseAppApproval" ||
        (typeof candidate.connectorName === "string" &&
          /computer[ -]?use/iu.test(candidate.connectorName))
    )
  const elevatedComputerUseRisk =
    isComputerUse &&
    [metadata, jsonRecord(metadata.request), jsonRecord(metadata.elicitation)].some(
      (candidate) => candidate.riskLevel === "high"
    )
  // Form elicitations, including OpenAI's extended fields, get a real form.
  const requestedSchema =
    isElicitation &&
    metadata.mode !== "url" &&
    Object.keys(jsonRecord(metadata.requestedSchema)).length > 0
      ? metadata.requestedSchema
      : null
  const Surface = isPermission
    ? ChatPermissionRequest
    : isElicitation
      ? ChatMcpElicitationRequest
      : ChatUserInputRequest
  return (
    <Surface
      badge={
        elevatedComputerUseRisk
          ? i18n._(msg({ id: "chat.computerUse.elevatedRisk", message: "Elevated risk" }))
          : undefined
      }
      description={interaction.message}
      title={
        interaction.title ??
        i18n._(msg({ id: "chat.interaction.actionRequired", message: "Action required" }))
      }
    >
      {isComputerUse ? (
        <ChatPendingInteractionBody>
          <ChatComposerBanner
            description={i18n._(
              msg({
                id: "chat.computerUse.disclosure",
                message:
                  "Computer Use can interact with apps on your computer and may capture screenshots. You can stop it at any time.",
              })
            )}
            title={i18n._(
              msg({ id: "chat.computerUse.firstUse", message: "Computer access request" })
            )}
            tone="warning"
          />
        </ChatPendingInteractionBody>
      ) : null}
      {interaction.questions?.length ? (
        <ChatPendingInteractionBody>
          {interaction.questions.map((question, questionIndex) => {
            const questionId = question.id ?? String(questionIndex)
            return (
              <ChatPendingQuestion
                description={question.question}
                key={questionId}
                legend={question.header}
              >
                {question.options.map((option) => {
                  const selectedAnswers = answers[questionId] ?? []
                  return (
                    <ChatPendingOption
                      description={option.description}
                      key={option.id}
                      label={option.label}
                      onClick={() =>
                        setAnswers((current) => ({
                          ...current,
                          [questionId]: question.multiple
                            ? selectedAnswers.includes(option.id)
                              ? selectedAnswers.filter((id) => id !== option.id)
                              : [...selectedAnswers, option.id]
                            : [option.id],
                        }))
                      }
                      selected={selectedAnswers.includes(option.id)}
                    />
                  )
                })}
                {question.custom ? (
                  <ChatPendingTextInput
                    aria-label={question.question}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [questionId]: event.currentTarget.value ? [event.currentTarget.value] : [],
                      }))
                    }
                    value={(answers[questionId] ?? [])[0] ?? ""}
                  />
                ) : null}
              </ChatPendingQuestion>
            )
          })}
        </ChatPendingInteractionBody>
      ) : interaction.options.length ? (
        <ChatPendingInteractionBody>
          {interaction.options.map((option) => (
            <ChatPendingOption
              description={option.description}
              key={option.id}
              label={option.label}
              onClick={() => setSelected(option.id)}
              selected={selected === option.id}
            />
          ))}
        </ChatPendingInteractionBody>
      ) : isElicitation && requestedSchema ? (
        <ChatPendingInteractionBody>
          <ElicitationForm
            schema={requestedSchema}
            onRespond={(action, content) =>
              onRespond({
                action,
                // Form values are JSON: strings, numbers, booleans, and string lists.
                ...(content
                  ? { content: content as Record<string, string | number | boolean | string[]> }
                  : {}),
                type: "elicitation",
              })
            }
          />
        </ChatPendingInteractionBody>
      ) : isElicitation ? (
        <ChatPendingInteractionBody>
          <ChatPendingTextInput
            aria-label={interaction.message}
            onChange={(event) => setElicitation(event.currentTarget.value)}
            value={elicitation}
          />
        </ChatPendingInteractionBody>
      ) : null}
      <ChatPendingInteractionFooter>
        {isPermission ? (
          <>
            <Button
              onClick={() => onRespond({ outcome: "deny", type: "permission" })}
              variant="ghost"
            >
              <Trans id="chat.interaction.deny">Deny</Trans>
            </Button>
            <Button onClick={() => onRespond({ outcome: "allow_once", type: "permission" })}>
              <Trans id="chat.interaction.allowOnce">Allow once</Trans>
            </Button>
            <Button
              onClick={() => onRespond({ outcome: "allow_always", type: "permission" })}
              variant="secondary"
            >
              <Trans id="chat.interaction.alwaysAllow">Always allow</Trans>
            </Button>
          </>
        ) : interaction.questions?.length ? (
          <>
            <Button onClick={() => onRespond({ type: "cancel" })} variant="ghost">
              <Trans id="common.cancel">Cancel</Trans>
            </Button>
            <Button
              disabled={interaction.questions.some(
                (question, index) => (answers[question.id ?? String(index)] ?? []).length === 0
              )}
              onClick={() => onRespond({ answers, type: "answers" })}
            >
              <Trans id="common.continue">Continue</Trans>
            </Button>
          </>
        ) : isElicitation && requestedSchema ? null : isElicitation ? (
          <>
            <Button
              onClick={() => onRespond({ action: "decline", type: "elicitation" })}
              variant="ghost"
            >
              <Trans id="chat.interaction.decline">Decline</Trans>
            </Button>
            <Button
              onClick={() =>
                onRespond({ action: "accept", content: elicitation, type: "elicitation" })
              }
            >
              <Trans id="common.continue">Continue</Trans>
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => onRespond({ type: "cancel" })} variant="ghost">
              <Trans id="common.cancel">Cancel</Trans>
            </Button>
            <Button
              disabled={!selected}
              onClick={() => selected && onRespond({ optionId: selected, type: "selection" })}
            >
              <Trans id="common.continue">Continue</Trans>
            </Button>
          </>
        )}
      </ChatPendingInteractionFooter>
    </Surface>
  )
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <ChatPanelEmptyState>{children}</ChatPanelEmptyState>
}

export function ConversationWorkspace({
  agentId,
  initialAppEntrypointId,
  initialPrompt,
  initialProjectId,
  initialSectionId,
  initialThreadId,
  codex,
}: {
  agentId: AgentId
  /** A plugin entry point to open in the side panel, such as a global App the chat began from. */
  initialAppEntrypointId?: string
  initialPrompt?: string
  initialProjectId?: string
  initialSectionId?: string
  initialThreadId?: string
  codex: boolean
}) {
  const { i18n } = useLingui()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const draftScopeId = initialThreadId ?? "new"
  const draftAtom = useMemo(() => composerDraftAtom(draftScopeId), [draftScopeId])
  const [persistedDraft, setPersistedDraft] = useAtom(draftAtom)
  const canPersistPanel =
    Boolean(initialThreadId) && window.cypheria?.bootstrap.windowRole === "main"
  const panelAtom = useMemo(
    () =>
      canPersistPanel
        ? panelLayoutAtom(initialThreadId as string)
        : atom<PanelLayoutCheckpoint | null>(null),
    [canPersistPanel, initialThreadId]
  )
  const [persistedPanelLayout, setPersistedPanelLayout] = useAtom(panelAtom)
  const summaryStateAtom = useMemo(() => summaryAtom(initialThreadId ?? "new"), [initialThreadId])
  /** The pull request the Pull request tab shows; null shows the Thread's own pull request. */
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null)
  const [summaryCheckpoint, setSummaryCheckpoint] = useAtom(summaryStateAtom)
  const summaryHostRef = useRef<HTMLDivElement>(null)
  const summaryToggleRef = useRef<HTMLButtonElement>(null)
  const [summaryHostWidth, setSummaryHostWidth] = useState(0)
  const activeDraftScopeRef = useRef(draftScopeId)
  const draftSnapshotRef = useRef<ComposerDraft | null>(persistedDraft)
  const draftWriteTimerRef = useRef<number | null>(null)
  const projectsQuery = useQuery({
    queryFn: () => sidebarData.listProjects(),
    queryKey: sidebarQueryKeys.projects(),
  })
  const desktopPreferences = {
    projectlessWorkspaceRoot: useAtomValue(projectlessWorkspaceRootAtom),
    followUpQueueMode: useAtomValue(followUpQueueModeAtom),
    composerPlainTextMode: useAtomValue(composerPlainTextModeAtom),
    composerEnterBehavior: useAtomValue(composerEnterBehaviorAtom),
    showContextWindowUsage: useAtomValue(showContextWindowUsageAtom),
  }
  const workspaceLayout = {
    defaultTerminalLocation: useAtomValue(defaultTerminalLocationAtom),
    showBottomPanelControl: useAtomValue(showBottomPanelControlAtom),
  }
  const project = projectsQuery.data?.data.find((item) => item.id === initialProjectId)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [projectCreateOpen, setProjectCreateOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [projectKeyboardIndex, setProjectKeyboardIndex] = useState<number | null>(null)
  const projectListRef = useRef<HTMLDivElement>(null)
  const projectSearchRef = useRef<HTMLInputElement>(null)
  const filteredProjects = useMemo(() => {
    const search = projectSearch.trim().toLocaleLowerCase()
    const projects = projectsQuery.data?.data ?? []
    if (!search) return projects
    return projects.filter((item) => item.name.toLocaleLowerCase().includes(search))
  }, [projectSearch, projectsQuery.data?.data])
  const projectVirtualizer = useVirtualizer({
    count: filteredProjects.length,
    estimateSize: () => 40,
    getItemKey: (index) => filteredProjects[index]?.id ?? index,
    getScrollElement: () => projectListRef.current,
    overscan: 6,
  })
  const [createWorktree, setCreateWorktree] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const gitRepositoryQuery = useQuery({
    enabled: !initialThreadId && Boolean(project?.roots[0]),
    queryFn: async () => (await ensureCypheriaClient()).git.discover(project?.roots[0] as string),
    queryKey: ["conversation-workspace", "git-repository", project?.roots[0]],
    retry: false,
  })
  const branchesQuery = useQuery({
    enabled: !initialThreadId && gitRepositoryQuery.isSuccess,
    queryFn: async () => (await ensureCypheriaClient()).git.branches(project?.roots[0] as string),
    queryKey: ["conversation-workspace", "git-branches", project?.roots[0]],
  })
  const localBranches = branchesQuery.data ?? []
  const currentBranch = localBranches.find((branch) => branch.current)?.name ?? null

  useEffect(() => {
    if (!projectPickerOpen) return
    setProjectKeyboardIndex(null)
    const frame = window.requestAnimationFrame(() => {
      projectSearchRef.current?.focus()
      projectVirtualizer.measure()
      const selectedIndex = filteredProjects.findIndex((item) => item.id === project?.id)
      if (selectedIndex >= 0) projectVirtualizer.scrollToIndex(selectedIndex, { align: "center" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [filteredProjects, project?.id, projectPickerOpen, projectVirtualizer])

  const [controller] = useState(
    () =>
      new ThreadConversationController({
        agentId,
        cwd: project?.roots[0],
        initialThreadId,
        projectId: initialProjectId,
        sectionId: initialSectionId,
        onThreadCreated: async (threadId) => {
          if (draftWriteTimerRef.current !== null) {
            window.clearTimeout(draftWriteTimerRef.current)
            draftWriteTimerRef.current = null
          }
          const previousScope = activeDraftScopeRef.current
          const draft = draftSnapshotRef.current
          if (draft) await clientStateStore.set(composerDraftAtom(threadId), draft)
          if (previousScope !== threadId) {
            await clientStateStore.set(composerDraftAtom(previousScope), null)
          }
          activeDraftScopeRef.current = threadId
          sidebarData.invalidate()
          await queryClient.invalidateQueries({ queryKey: sidebarQueryKeys.all })
          await navigate({ replace: true, search: { thread: threadId } })
        },
      })
  )
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  const [composer, setComposer] = useState(persistedDraft?.text ?? initialPrompt ?? "")
  const composerDocumentRef = useRef<ChatComposerDocument | null>(
    persistedDraft ? draftEditorDocument(persistedDraft) : null
  )
  const composerInput = useCallback((): ThreadInputBlock[] => {
    if (desktopPreferences?.composerPlainTextMode)
      return composer ? [{ text: composer, type: "text" }] : []
    const document = composerDocumentRef.current
    return chatComposerDocumentToInput(
      document && serializeChatComposerDocument(document) === composer
        ? document
        : createChatComposerDocument(composer)
    )
  }, [composer, desktopPreferences?.composerPlainTextMode])
  const [attachments, setAttachments] = useState<ComposerDraftAttachment[]>(
    persistedDraft?.attachments ?? []
  )
  const draftStatusRef = useRef<ComposerDraft["status"]>(persistedDraft?.status ?? "editing")
  const verifiedDraftScopeRef = useRef(false)
  const attachmentInput = useRef<HTMLInputElement>(null)
  const composerForm = useRef<HTMLFormElement>(null)
  const [composerEpoch, setComposerEpoch] = useState(0)
  const [timelineActionBusy, setTimelineActionBusy] = useState(false)
  const [timelineActionError, setTimelineActionError] = useState<Error | null>(null)
  const [rightVisibility, setRightVisibilityState] = useState<ChatPanelVisibility>(
    persistedPanelLayout?.right.visible ? "visible" : codex ? "visible" : "hidden"
  )
  const [bottomVisibility, setBottomVisibilityState] = useState<ChatPanelVisibility>(
    persistedPanelLayout?.bottom.visible ? "visible" : "hidden"
  )
  const [rightFullscreen, setRightFullscreenState] = useState(
    persistedPanelLayout?.right.fullscreen ?? false
  )
  const [wideViewport, setWideViewport] = useState(true)
  const [rightTab, setRightTabState] = useState<string | undefined>(
    persistedPanelLayout?.right.activeTab ?? "sources"
  )
  const [openRightTabs, setOpenRightTabsState] = useState<string[]>(
    persistedPanelLayout?.right.openTabs.length ? persistedPanelLayout.right.openTabs : ["sources"]
  )
  const [rightPanelSize, setRightPanelSizeState] = useState(persistedPanelLayout?.right.size ?? 420)
  const [bottomPanelSize, setBottomPanelSizeState] = useState(
    persistedPanelLayout?.bottom.size ?? 280
  )
  const panelDirtyRef = useRef(false)
  const markPanelDirty = useCallback(() => {
    panelDirtyRef.current = true
  }, [])
  const setRightVisibility = useCallback(
    (value: SetStateAction<ChatPanelVisibility>) => {
      markPanelDirty()
      setRightVisibilityState(value)
    },
    [markPanelDirty]
  )
  const setBottomVisibility = useCallback(
    (value: SetStateAction<ChatPanelVisibility>) => {
      markPanelDirty()
      setBottomVisibilityState(value)
    },
    [markPanelDirty]
  )
  const setRightFullscreen = useCallback(
    (value: SetStateAction<boolean>) => {
      markPanelDirty()
      setRightFullscreenState(value)
    },
    [markPanelDirty]
  )
  const setRightTab = useCallback(
    (value: SetStateAction<string | undefined>) => {
      markPanelDirty()
      setRightTabState(value)
    },
    [markPanelDirty]
  )
  const setOpenRightTabs = useCallback(
    (value: SetStateAction<string[]>) => {
      markPanelDirty()
      setOpenRightTabsState(value)
    },
    [markPanelDirty]
  )
  const terminals = useWorkspaceTerminals(snapshot.threadId ?? undefined)
  useEffect(() => {
    const element = summaryHostRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSummaryHostWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const summaryMode =
    summaryHostWidth < 1096 ? "overlay" : summaryHostWidth <= 1536 ? "shift" : "gutter"
  useEffect(() => {
    if (summaryCheckpoint.open) return
    const surface = summaryHostRef.current?.parentElement?.querySelector(
      '[data-slot="chat-summary-surface"]'
    )
    if (surface?.contains(document.activeElement)) summaryToggleRef.current?.focus()
  }, [summaryCheckpoint.open])

  useEffect(() => {
    if (!canPersistPanel || !panelDirtyRef.current) return
    const timer = window.setTimeout(() => {
      const checkpoint: PanelLayoutCheckpoint = {
        bottom: {
          activeTab: bottomVisibility === "visible" ? "terminal" : null,
          openTabs: bottomVisibility === "closed" ? [] : ["terminal"],
          size: bottomPanelSize,
          visible: bottomVisibility === "visible",
        },
        focusedPanel:
          rightVisibility === "visible"
            ? "right"
            : bottomVisibility === "visible"
              ? "bottom"
              : null,
        right: {
          activeTab: rightTab ?? null,
          fullscreen: rightFullscreen,
          openTabs: openRightTabs,
          size: rightPanelSize,
          visible: rightVisibility === "visible",
        },
      }
      void setPersistedPanelLayout(checkpoint)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [
    bottomPanelSize,
    bottomVisibility,
    canPersistPanel,
    openRightTabs,
    rightFullscreen,
    rightPanelSize,
    rightTab,
    rightVisibility,
    setPersistedPanelLayout,
  ])

  useEffect(() => {
    if (!persistedDraft || verifiedDraftScopeRef.current) return
    verifiedDraftScopeRef.current = true
    let disposed = false
    void verifyDraftAttachments(persistedDraft)
      .then((verified) => {
        if (disposed) return
        setAttachments(verified.attachments)
        draftSnapshotRef.current = verified
        void setPersistedDraft(verified)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [persistedDraft, setPersistedDraft])

  useEffect(() => {
    const draft: ComposerDraft = {
      attachments,
      blocks: composerInput(),
      status: draftStatusRef.current,
      text: composer,
      updatedAt: Date.now(),
    }
    draftSnapshotRef.current = draft
    const timer = window.setTimeout(() => {
      draftWriteTimerRef.current = null
      void setPersistedDraft(
        draft && (draft.text.length > 0 || draft.attachments.length > 0) ? draft : null
      )
    }, COMPOSER_DRAFT_WRITE_DELAY_MS)
    draftWriteTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (draftWriteTimerRef.current === timer) draftWriteTimerRef.current = null
    }
  }, [attachments, composer, composerInput, setPersistedDraft])

  useEffect(() => {
    const flush = () => {
      const draft = draftSnapshotRef.current
      void clientStateStore.set(
        composerDraftAtom(activeDraftScopeRef.current),
        draft && (draft.text.length > 0 || draft.attachments.length > 0) ? draft : null
      )
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [])

  useEffect(() => {
    controller.setCwd(
      project?.roots[0] ?? desktopPreferences?.projectlessWorkspaceRoot ?? undefined
    )
  }, [controller, project?.roots, desktopPreferences?.projectlessWorkspaceRoot])

  useEffect(() => {
    controller.setCreationTarget({
      projectId: initialProjectId,
      ...(!createWorktree && project?.roots[0] && selectedBranch
        ? { checkout: { cwd: project.roots[0], target: selectedBranch } }
        : {}),
      ...(createWorktree && project?.roots[0]
        ? {
            worktree: {
              cwd: project.roots[0],
              ...(selectedBranch ? { startPoint: selectedBranch } : {}),
            },
          }
        : {}),
    })
  }, [controller, createWorktree, initialProjectId, project?.roots, selectedBranch])

  useEffect(() => {
    if (selectedBranch && localBranches.some((branch) => branch.name === selectedBranch)) return
    setSelectedBranch(currentBranch ?? localBranches[0]?.name ?? null)
  }, [currentBranch, localBranches, selectedBranch])

  useEffect(() => {
    void controller.connect()
    return () => controller.dispose()
  }, [controller])

  useEffect(() => {
    if (!snapshot.thread || !project) return
    let disposed = false
    void ensureCypheriaClient()
      .then((client) =>
        client.threads.workspace.sync({
          mode: "safe-additive",
          threadId: snapshot.thread?.id as string,
        })
      )
      .then((result) => {
        if (!disposed && result.changed) void controller.refresh()
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [controller, project, snapshot.thread])

  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1181px)")
    if (!media) return
    const update = () => setWideViewport(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  const threadId = snapshot.threadId
  const goalQuery = useQuery({
    enabled: codex && Boolean(threadId),
    queryFn: async () =>
      (await ensureCypheriaClient()).harnesses.codex.threads.goal.get({
        threadId: threadId as string,
      }),
    queryKey: ["codex", "thread", threadId, "goal"],
  })
  const queueQuery = useQuery({
    enabled: codex && Boolean(threadId),
    queryFn: async () =>
      (await ensureCypheriaClient()).harnesses.codex.threads.queue.list({
        limit: 100,
        threadId: threadId as string,
      }),
    queryKey: ["codex", "thread", threadId, "queue"],
  })
  const usageQuery = useQuery({
    enabled: codex && Boolean(threadId),
    queryFn: async () =>
      (await ensureCypheriaClient()).harnesses.codex.threads.usage(threadId as string),
    queryKey: ["codex", "thread", threadId, "usage"],
  })
  const contextUsageQuery = useQuery({
    enabled: Boolean(threadId),
    queryFn: async () =>
      (await ensureCypheriaClient()).threads.contextUsage.get(threadId as string),
    queryKey: ["thread", threadId, "context-usage"],
  })
  useEffect(() => {
    if (!threadId) return
    let unsubscribe: (() => void) | undefined
    let disposed = false
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribe = client.threads.contextUsage.subscribe(threadId, (usage) => {
        queryClient.setQueryData(["thread", threadId, "context-usage"], usage)
      })
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [queryClient, threadId])
  const serverConfigQuery = useQuery({
    enabled: codex,
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    queryKey: ["settings", "server-config"],
  })

  useEffect(() => {
    if (!codex || !threadId) return
    let unsubscribe: () => void = () => undefined
    void ensureCypheriaClient().then((client) => {
      unsubscribe = client.on("thread.event.notification", ({ payload }) => {
        if (payload.threadId !== threadId || payload.event.type !== "harness") return
        const type = payload.event.nativeType
        if (type.includes("goal"))
          void queryClient.invalidateQueries({ queryKey: ["codex", "thread", threadId, "goal"] })
        if (type.includes("queue"))
          void queryClient.invalidateQueries({ queryKey: ["codex", "thread", threadId, "queue"] })
        if (type.includes("token_usage") || type.includes("tokenUsage"))
          void queryClient.invalidateQueries({ queryKey: ["codex", "thread", threadId, "usage"] })
      })
    })
    return () => unsubscribe()
  }, [codex, queryClient, threadId])

  const sources = useMemo<ChatSourceDescriptor[]>(
    () =>
      snapshot.items.flatMap(({ item }): ChatSourceDescriptor[] => {
        if (item.type === "artifact")
          return [
            { id: item.itemId, kind: "created" as const, label: item.name, description: item.uri },
          ]
        if (item.type !== "tool" || !item.name.toLowerCase().includes("web")) return []
        const output = Array.isArray(item.output) ? item.output : []
        return output.flatMap((candidate, index) => {
          const source = jsonRecord(candidate)
          if (typeof source.url !== "string") return []
          return [
            {
              id: `${item.itemId}:${index}`,
              kind: "web" as const,
              label: typeof source.title === "string" ? source.title : source.url,
              description: source.url,
            },
          ]
        })
      }),
    [snapshot.items]
  )
  const subagents = useMemo<ChatSubagentDescriptor[]>(
    () =>
      snapshot.items.flatMap(({ item }) => {
        const payload = itemPayload(item)
        const raw = jsonRecord(payload.item ?? payload)
        if (
          !String(
            item.type === "harness" ? item.nativeType : item.harnessData?.nativeType
          ).includes("subAgent")
        )
          return []
        return [
          {
            description: String(
              raw.kind ??
                i18n._(
                  msg({ id: "chat.subagent.codexCollaboration", message: "Codex collaboration" })
                )
            ),
            id: item.itemId,
            state: activityState("status" in item ? String(item.status) : undefined),
            title: String(
              raw.agentPath ??
                raw.agentThreadId ??
                i18n._(msg({ id: "chat.subagent", message: "Subagent" }))
            ),
          },
        ]
      }),
    [snapshot.items, i18n]
  )
  const plans = snapshot.items.filter((entry) => entry.item.type === "plan")
  const diffs = snapshot.items.filter((entry) => entry.item.type === "diff")
  const artifacts = snapshot.items.filter((entry) => entry.item.type === "artifact")
  const reviewFiles = useMemo<ChatReviewFileDescriptor[]>(
    () =>
      diffs.flatMap(({ item }) =>
        item.type === "diff"
          ? item.changes.map((change) => ({
              id: `${item.itemId}:${change.path}`,
              path: change.path,
              status:
                change.kind === "add"
                  ? ("added" as const)
                  : change.kind === "delete"
                    ? ("deleted" as const)
                    : change.kind === "move"
                      ? ("renamed" as const)
                      : ("modified" as const),
            }))
          : []
      ),
    [diffs]
  )

  const gitCwd =
    snapshot.thread?.roots[0] ?? project?.roots[0] ?? desktopPreferences?.projectlessWorkspaceRoot

  const sendReviewCommentsRef = useRef<(text: string) => void>(() => undefined)
  sendReviewCommentsRef.current = (text) =>
    void controller.submit([{ text, type: "text" }], busy ? "queue" : "send")
  const sendReviewComments = useCallback((text: string) => sendReviewCommentsRef.current(text), [])
  const agentReviewComments = useMemo<AgentReviewComment[]>(
    () =>
      snapshot.items.flatMap((entry) =>
        entry.item.type === "message" && entry.item.role === "assistant"
          ? extractChatCodeComments(entry.item.text).map((comment, index) => ({
              comment,
              id: `${entry.item.itemId}:${index}`,
            }))
          : []
      ),
    [snapshot.items]
  )
  const setReviewSource = useSetAtom(gitReviewSourceAtom)
  const setReviewBase = useSetAtom(gitReviewBaseAtom)
  const [fileFocus, setFileFocus] = useState<Record<string, { lineNumber: number; nonce: number }>>(
    {}
  )
  const openFileTab = useCallback(
    (file: ThreadFileRef, lineNumber?: number) => {
      const id = fileTabId(file)
      setOpenRightTabs((current) => withOpenedTab(current, id, rightTab))
      setRightTab(id)
      setRightVisibility("visible")
      if (lineNumber && lineNumber > 0)
        setFileFocus((current) => ({ ...current, [id]: { lineNumber, nonce: Date.now() } }))
    },
    [rightTab, setOpenRightTabs, setRightTab, setRightVisibility]
  )
  const openFileTabRef = useRef(openFileTab)
  openFileTabRef.current = openFileTab
  const openFileTabStable = useCallback(
    (file: ThreadFileRef, lineNumber?: number) => openFileTabRef.current(file, lineNumber),
    []
  )
  const workspaceRoots = snapshot.thread?.roots
  const extensionWorkspace = useMemo<ExtensionWorkspace>(
    () => ({
      // Apps name files by absolute path; file tabs name them by root and relative path.
      openFile: (path) => {
        const root = [...(workspaceRoots ?? [])]
          .sort((a, b) => b.length - a.length)
          .find(
            (candidate) =>
              path === candidate || path.startsWith(`${candidate.replace(/[\\/]+$/u, "")}/`)
          )
        if (!root) return
        openFileTabStable({ path: path.slice(root.replace(/[\\/]+$/u, "").length + 1), root })
      },
      threadId: snapshot.thread?.id ?? null,
    }),
    [openFileTabStable, snapshot.thread?.id, workspaceRoots]
  )
  const extensionCatalog = useExtensionCatalog()
  const extensionEntrypoints = useMemo(
    () =>
      (extensionCatalog?.entrypoints ?? []).filter(
        (entry) => entry.type === "thread" || entry.id === initialAppEntrypointId
      ),
    [extensionCatalog, initialAppEntrypointId]
  )
  const panelTabs = useMemo<ChatPanelTabDescriptor[]>(() => {
    if (!codex) return []
    const timelineReview = reviewFiles.length ? (
      <ChatReviewPanel>
        <ChatReviewFileList files={reviewFiles} />
        <ChatReviewDiffHost>
          <pre className="p-3 whitespace-pre-wrap">
            {diffs
              .flatMap(({ item }) =>
                item.type === "diff" ? item.changes.map((change) => change.diff) : []
              )
              .join("\n")}
          </pre>
        </ChatReviewDiffHost>
      </ChatReviewPanel>
    ) : (
      <EmptyPanel>
        <Trans id="chat.panel.review.empty">No file changes to review</Trans>
      </EmptyPanel>
    )
    const tabs: ChatPanelTabDescriptor[] = [
      {
        content: sources.length ? (
          <ChatSourcesPanel>
            <ChatSourceGroup
              count={sources.length}
              title={i18n._(msg({ id: "chat.panel.sources", message: "Sources" }))}
            >
              {sources.map((source) => (
                <ChatSourceItem key={source.id} source={source} />
              ))}
            </ChatSourceGroup>
          </ChatSourcesPanel>
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.sources.empty">No sources in this conversation</Trans>
          </EmptyPanel>
        ),
        icon: <GlobeIcon />,
        id: "sources",
        title: i18n._(msg({ id: "chat.panel.sources", message: "Sources" })),
      },
      {
        content: subagents.length ? (
          <ChatSubagentsPanel>
            <ChatSubagentGroup
              count={subagents.length}
              title={i18n._(msg({ id: "chat.panel.subagents", message: "Subagents" }))}
            >
              {subagents.map((agent) => (
                <ChatSubagentItem agent={agent} key={agent.id} stateLabel={agent.state} />
              ))}
            </ChatSubagentGroup>
          </ChatSubagentsPanel>
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.subagents.empty">No subagents have been used</Trans>
          </EmptyPanel>
        ),
        icon: <AgentIcon />,
        id: "subagents",
        title: i18n._(msg({ id: "chat.panel.subagents", message: "Subagents" })),
      },
      {
        content: goalQuery.data?.goal ? (
          <ChatGoalPanel>
            <ChatPanelContent>
              <ChatPanelSection>
                <h2 className="font-medium">{goalQuery.data.goal.objective}</h2>
                <p className="text-sm text-muted-foreground">{goalQuery.data.goal.status}</p>
              </ChatPanelSection>
            </ChatPanelContent>
          </ChatGoalPanel>
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.goal.empty">No goal is set for this task</Trans>
          </EmptyPanel>
        ),
        icon: <PinIcon />,
        id: "goal",
        title: i18n._(msg({ id: "chat.panel.goal", message: "Goal" })),
      },
      {
        content: plans.length ? (
          <ChatPlanPanel>
            <ol className="p-3">
              {plans
                .flatMap(({ item }) => (item.type === "plan" ? item.entries : []))
                .map((step) => (
                  <ChatPlanStep
                    key={`${step.status}:${step.text}`}
                    state={activityState(step.status === "in_progress" ? "running" : step.status)}
                    stateLabel={step.status}
                  >
                    {step.text}
                  </ChatPlanStep>
                ))}
            </ol>
          </ChatPlanPanel>
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.plan.empty">No plan is available</Trans>
          </EmptyPanel>
        ),
        icon: <TasksIcon />,
        id: "plan",
        title: i18n._(msg({ id: "chat.panel.plan", message: "Plan" })),
      },
      {
        content: gitCwd ? (
          <GitReviewPanel
            agentComments={agentReviewComments}
            agentLabel={agentDisplayNames[agentId] ?? agentId}
            cwd={gitCwd}
            fallback={timelineReview}
            onAddFile={(path) =>
              setComposer(
                (current) => `${current}${current && !/\s$/u.test(current) ? " " : ""}@${path} `
              )
            }
            onOpenFile={(absolutePath) => {
              const threadId = snapshot.thread?.id
              if (!threadId) return
              void ensureCypheriaClient()
                .then((client) => client.threads.paths.resolve({ path: absolutePath, threadId }))
                .then((resolved) => {
                  if (resolved.kind === "file")
                    openFileTabStable({ path: resolved.path, root: resolved.root })
                })
                .catch(() => undefined)
            }}
            onSendComments={sendReviewComments}
            threadId={snapshot.thread?.id ?? null}
          />
        ) : (
          timelineReview
        ),
        icon: <BranchIcon />,
        id: "review",
        title: i18n._(msg({ id: "chat.panel.review", message: "Review" })),
      },
      {
        content: snapshot.thread ? (
          <ThreadFilesPanel file={null} onOpenFile={openFileTabStable} thread={snapshot.thread} />
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.files.empty">Start the task to browse workspace files</Trans>
          </EmptyPanel>
        ),
        icon: <FileIcon />,
        id: "files",
        title: i18n._(msg({ id: "chat.panel.openFile", message: "Open file" })),
      },
      {
        content: artifacts.some(({ item }) => item.type === "artifact" && item.kind === "image") ? (
          <ChatImagePreviewPanel>
            <ChatGeneratedImageGrid className="p-3">
              {artifacts.map(({ item }) =>
                item.type === "artifact" && item.kind === "image" ? (
                  <ChatGeneratedImage alt={item.name} key={item.itemId} src={item.uri} />
                ) : null
              )}
            </ChatGeneratedImageGrid>
          </ChatImagePreviewPanel>
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.images.empty">No images in this conversation</Trans>
          </EmptyPanel>
        ),
        icon: <FileImageIcon />,
        id: "images",
        title: i18n._(msg({ id: "chat.panel.images", message: "Images" })),
      },
      {
        // The pane positions a resident <webview> over itself, so it only mounts while visible.
        content:
          rightVisibility === "visible" && rightTab === "browser" && snapshot.thread?.id ? (
            <BrowserPane threadId={snapshot.thread.id} />
          ) : rightVisibility === "visible" && rightTab === "browser" ? (
            <ChatBrowserPanel>
              <EmptyPanel>
                <Trans id="chat.panel.browser.empty">No browser session is open</Trans>
              </EmptyPanel>
            </ChatBrowserPanel>
          ) : null,
        icon: <GlobeIcon />,
        id: "browser",
        title: i18n._(msg({ id: "chat.panel.browser", message: "Browser" })),
      },
      {
        content:
          rightVisibility === "visible" && rightTab === "pull-request" ? (
            <ThreadPullRequestPanel threadId={snapshot.thread?.id ?? null} url={pullRequestUrl} />
          ) : null,
        icon: <PullRequestOpenIcon />,
        id: "pull-request",
        title: i18n._(msg({ id: "chat.panel.pullRequest", message: "Pull request" })),
      },
      ...(extensionEntrypoints.length > 0
        ? extensionEntrypoints.map((entrypoint) => {
            const id = extensionTabId(entrypoint.id)
            return {
              content:
                rightVisibility === "visible" && rightTab === id ? (
                  <ExtensionAppPanel
                    entrypoint={entrypoint}
                    threadId={snapshot.thread?.id ?? null}
                  />
                ) : null,
              icon: <ExtensionIcon icon={entrypoint.icon} />,
              id,
              title: entrypoint.title,
            }
          })
        : [
            {
              content: (
                <ChatMcpAppPanel>
                  <EmptyPanel>
                    <Trans id="chat.panel.mcp.empty">No MCP App is open</Trans>
                  </EmptyPanel>
                </ChatMcpAppPanel>
              ),
              icon: <McpIcon />,
              id: "mcp",
              title: i18n._(msg({ id: "chat.panel.mcp", message: "MCP App" })),
            },
          ]),
      {
        content: (
          <ChatArtifactPanel>
            <EmptyPanel>
              <Trans id="chat.panel.artifacts.empty">No interactive artifact is open</Trans>
            </EmptyPanel>
          </ChatArtifactPanel>
        ),
        icon: <FileIcon />,
        id: "artifacts",
        title: i18n._(msg({ id: "chat.panel.artifacts", message: "Artifacts" })),
      },
    ]
    for (const id of openRightTabs) {
      const file = parseFileTabId(id)
      if (!file) continue
      tabs.push({
        content: snapshot.thread ? (
          <ExtensionFileViewers key={id} file={file}>
            <ThreadFilesPanel
              file={file}
              focusLine={fileFocus[id] ?? null}
              onOpenFile={openFileTabStable}
              thread={snapshot.thread}
            />
          </ExtensionFileViewers>
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.files.empty">Start the task to browse workspace files</Trans>
          </EmptyPanel>
        ),
        icon: <FileIcon />,
        id,
        title: file.path.split("/").at(-1) ?? file.path,
      })
    }
    tabs.push({
      content:
        rightVisibility === "visible" && rightTab === "terminal" ? (
          <WorkspaceTerminalView
            controller={terminals}
            onHide={() => setRightVisibility("hidden")}
            placement="right"
          />
        ) : null,
      icon: <DockIcon />,
      id: "terminal",
      title: i18n._(msg({ id: "chat.panel.terminal", message: "Terminal" })),
    })
    return tabs.map((tab) => ({ ...tab, closable: true }))
  }, [
    artifacts,
    codex,
    diffs,
    goalQuery.data,
    gitCwd,
    snapshot.thread,
    i18n,
    plans,
    reviewFiles,
    sendReviewComments,
    sources,
    subagents,
    terminals,
    rightVisibility,
    rightTab,
    setRightVisibility,
    openRightTabs,
    fileFocus,
    openFileTabStable,
    agentId,
    agentReviewComments,
    pullRequestUrl,
    extensionEntrypoints,
  ])

  const rightTabs = panelTabs.filter((tab) => openRightTabs.includes(tab.id))
  useEffect(() => {
    const validIds = new Set(panelTabs.map((tab) => tab.id))
    setOpenRightTabsState((current) => {
      const filtered = current.filter((id) => validIds.has(id))
      return filtered.length === current.length ? current : filtered
    })
    setRightTabState((current) => (current && validIds.has(current) ? current : "sources"))
  }, [panelTabs])
  const launcherItems = panelTabs
    .filter((tab) => !parseFileTabId(tab.id))
    .map<ChatPanelLauncherItem>((tab) => ({
      disabled: openRightTabs.includes(tab.id),
      icon: tab.icon,
      id: tab.id,
      label: tab.title,
    }))
  const pending = snapshot.thread?.pendingInteractions[0]
  const busy =
    timelineActionBusy ||
    snapshot.thread?.state === "running" ||
    snapshot.thread?.state === "starting"
  const displayedError = timelineActionError ?? snapshot.error
  const composerStatus = displayedError ? "error" : busy ? "streaming" : "ready"
  const forkTimelineMessage = async (entry: ThreadTimelineProjectedItem) => {
    const thread = snapshot.thread
    const epoch = snapshot.epoch
    const item = entry.item
    if (!thread || !epoch || item.type !== "message") return
    const kind =
      item.boundary === "turn-user"
        ? "user-message"
        : item.boundary === "assistant-final"
          ? "assistant-message"
          : null
    if (!kind) return
    setTimelineActionBusy(true)
    setTimelineActionError(null)
    try {
      const client = await ensureCypheriaClient()
      const result = await client.threads.fork({
        target: { cursor: { epoch, seq: entry.seqEnd }, kind },
        threadId: thread.id,
      })
      const draft = await inputBlocksToComposerDraft(result.composerContent)
      await clientStateStore.set(
        composerDraftAtom(result.thread.id),
        draft.text || draft.attachments.length > 0 ? draft : null
      )
      sidebarData.invalidate()
      await queryClient.invalidateQueries({ queryKey: sidebarQueryKeys.all })
      await navigate({ search: { thread: result.thread.id } })
    } catch (error) {
      setTimelineActionError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      setTimelineActionBusy(false)
    }
  }
  const rewindTimelineMessage = async (entry: ThreadTimelineProjectedItem) => {
    const thread = snapshot.thread
    const epoch = snapshot.epoch
    if (!thread || !epoch || entry.item.type !== "message" || entry.item.boundary !== "turn-user")
      return
    if (
      (composer.length > 0 || attachments.length > 0) &&
      !window.confirm(
        i18n._(
          msg({
            id: "chat.message.rewindReplaceDraft",
            message: "Rewind will replace the current composer draft. Continue?",
          })
        )
      )
    )
      return
    setTimelineActionBusy(true)
    setTimelineActionError(null)
    try {
      const client = await ensureCypheriaClient()
      const result = await client.threads.rewind({
        target: { cursor: { epoch, seq: entry.seqEnd }, kind: "user-message" },
        threadId: thread.id,
      })
      const draft = await inputBlocksToComposerDraft(result.composerContent)
      await deleteDraftAttachments(attachments)
      composerDocumentRef.current = draftEditorDocument(draft)
      setComposer(draft.text)
      setAttachments(draft.attachments)
      setComposerEpoch((current) => current + 1)
      draftStatusRef.current = "editing"
      draftSnapshotRef.current = draft
      await clientStateStore.set(composerDraftAtom(thread.id), draft)
      await controller.refresh()
    } catch (error) {
      setTimelineActionError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      setTimelineActionBusy(false)
    }
  }
  const chooseNewProject = (projectId: string | undefined) => {
    if (snapshot.thread || projectId === initialProjectId) return
    void navigate({
      replace: true,
      search: {
        agent: agentId,
        project: projectId,
        prompt: composer || undefined,
        section: initialSectionId,
      },
      to: "/",
    })
  }
  const worktreeDescription = project
    ? i18n._({
        ...msg({
          id: "chat.worktree.description",
          message:
            "Create an isolated copy of {projectName} so this chat can work in parallel. Other project source folders are accessed directly. The selected branch is used as the starting point.",
        }),
        values: { projectName: project.name },
      })
    : null
  const clearProjectLabel = i18n._(
    msg({ id: "chat.project.clear", message: "Don't work in a project" })
  )
  const permissionMode =
    snapshot.thread?.config.permissionsMode ??
    serverConfigQuery.data?.config.agents.codex.permissionsMode ??
    null
  const permissionOptions: Array<{
    description: string
    label: string
    value: CodexPermissionsMode
  }> = [
    {
      description: i18n._(
        msg({
          id: "chat.permissions.ask.description",
          message: "Always ask to edit external files and use the internet",
        })
      ),
      label: i18n._(msg({ id: "chat.permissions.ask", message: "Ask for approval" })),
      value: "auto",
    },
    {
      description: i18n._(
        msg({
          id: "chat.permissions.approve.description",
          message: "Only ask for actions detected as potentially unsafe",
        })
      ),
      label: i18n._(msg({ id: "chat.permissions.approve", message: "Approve for me" })),
      value: "guardian-approvals",
    },
    {
      description: i18n._(
        msg({
          id: "chat.permissions.fullAccess.description",
          message: "Unrestricted access to the internet and any file on your computer",
        })
      ),
      label: i18n._(msg({ id: "chat.permissions.fullAccess", message: "Full access" })),
      value: "full-access",
    },
    {
      description: i18n._(
        msg({
          id: "chat.permissions.agentConfig.description",
          message: "Use the permissions configured for the Codex agent",
        })
      ),
      label: i18n._(msg({ id: "chat.permissions.agentConfig", message: "Agent defaults" })),
      value: "agent-config",
    },
  ]
  const permissionLabel =
    permissionOptions.find((option) => option.value === permissionMode)?.label ??
    i18n._(msg({ id: "chat.permissions", message: "Permissions" }))
  const updatePermissionMode = async (mode: CodexPermissionsMode) => {
    if (snapshot.thread) {
      await controller.updateConfig({ permissionsMode: mode })
      return
    }
    await (await ensureCypheriaClient()).server.patchConfig({
      agents: { codex: { permissionsMode: mode } },
    })
    await queryClient.invalidateQueries({ queryKey: ["settings", "server-config"] })
  }
  const oppositeFollowUp = useRef(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = composer.trim()
    if (!text && attachments.length === 0) return
    const submittedAttachments = attachments
    if (
      submittedAttachments.some(
        (attachment) => isOwnedDraftAttachment(attachment) && attachment.status !== "ready"
      )
    )
      return
    const submittedBlocks = composerInput()
    draftStatusRef.current = "submitting"
    const submittingDraft: ComposerDraft = {
      attachments: submittedAttachments,
      blocks: submittedBlocks,
      status: "submitting",
      text,
      updatedAt: Date.now(),
    }
    draftSnapshotRef.current = submittingDraft
    await clientStateStore.set(composerDraftAtom(activeDraftScopeRef.current), submittingDraft)
    let inputAttachments: ThreadInputBlock[]
    try {
      const client = await ensureCypheriaClient()
      inputAttachments = await Promise.all(
        submittedAttachments.map(async (attachment) => {
          if (!isOwnedDraftAttachment(attachment)) return draftAttachmentToInputBlock(attachment)
          const bytes = await desktopClientStorage.attachments.read(attachment.attachment)
          const file = await client.threads.inputFiles.upload({
            bytes,
            fileName: attachment.name,
            mimeType: attachment.attachment.mimeType,
          })
          return { fileId: file.fileId, type: "uploaded-file" } as const
        })
      )
    } catch {
      draftStatusRef.current = "failed"
      draftSnapshotRef.current = { ...submittingDraft, status: "failed" }
      await clientStateStore.set(
        composerDraftAtom(activeDraftScopeRef.current),
        draftSnapshotRef.current
      )
      return
    }
    setComposer("")
    setComposerEpoch((current) => current + 1)
    setAttachments([])
    const queuePreferred =
      (desktopPreferences?.followUpQueueMode === "queue") !== oppositeFollowUp.current
    oppositeFollowUp.current = false
    const mode: ConversationSubmitMode = busy
      ? queuePreferred && codex
        ? "queue"
        : snapshot.thread?.capabilities.steer
          ? "steer"
          : codex
            ? "queue"
            : "send"
      : "send"
    try {
      await controller.submit([...submittedBlocks, ...inputAttachments], mode)
      await deleteDraftAttachments(submittedAttachments)
      draftStatusRef.current = "editing"
      draftSnapshotRef.current = null
      await clientStateStore.set(composerDraftAtom(activeDraftScopeRef.current), null)
    } catch {
      draftStatusRef.current = "failed"
      setComposer(text)
      setAttachments(submittedAttachments)
      const failedDraft: ComposerDraft = {
        ...submittingDraft,
        status: "failed",
        updatedAt: Date.now(),
      }
      draftSnapshotRef.current = failedDraft
      await clientStateStore.set(composerDraftAtom(activeDraftScopeRef.current), failedDraft)
    }
  }

  const openRightTab = useCallback(
    (id: string) => {
      setOpenRightTabs((current) => (current.includes(id) ? current : [...current, id]))
      setRightTab(id)
      setRightVisibility("visible")
    },
    [setOpenRightTabs, setRightTab, setRightVisibility]
  )
  const openedInitialApp = useRef(false)
  useEffect(() => {
    if (!initialAppEntrypointId || openedInitialApp.current) return
    const id = extensionTabId(initialAppEntrypointId)
    if (!panelTabs.some((tab) => tab.id === id)) return
    openedInitialApp.current = true
    openRightTab(id)
  }, [initialAppEntrypointId, openRightTab, panelTabs])
  const onOpenPullRequest = useCallback(
    (url: string) => {
      setPullRequestUrl(url)
      openRightTab("pull-request")
    },
    [openRightTab]
  )
  const reviewFocus = useAtomValue(reviewFocusAtom)
  useEffect(() => {
    if (!reviewFocus?.pullRequest || !snapshot.thread?.id) return
    if (reviewFocus.threadId && reviewFocus.threadId !== snapshot.thread.id) return
    onOpenPullRequest(reviewFocus.pullRequest)
    clientStateStore.set(reviewFocusAtom, null)
  }, [onOpenPullRequest, reviewFocus, snapshot.thread?.id])
  const reviewPanelRequest = useAtomValue(reviewPanelRequestAtom)
  const currentThreadId = snapshot.thread?.id ?? null
  useEffect(() => {
    if (!reviewPanelRequest || !currentThreadId) return
    if (reviewPanelRequest.threadId && reviewPanelRequest.threadId !== currentThreadId) return
    openRightTab("review")
    clientStateStore.set(reviewPanelRequestAtom, null)
  }, [currentThreadId, openRightTab, reviewPanelRequest])
  const markdownHost = useThreadMarkdownHost({
    openFile: openFileTabStable,
    openFilesPanel: () => openRightTab("files"),
    openReviewPanel: () => openRightTab("review"),
    openThread: (threadId) => void navigate({ search: { thread: threadId } }),
    sendFollowUp: (prompt) =>
      void controller.submit([{ text: prompt, type: "text" }], busy ? "queue" : "send"),
    threadId: snapshot.thread?.id ?? null,
  })

  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return
    const saved: ComposerDraftAttachment[] = []
    try {
      for (const file of files) saved.push(await saveFileDraftAttachment(file))
      const nextAttachments = [...attachments, ...saved]
      const nextDraft: ComposerDraft = {
        attachments: nextAttachments,
        status: "editing",
        text: composer,
        updatedAt: Date.now(),
      }
      await clientStateStore.set(composerDraftAtom(activeDraftScopeRef.current), nextDraft)
      draftStatusRef.current = "editing"
      draftSnapshotRef.current = nextDraft
      setAttachments(nextAttachments)
    } catch (error) {
      await deleteDraftAttachments(saved)
      throw error
    }
  }

  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ""
    await attachFiles(files)
  }

  const rightPanel = codex ? (
    <ChatPanel
      activeTabId={rightTab}
      actions={
        <ChatPanelToggle
          label={
            rightFullscreen
              ? i18n._(msg({ id: "chat.workspace.exitFullscreen", message: "Exit full screen" }))
              : i18n._(msg({ id: "chat.workspace.enterFullscreen", message: "Enter full screen" }))
          }
          onClick={() => setRightFullscreen((value) => !value)}
          panel="right"
          pressed={rightFullscreen}
          tooltip={
            rightFullscreen
              ? i18n._(msg({ id: "chat.workspace.exitFullscreen", message: "Exit full screen" }))
              : i18n._(msg({ id: "chat.workspace.enterFullscreen", message: "Enter full screen" }))
          }
        >
          {rightFullscreen ? <CollapseIcon /> : <ExpandIcon />}
        </ChatPanelToggle>
      }
      closeTabLabel={(tab) =>
        `${i18n._(msg({ id: "common.close", message: "Close" }))} ${String(tab.title)}`
      }
      emptyState={
        <ChatPanelEmptyState>
          <Trans id="chat.panel.empty">Open a panel tab to inspect task context</Trans>
        </ChatPanelEmptyState>
      }
      launcher={
        <ChatPanelLauncher
          items={launcherItems}
          label={i18n._(
            msg({ id: "chat.workspace.openSidePanelTab", message: "Open side panel tab" })
          )}
          onLaunch={(id) => {
            setOpenRightTabs((current) => (current.includes(id) ? current : [...current, id]))
            setRightTab(id)
            setRightVisibility("visible")
          }}
        />
      }
      onActiveTabChange={setRightTab}
      onCloseTab={(id) => {
        const closedIndex = rightTabs.findIndex((tab) => tab.id === id)
        const nextTabs = rightTabs.filter((tab) => tab.id !== id)
        setOpenRightTabs((current) => current.filter((tabId) => tabId !== id))
        if (rightTab === id) {
          setRightTab(nextTabs[Math.min(closedIndex, nextTabs.length - 1)]?.id)
        }
      }}
      placement="right"
      tabs={rightTabs}
      tabsLabel={i18n._(msg({ id: "chat.workspace.sidePanelTabs", message: "Side panel tabs" }))}
      visibility={rightVisibility}
      workspaceHeader
    />
  ) : null

  const header = (
    <ChatHeader
      className="desktop-titlebar overflow-hidden"
      reserveFixedActions={!codex || !(wideViewport && rightVisibility === "visible")}
    >
      <ChatHeaderBreadcrumb>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <AgentIcon className="size-3.5" />
        </span>
        <ChatHeaderTitle>
          {snapshot.thread?.title ?? i18n._(msg({ id: "chat.newTask", message: "New task" }))}
        </ChatHeaderTitle>
      </ChatHeaderBreadcrumb>
      <span className="hidden shrink truncate text-xs text-muted-foreground sm:inline">
        {project?.name ?? agentId}
      </span>
      <ChatHeaderStatus
        className="hidden lg:flex"
        state={displayedError ? "error" : busy ? "running" : "idle"}
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        {displayedError
          ? displayedError.message
          : busy
            ? i18n._(msg({ id: "chat.state.working", message: "Working…" }))
            : activityLabel(i18n)}
      </ChatHeaderStatus>
      {snapshot.thread?.roots[0] ? (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThreadGitActions
            cwd={snapshot.thread.roots[0]}
            onAddToChat={(text) =>
              setComposer(
                (current) => `${current}${current && !/\s$/u.test(current) ? " " : ""}${text} `
              )
            }
            threadId={snapshot.thread?.id ?? null}
            onOpenPullRequest={onOpenPullRequest}
            onOpenReview={() => openRightTab("review")}
          />
        </div>
      ) : null}
      {codex ? (
        <ChatPanelToggle
          className={snapshot.thread?.roots[0] ? undefined : "ml-auto"}
          ref={summaryToggleRef}
          label={i18n._(msg({ id: "chat.summary.toggle", message: "Toggle summary" }))}
          onClick={() => setSummaryCheckpoint((current) => ({ ...current, open: !current.open }))}
          panel="summary"
          pressed={summaryCheckpoint.open}
          tooltip={i18n._(msg({ id: "chat.summary.toggle", message: "Toggle summary" }))}
        >
          <ChatIcon />
        </ChatPanelToggle>
      ) : null}
    </ChatHeader>
  )

  return (
    <ExtensionWorkspaceContext.Provider value={extensionWorkspace}>
      <ChatMarkdownHostContext.Provider value={markdownHost}>
        <ChatWorkspaceShell
          allowRightPanelFullscreen={codex}
          bottomPanel={
            bottomVisibility === "visible" ? (
              <WorkspaceTerminalView
                controller={terminals}
                onHide={() => setBottomVisibility("hidden")}
                placement="bottom"
              />
            ) : null
          }
          bottomPanelVisibility={bottomVisibility}
          bottomPanelSize={bottomPanelSize}
          onBottomPanelResize={(size) => {
            markPanelDirty()
            setBottomPanelSizeState(size)
          }}
          bottomPanelResizeLabel={i18n._(
            msg({ id: "chat.workspace.resizeBottomPanel", message: "Resize bottom panel" })
          )}
          fixedHeaderActions={
            <>
              {workspaceLayout?.showBottomPanelControl !== false ? (
                <ChatPanelToggle
                  label={i18n._(
                    msg({ id: "chat.workspace.toggleBottomPanel", message: "Toggle bottom panel" })
                  )}
                  onClick={() => {
                    if (workspaceLayout?.defaultTerminalLocation === "right" && codex) {
                      setBottomVisibility("hidden")
                      setOpenRightTabs((current) =>
                        current.includes("terminal") ? current : [...current, "terminal"]
                      )
                      setRightTab("terminal")
                      setRightVisibility("visible")
                    } else {
                      if (rightTab === "terminal") setRightVisibility("hidden")
                      setBottomVisibility((value) => (value === "visible" ? "hidden" : "visible"))
                    }
                  }}
                  panel="bottom"
                  pressed={
                    workspaceLayout?.defaultTerminalLocation === "right"
                      ? rightVisibility === "visible" && rightTab === "terminal"
                      : bottomVisibility === "visible"
                  }
                  tooltip={i18n._(
                    msg({ id: "chat.workspace.toggleBottomPanel", message: "Toggle bottom panel" })
                  )}
                >
                  <DockIcon />
                </ChatPanelToggle>
              ) : null}
              {codex ? (
                <ChatPanelToggle
                  label={i18n._(
                    msg({ id: "chat.workspace.toggleSidePanel", message: "Toggle side panel" })
                  )}
                  onClick={() => {
                    if (rightVisibility === "visible") {
                      setRightFullscreen(false)
                      setRightVisibility("hidden")
                    } else setRightVisibility("visible")
                  }}
                  panel="right"
                  pressed={wideViewport && rightVisibility === "visible"}
                  tooltip={i18n._(
                    msg({ id: "chat.workspace.toggleSidePanel", message: "Toggle side panel" })
                  )}
                >
                  <SidebarRightIcon />
                </ChatPanelToggle>
              ) : null}
            </>
          }
          header={header}
          onBottomPanelVisibilityChange={setBottomVisibility}
          onRightPanelFullscreenChange={setRightFullscreen}
          rightPanel={wideViewport ? rightPanel : undefined}
          rightPanelFullscreen={rightFullscreen}
          rightPanelSize={rightPanelSize}
          onRightPanelResize={(size) => {
            markPanelDirty()
            setRightPanelSizeState(size)
          }}
          rightPanelResizeLabel={i18n._(
            msg({ id: "chat.workspace.resizeSidePanel", message: "Resize side panel" })
          )}
          rightPanelVisibility={codex && wideViewport ? rightVisibility : "closed"}
        >
          <ChatMainColumn
            className={
              codex &&
              summaryCheckpoint.open &&
              summaryCheckpoint.pinned &&
              summaryMode !== "overlay"
                ? summaryMode === "gutter"
                  ? "pr-[316px] transition-[padding-right] duration-200 motion-reduce:transition-none"
                  : "pr-[160px] transition-[padding-right] duration-200 motion-reduce:transition-none"
                : "pr-0 transition-[padding-right] duration-200 motion-reduce:transition-none"
            }
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              ref={summaryHostRef}
            />
            <VirtualTimeline
              actionBusy={timelineActionBusy}
              activeTurnId={snapshot.thread?.activeTurn?.id ?? null}
              codex={codex}
              hasOlder={snapshot.hasOlder}
              items={snapshot.items}
              loading={snapshot.loadState === "loading"}
              loadingOlder={snapshot.loadingOlder}
              onForkAssistant={
                snapshot.thread?.capabilities.fork.assistantMessage
                  ? (entry) => void forkTimelineMessage(entry)
                  : undefined
              }
              onForkUser={
                snapshot.thread?.capabilities.fork.userMessage
                  ? (entry) => void forkTimelineMessage(entry)
                  : undefined
              }
              onLoadOlder={() => void controller.loadOlder()}
              onRewind={
                snapshot.thread?.capabilities.rewind.userMessage
                  ? (entry) => void rewindTimelineMessage(entry)
                  : undefined
              }
            />
            <ChatComposerDock>
              <div className="pointer-events-none w-full max-w-(--chat-composer-max-width)">
                {!snapshot.thread ? (
                  <div
                    className="pointer-events-auto relative z-0 mx-3 -mb-3 min-h-12 overflow-x-auto rounded-t-[1.25rem] bg-muted px-2 pt-1 pb-3"
                    data-slot="chat-composer-context-rail"
                  >
                    <div className="flex min-w-max items-center gap-0.5">
                      <div className="flex min-w-0 items-center">
                        {project ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  aria-label={clearProjectLabel}
                                  className="mr-0.5 size-7 rounded-xl text-muted-foreground hover:bg-background/75 hover:text-foreground"
                                  onClick={() => chooseNewProject(undefined)}
                                  size="icon-sm"
                                  type="button"
                                  variant="ghost"
                                />
                              }
                            >
                              <CloseBoldIcon className="size-3.5" />
                            </TooltipTrigger>
                            <TooltipContent
                              className="rounded-xl px-3 py-2 text-[13px] shadow-lg"
                              side="top"
                              sideOffset={8}
                            >
                              {clearProjectLabel}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        <Popover
                          onOpenChange={(open) => {
                            setProjectPickerOpen(open)
                            if (!open) {
                              setProjectSearch("")
                              setProjectKeyboardIndex(null)
                            }
                          }}
                          open={projectPickerOpen}
                        >
                          <PopoverTrigger
                            render={
                              <button
                                aria-label={i18n._(
                                  msg({ id: "chat.project.choose", message: "Choose project" })
                                )}
                                className={`inline-flex h-8 max-w-56 items-center gap-2 rounded-xl px-2.5 text-sm font-normal outline-none transition-colors hover:bg-background/75 focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-background/75 ${project ? "bg-foreground/5" : ""}`}
                                type="button"
                              >
                                <FolderIcon className="size-4 shrink-0" />
                                <span className="truncate">
                                  {project?.name ??
                                    i18n._(
                                      msg({ id: "chat.project.choose", message: "Choose project" })
                                    )}
                                </span>
                              </button>
                            }
                          />
                          <PopoverContent
                            align="start"
                            className="w-64 gap-0 overflow-hidden rounded-[18px] p-2 shadow-xl"
                            side="top"
                            sideOffset={-4}
                          >
                            <div className="flex h-10 items-center gap-2 border-b px-2 pb-2 text-muted-foreground">
                              <SearchIcon className="size-4 shrink-0" />
                              <input
                                aria-activedescendant={
                                  projectKeyboardIndex === null
                                    ? undefined
                                    : `new-thread-project-option-${projectKeyboardIndex}`
                                }
                                aria-autocomplete="list"
                                aria-controls="new-thread-project-list"
                                aria-expanded={projectPickerOpen}
                                aria-label={i18n._(
                                  msg({ id: "chat.project.search", message: "Search projects" })
                                )}
                                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                                onChange={(event) => {
                                  setProjectSearch(event.target.value)
                                  setProjectKeyboardIndex(null)
                                }}
                                onKeyDown={(event) => {
                                  if (!filteredProjects.length) return
                                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                    event.preventDefault()
                                    const nextIndex =
                                      event.key === "ArrowDown"
                                        ? projectKeyboardIndex === null
                                          ? 0
                                          : Math.min(
                                              projectKeyboardIndex + 1,
                                              filteredProjects.length - 1
                                            )
                                        : projectKeyboardIndex === null
                                          ? filteredProjects.length - 1
                                          : Math.max(projectKeyboardIndex - 1, 0)
                                    setProjectKeyboardIndex(nextIndex)
                                    projectVirtualizer.scrollToIndex(nextIndex, { align: "auto" })
                                    return
                                  }
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    const selected = filteredProjects[projectKeyboardIndex ?? 0]
                                    if (!selected) return
                                    setProjectPickerOpen(false)
                                    chooseNewProject(selected.id)
                                  }
                                }}
                                placeholder={i18n._(
                                  msg({ id: "chat.project.search", message: "Search projects" })
                                )}
                                ref={projectSearchRef}
                                role="combobox"
                                value={projectSearch}
                              />
                            </div>
                            <div
                              className="no-scrollbar overflow-y-auto py-1"
                              id="new-thread-project-list"
                              ref={projectListRef}
                              role="listbox"
                              style={{
                                height: Math.min(
                                  Math.max(projectVirtualizer.getTotalSize(), 48),
                                  240
                                ),
                              }}
                            >
                              {filteredProjects.length ? (
                                <div
                                  className="relative w-full"
                                  style={{ height: projectVirtualizer.getTotalSize() }}
                                >
                                  {projectVirtualizer.getVirtualItems().map((virtualItem) => {
                                    const item = filteredProjects[virtualItem.index]
                                    if (!item) return null
                                    const current = item.id === project?.id
                                    return (
                                      <button
                                        aria-selected={current}
                                        className="absolute top-0 left-0 flex h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted data-[keyboard-active=true]:bg-muted"
                                        data-index={virtualItem.index}
                                        data-keyboard-active={
                                          projectKeyboardIndex === virtualItem.index || undefined
                                        }
                                        id={`new-thread-project-option-${virtualItem.index}`}
                                        key={item.id}
                                        onClick={() => {
                                          setProjectPickerOpen(false)
                                          chooseNewProject(item.id)
                                        }}
                                        onMouseMove={() => setProjectKeyboardIndex(null)}
                                        role="option"
                                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                                        type="button"
                                      >
                                        <FolderIcon className="size-4 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                        {current ? <CheckIcon className="size-4 shrink-0" /> : null}
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : (
                                <div className="flex h-12 items-center justify-center px-3 text-sm text-muted-foreground">
                                  <Trans id="chat.project.empty">No projects found</Trans>
                                </div>
                              )}
                            </div>
                            <div className="border-t pt-1">
                              <button
                                className="flex h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
                                onClick={() => {
                                  setProjectPickerOpen(false)
                                  setProjectCreateOpen(true)
                                }}
                                type="button"
                              >
                                <PlusIcon className="size-4 shrink-0" />
                                <Trans id="chat.project.new">New project</Trans>
                              </button>
                              <button
                                className="flex h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
                                onClick={() => {
                                  setProjectPickerOpen(false)
                                  chooseNewProject(undefined)
                                }}
                                type="button"
                              >
                                <CloseBoldIcon className="size-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{clearProjectLabel}</span>
                                {!project ? <CheckIcon className="size-4 shrink-0" /> : null}
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                      {project ? (
                        <>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <label
                                  className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-xl px-2.5 text-sm font-normal text-foreground transition-colors hover:bg-background/75 has-data-checked:bg-background/75 has-data-checked:shadow-sm has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50"
                                  htmlFor="new-thread-worktree"
                                >
                                  <Checkbox
                                    aria-label={i18n._(
                                      msg({ id: "chat.worktree.label", message: "Worktree" })
                                    )}
                                    checked={createWorktree}
                                    className="border-foreground/25 bg-background/60 data-checked:border-foreground data-checked:bg-foreground data-checked:text-background dark:data-checked:bg-foreground"
                                    disabled={!gitRepositoryQuery.isSuccess}
                                    id="new-thread-worktree"
                                    onCheckedChange={(checked) =>
                                      setCreateWorktree(checked === true)
                                    }
                                  />
                                  <span>
                                    <Trans id="chat.worktree.label">Worktree</Trans>
                                  </span>
                                </label>
                              }
                            />
                            <TooltipContent
                              className="max-w-80 rounded-xl px-4 py-2.5 text-center text-sm leading-5 shadow-lg"
                              side="top"
                              sideOffset={8}
                            >
                              {gitRepositoryQuery.isError
                                ? i18n._(
                                    msg({
                                      id: "chat.worktree.gitRequired",
                                      message:
                                        "Worktrees require the project's first source folder to be a Git repository.",
                                    })
                                  )
                                : worktreeDescription}
                            </TooltipContent>
                          </Tooltip>
                          <Select
                            disabled={!gitRepositoryQuery.isSuccess || localBranches.length === 0}
                            onValueChange={(value) =>
                              setSelectedBranch(typeof value === "string" ? value : null)
                            }
                            value={selectedBranch}
                          >
                            <SelectTrigger
                              aria-label={i18n._(
                                msg({ id: "chat.branch.label", message: "Branch" })
                              )}
                              className="h-8 max-w-56 rounded-xl border-0 bg-transparent px-2.5 text-sm font-normal shadow-none hover:bg-background/75 aria-expanded:bg-background/75"
                            >
                              <BranchIcon />
                              <SelectValue>
                                {selectedBranch ??
                                  i18n._(
                                    msg({ id: "chat.branch.choose", message: "Choose branch" })
                                  )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent
                              align="start"
                              alignItemWithTrigger={false}
                              className="min-w-72 rounded-xl p-1 shadow-lg"
                              side="top"
                              sideOffset={8}
                            >
                              <SelectGroup>
                                <SelectLabel className="px-2 py-1.5 text-sm">
                                  <Trans id="chat.branch.local">Local branches</Trans>
                                </SelectLabel>
                                {localBranches.map((branch) => (
                                  <SelectItem
                                    className="min-h-9 rounded-lg px-2"
                                    key={branch.name}
                                    value={branch.name}
                                  >
                                    <BranchIcon />
                                    <span className="min-w-0 truncate">{branch.name}</span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <ChatComposerFrame className="relative z-10 max-w-none">
                  {pending ? (
                    <PendingInteraction
                      interaction={pending}
                      onRespond={(response) => void controller.respond(pending.id, response)}
                    />
                  ) : (
                    <ChatComposerForm ref={composerForm} onSubmit={submit}>
                      <input
                        className="sr-only"
                        multiple
                        onChange={(event) => void attach(event)}
                        ref={attachmentInput}
                        type="file"
                      />
                      {snapshot.thread ? (
                        <ExtensionContextAttachments threadId={snapshot.thread.id} />
                      ) : null}
                      {attachments.length ? (
                        <ChatComposerHeader>
                          <ChatComposerAttachmentList
                            aria-label={i18n._(
                              msg({ id: "chat.prompt.addFiles", message: "Add files" })
                            )}
                            items={attachments.map((attachment) => ({
                              id: attachment.id,
                              kind:
                                isOwnedDraftAttachment(attachment) && attachment.kind === "image"
                                  ? "image"
                                  : "file",
                              name: draftAttachmentName(attachment),
                              detail:
                                isOwnedDraftAttachment(attachment) &&
                                attachment.status === "unavailable"
                                  ? attachment.error
                                  : draftAttachmentMimeType(attachment),
                            }))}
                            onRemove={(id) => {
                              const removed = attachments.find((item) => item.id === id)
                              setAttachments((current) => current.filter((item) => item.id !== id))
                              if (removed) void deleteDraftAttachments([removed])
                            }}
                            onReorder={(ids) =>
                              setAttachments((current) =>
                                ids.flatMap((id) => current.find((item) => item.id === id) ?? [])
                              )
                            }
                            removeLabel={(item) =>
                              `${i18n._(msg({ id: "common.remove", message: "Remove" }))} ${item.name}`
                            }
                          />
                        </ChatComposerHeader>
                      ) : null}
                      {queueQuery.data?.data.length ||
                      goalQuery.data?.goal ||
                      usageQuery.data?.threadUsage ? (
                        <ChatComposerHeader>
                          <ChatFixedTurnSummary>
                            {goalQuery.data?.goal ? (
                              <ChatFixedTurnSummaryItem
                                kind="goal"
                                label={goalQuery.data.goal.objective}
                              />
                            ) : null}
                            {queueQuery.data?.data.length ? (
                              <ChatFixedTurnSummaryItem
                                kind="status"
                                label={`${queueQuery.data.data.length} ${i18n._(
                                  msg({ id: "chat.queue.queuedCount", message: "queued" })
                                )}`}
                              />
                            ) : null}
                          </ChatFixedTurnSummary>
                          {queueQuery.data?.data.length ? (
                            <ChatQueuedInputList>
                              {queueQuery.data.data.map((queued, index) => (
                                <ChatQueuedInputItem
                                  key={queued.id}
                                  position={String(index + 1)}
                                  state="queued"
                                  stateLabel={i18n._(
                                    msg({ id: "chat.queue.queued", message: "Queued" })
                                  )}
                                >
                                  {queued.input
                                    .map((input) =>
                                      input.type === "text" ? input.text : `[${input.type}]`
                                    )
                                    .join(" ")}
                                </ChatQueuedInputItem>
                              ))}
                            </ChatQueuedInputList>
                          ) : null}
                        </ChatComposerHeader>
                      ) : null}
                      <ChatComposerBody>
                        {desktopPreferences?.composerPlainTextMode ? (
                          <ChatComposerTextarea
                            aria-label={i18n._(
                              msg({ id: "chat.prompt.label", message: "Message Cypheria" })
                            )}
                            onChange={(event) => setComposer(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                              if (event.shiftKey && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault()
                                oppositeFollowUp.current = true
                                composerForm.current?.requestSubmit()
                              } else if (event.metaKey || event.ctrlKey) {
                                event.preventDefault()
                                composerForm.current?.requestSubmit()
                              }
                            }}
                            submitOnEnter={
                              desktopPreferences?.composerEnterBehavior !== "cmdAlways" &&
                              (desktopPreferences?.composerEnterBehavior !== "cmdIfMultiline" ||
                                !composer.includes("\n"))
                            }
                            placeholder={
                              busy
                                ? i18n._(
                                    msg({
                                      id: "chat.prompt.steerPlaceholder",
                                      message: "Steer the current task…",
                                    })
                                  )
                                : i18n._(
                                    msg({
                                      id: "chat.prompt.placeholderShort",
                                      message: "Ask anything…",
                                    })
                                  )
                            }
                            value={composer}
                          />
                        ) : (
                          <ChatComposerEditor
                            key={composerEpoch}
                            initialDocument={
                              draftSnapshotRef.current?.text === composer
                                ? (composerDocumentRef.current ?? undefined)
                                : undefined
                            }
                            aria-label={i18n._(
                              msg({ id: "chat.prompt.label", message: "Message Cypheria" })
                            )}
                            onChange={(text, document) => {
                              composerDocumentRef.current = document
                              setComposer(text)
                            }}
                            onAlternateSubmit={() => {
                              oppositeFollowUp.current = true
                              composerForm.current?.requestSubmit()
                            }}
                            onSubmit={() => composerForm.current?.requestSubmit()}
                            onPasteFiles={(files) => void attachFiles(files)}
                            onPasteLongText={(text) =>
                              void attachFiles([
                                new File([text], "Pasted text.txt", { type: "text/plain" }),
                              ])
                            }
                            onCommand={(id) => {
                              if (id === "attach") attachmentInput.current?.click()
                              if (id === "clear") setComposer("")
                              if (id === "new")
                                void navigate({
                                  search: {
                                    agent: agentId,
                                    project: initialProjectId,
                                    section: initialSectionId,
                                  },
                                })
                              if (id === "status") {
                                setSummaryCheckpoint((current) => ({ ...current, open: true }))
                              }
                              if (id === "goal") {
                                setOpenRightTabs((current) =>
                                  current.includes("goal") ? current : [...current, "goal"]
                                )
                                setRightTab("goal")
                                setRightVisibility("visible")
                              }
                              if (id.startsWith("review-") && gitCwd && snapshot.thread) {
                                const cwd = gitCwd
                                void (async () => {
                                  const git = (await ensureCypheriaClient()).git
                                  if (id === "review-uncommitted") {
                                    setReviewSource("uncommitted")
                                    openRightTab("review")
                                    await controller.submit(
                                      [
                                        {
                                          text: codeReviewPrompt({ mode: "uncommitted" }),
                                          type: "text",
                                        },
                                      ],
                                      busy ? "queue" : "send"
                                    )
                                    return
                                  }
                                  const baseBranch = id.slice("review-branch:".length)
                                  const [comparison, context] = await Promise.all([
                                    git.branchComparison(cwd, baseBranch),
                                    git.branchContext(cwd),
                                  ])
                                  setReviewBase(baseBranch)
                                  setReviewSource("branch")
                                  openRightTab("review")
                                  await controller.submit(
                                    [
                                      {
                                        text: codeReviewPrompt({
                                          baseBranch,
                                          mergeBase: comparison.mergeBase,
                                          mode: "branch",
                                          sourceBranch: context.current ?? "HEAD",
                                        }),
                                        type: "text",
                                      },
                                    ],
                                    busy ? "queue" : "send"
                                  )
                                })().catch((error: unknown) =>
                                  setTimelineActionError(
                                    error instanceof Error ? error : new Error(String(error))
                                  )
                                )
                              }
                              const codexSessionId = snapshot.thread?.agentSessionId
                              if (id === "compact" && codexSessionId) {
                                void ensureCypheriaClient().then((client) =>
                                  client.harnesses.codex.threads.compact({
                                    threadId: codexSessionId,
                                  })
                                )
                              }
                            }}
                            suggestions={async (trigger, query) => {
                              if (trigger === "/") {
                                const commands = [
                                  {
                                    id: "attach",
                                    label: i18n._(
                                      msg({ id: "chat.prompt.addFiles", message: "Add files" })
                                    ),
                                  },
                                  {
                                    id: "clear",
                                    label: i18n._(
                                      msg({ id: "chat.prompt.clear", message: "Clear prompt" })
                                    ),
                                  },
                                  {
                                    id: "new",
                                    label: i18n._(
                                      msg({ id: "chat.prompt.newChat", message: "New chat" })
                                    ),
                                  },
                                  ...(codex && snapshot.thread
                                    ? [
                                        {
                                          id: "goal",
                                          label: i18n._(
                                            msg({ id: "chat.panel.goal", message: "Goal" })
                                          ),
                                        },
                                        {
                                          id: "status",
                                          label: i18n._(
                                            msg({ id: "chat.prompt.status", message: "Status" })
                                          ),
                                        },
                                        {
                                          id: "compact",
                                          label: i18n._(
                                            msg({
                                              id: "chat.prompt.compact",
                                              message: "Compact context",
                                            })
                                          ),
                                        },
                                      ]
                                    : []),
                                ]
                                if (gitCwd && snapshot.thread) {
                                  commands.push({
                                    id: "review-uncommitted",
                                    label: i18n._(
                                      msg({
                                        id: "chat.prompt.reviewUncommitted",
                                        message: "Code review: uncommitted changes",
                                      })
                                    ),
                                  })
                                  const branches = await ensureCypheriaClient()
                                    .then((client) => client.git.searchBranches(gitCwd, "", 20))
                                    .catch(() => [])
                                  for (const branch of branches) {
                                    if (branch.current || branch.scope !== "local") continue
                                    commands.push({
                                      id: `review-branch:${branch.name}`,
                                      label: i18n._({
                                        ...msg({
                                          id: "chat.prompt.reviewBranch",
                                          message: "Code review against {branch}",
                                        }),
                                        values: { branch: branch.name },
                                      }),
                                    })
                                  }
                                }
                                return commands
                                  .filter((item) =>
                                    item.label.toLowerCase().includes(query.toLowerCase())
                                  )
                                  .map((item) => ({ ...item, kind: "command" as const }))
                              }
                              const client = await ensureCypheriaClient()
                              const result = await client.threads.composer.suggest({
                                agentId: snapshot.thread ? undefined : agentId,
                                roots: snapshot.thread ? undefined : project?.roots,
                                query,
                                threadId: snapshot.thread?.id,
                                trigger,
                              })
                              return result.items.map((item) => ({
                                description: item.description ?? undefined,
                                id: item.id,
                                kind:
                                  item.kind === "workspace-file"
                                    ? ("file" as const)
                                    : item.kind === "mcp-resource"
                                      ? ("resource" as const)
                                      : item.kind,
                                label: item.label,
                                target:
                                  item.kind === "app"
                                    ? `app://${item.id}`
                                    : item.kind === "plugin"
                                      ? `plugin://${item.id}`
                                      : item.kind === "thread"
                                        ? `thread://${item.id}`
                                        : item.kind === "browser-tab"
                                          ? `browser://${item.id}`
                                          : item.kind === "mcp-resource"
                                            ? `mcp-resource:${encodeURIComponent(item.id)}`
                                            : item.id,
                              }))
                            }}
                            submitOnEnter={
                              desktopPreferences?.composerEnterBehavior !== "cmdAlways" &&
                              (desktopPreferences?.composerEnterBehavior !== "cmdIfMultiline" ||
                                !composer.includes("\n"))
                            }
                            placeholder={
                              busy
                                ? i18n._(
                                    msg({
                                      id: "chat.prompt.steerPlaceholder",
                                      message: "Steer the current task…",
                                    })
                                  )
                                : i18n._(
                                    msg({
                                      id: "chat.prompt.placeholderShort",
                                      message: "Ask anything…",
                                    })
                                  )
                            }
                            value={composer}
                          />
                        )}
                      </ChatComposerBody>
                      <ChatComposerFooter>
                        <ChatComposerUtilityBar>
                          <ChatComposerControl
                            label={i18n._(
                              msg({ id: "chat.prompt.addFiles", message: "Add files" })
                            )}
                            onClick={() => attachmentInput.current?.click()}
                            size="icon-sm"
                            tooltip={i18n._(
                              msg({ id: "chat.prompt.addFiles", message: "Add files" })
                            )}
                          >
                            <ClipIcon />
                          </ChatComposerControl>
                          {project && snapshot.thread ? (
                            <ChatContextChip label={project.name} />
                          ) : null}
                          <ComposerModelSelector
                            agentId={agentId}
                            allowAgentChange={!threadId}
                            onAgentChange={(nextAgentId) => {
                              if (threadId || nextAgentId === agentId) return
                              void navigate({
                                search: {
                                  agent: nextAgentId,
                                  project: initialProjectId,
                                  prompt: composer || undefined,
                                  section: initialSectionId,
                                },
                                to: "/",
                              })
                            }}
                            onThreadConfigChange={(patch) => controller.updateConfig(patch)}
                            threadConfig={snapshot.thread?.config}
                          />
                          {codex ? (
                            <Select
                              onValueChange={(value) => {
                                if (
                                  value === "auto" ||
                                  value === "guardian-approvals" ||
                                  value === "full-access" ||
                                  value === "agent-config"
                                ) {
                                  void updatePermissionMode(value)
                                }
                              }}
                              value={permissionMode}
                            >
                              <SelectTrigger
                                aria-label={i18n._(
                                  msg({ id: "chat.permissions", message: "Permissions" })
                                )}
                                className="h-7 max-w-40 border-0 bg-transparent px-2 text-xs shadow-none"
                                size="sm"
                              >
                                <LockKeyHoleIcon />
                                <SelectValue>{permissionLabel}</SelectValue>
                              </SelectTrigger>
                              <SelectContent className="min-w-80" alignItemWithTrigger={false}>
                                {permissionOptions.map((option) => (
                                  <SelectItem
                                    className="items-start py-2"
                                    key={option.value}
                                    value={option.value}
                                  >
                                    <span className="flex min-w-0 flex-col items-start gap-0.5 whitespace-normal">
                                      <span className="font-medium">{option.label}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {option.description}
                                      </span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}
                          {desktopPreferences?.showContextWindowUsage && contextUsageQuery.data ? (
                            <ContextUsage usage={contextUsageQuery.data} />
                          ) : null}
                          {usageQuery.data?.threadUsage ? (
                            <ChatComposerMeter
                              detail={`${(
                                usageQuery.data.threadUsage.estimatedUsageCreditsMicros / 1_000_000
                              ).toFixed(2)} ${i18n._(
                                msg({ id: "chat.usage.credits", message: "credits" })
                              )}`}
                              label={i18n._(
                                msg({ id: "chat.usage.estimated", message: "Estimated usage" })
                              )}
                              max={1_000_000}
                              value={usageQuery.data.threadUsage.estimatedUsageCreditsMicros}
                            />
                          ) : null}
                        </ChatComposerUtilityBar>
                        <ChatComposerSubmit
                          disabled={!busy && !composer.trim() && attachments.length === 0}
                          onStop={() => void controller.cancel()}
                          status={composerStatus}
                          stopLabel={i18n._(msg({ id: "chat.prompt.stop", message: "Stop" }))}
                          submitLabel={i18n._(msg({ id: "chat.prompt.send", message: "Send" }))}
                        />
                      </ChatComposerFooter>
                      {displayedError ? (
                        <ChatComposerBanner
                          title={i18n._(
                            msg({ id: "chat.error.conversation", message: "Conversation error" })
                          )}
                          tone="error"
                        >
                          {displayedError.message}
                        </ChatComposerBanner>
                      ) : null}
                    </ChatComposerForm>
                  )}
                </ChatComposerFrame>
              </div>
            </ChatComposerDock>
            <ProjectCreateDialog
              onCreated={(projectId) => chooseNewProject(projectId)}
              onOpenChange={setProjectCreateOpen}
              open={projectCreateOpen}
            />
            {codex ? (
              <CodexSummary
                checkpoint={summaryCheckpoint}
                mode={summaryMode}
                onCheckpointChange={setSummaryCheckpoint}
                onOpenSchedule={() => void navigate({ to: "/schedules" })}
                onOpenTab={(id) => {
                  setOpenRightTabs((current) => (current.includes(id) ? current : [...current, id]))
                  setRightTab(id)
                  setRightVisibility("visible")
                }}
                open={summaryCheckpoint.open}
                project={project}
                terminals={terminals}
                thread={snapshot.thread}
              />
            ) : null}
          </ChatMainColumn>
        </ChatWorkspaceShell>
      </ChatMarkdownHostContext.Provider>
    </ExtensionWorkspaceContext.Provider>
  )
}
