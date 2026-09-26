import type {
  AgentId,
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
  ChatFilePreviewPanel,
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
  ChatSummaryPanel,
  ChatSummarySection,
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
} from "@cypheria/ui/components/chat"
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
  ClipIcon,
  CollapseIcon,
  DockIcon,
  ExpandIcon,
  FileIcon,
  FileImageIcon,
  GlobeIcon,
  LockKeyHoleIcon,
  McpIcon,
  PinIcon,
  SidebarRightIcon,
  TasksIcon,
} from "@cypheria/ui/components/icons"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import type { I18n } from "@lingui/core"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { atom, useAtom, useAtomValue } from "jotai"
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
import {
  clientStateStore,
  composerDraftAtom,
  composerEnterBehaviorAtom,
  composerPlainTextModeAtom,
  defaultTerminalLocationAtom,
  followUpQueueModeAtom,
  panelLayoutAtom,
  permissionModeVisibilityAtom,
  projectlessWorkspaceRootAtom,
  showBottomPanelControlAtom,
  showContextWindowUsageAtom,
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
import { Route } from "../routes/index.js"
import { sidebarData, sidebarQueryKeys } from "../sidebar-data.js"
import {
  type ConversationSubmitMode,
  ThreadConversationController,
} from "../thread-conversation-controller.js"
import { ComposerModelSelector } from "./composer-model-selector.js"
import { ContextUsage } from "./context-usage.js"
import { GitReviewPanel } from "./git-review-panel.js"
import { useWorkspaceTerminals, WorkspaceTerminalView } from "./workspace-terminal.js"

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
            <ChatUserMessage>{item.text}</ChatUserMessage>
          ) : (
            <ChatAssistantMessage>
              <ChatMessageContent isAnimating={false}>{item.text}</ChatMessageContent>
            </ChatAssistantMessage>
          )}
        </ChatTimelineItem>
        {forkAction || rewindAction ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={i18n._(
                    msg({ id: "chat.message.actions", message: "Message actions" })
                  )}
                  className="absolute -bottom-7 right-0 size-7 opacity-0 transition-opacity group-hover/message:opacity-100 data-[state=open]:opacity-100"
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

function VirtualTimeline({
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
        ) : isElicitation ? (
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
  initialPrompt,
  initialProjectId,
  initialSectionId,
  initialThreadId,
  codex,
}: {
  agentId: AgentId
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
    permissionModeVisibility: useAtomValue(permissionModeVisibilityAtom),
    showContextWindowUsage: useAtomValue(showContextWindowUsageAtom),
  }
  const workspaceLayout = {
    defaultTerminalLocation: useAtomValue(defaultTerminalLocationAtom),
    showBottomPanelControl: useAtomValue(showBottomPanelControlAtom),
  }
  const project = projectsQuery.data?.data.find((item) => item.id === initialProjectId)
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
    persistedPanelLayout?.right.activeTab ?? "summary"
  )
  const [openRightTabs, setOpenRightTabsState] = useState<string[]>(
    persistedPanelLayout?.right.openTabs.length ? persistedPanelLayout.right.openTabs : ["summary"]
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
  const terminals = useWorkspaceTerminals(initialProjectId)

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
  }, [attachments, composer, setPersistedDraft])

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
    void controller.connect()
    return () => controller.dispose()
  }, [controller])

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
  const permissionsQuery = useQuery({
    enabled: codex,
    queryFn: async () =>
      (await ensureCypheriaClient()).harnesses.codex.permissions.catalog(project?.roots[0]),
    queryKey: ["codex", "permissions", project?.roots[0]],
  })
  const permissionDefaultsQuery = useQuery({
    enabled: codex,
    queryFn: async () => (await ensureCypheriaClient()).harnesses.codex.permissions.defaults(),
    queryKey: ["codex", "permission-defaults"],
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
    snapshot.thread?.cwd ?? project?.roots[0] ?? desktopPreferences?.projectlessWorkspaceRoot

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
        content: (
          <ChatSummaryPanel>
            <ChatSummarySection
              title={i18n._(msg({ id: "chat.panel.conversation", message: "Conversation" }))}
            >
              {snapshot.items.length} timeline items
            </ChatSummarySection>
            <ChatSummarySection
              title={i18n._(msg({ id: "chat.panel.activity", message: "Activity" }))}
            >
              {diffs.length} change sets · {sources.length} sources · {subagents.length} subagents
            </ChatSummarySection>
          </ChatSummaryPanel>
        ),
        icon: <ChatIcon />,
        id: "summary",
        title: i18n._(msg({ id: "chat.panel.summary", message: "Summary" })),
      },
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
            cwd={gitCwd}
            fallback={timelineReview}
            onAddFile={(path) =>
              setComposer(
                (current) => `${current}${current && !/\s$/u.test(current) ? " " : ""}@${path} `
              )
            }
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
        content: artifacts.length ? (
          <ChatFilePreviewPanel>
            <ChatPanelContent>
              {artifacts.map(({ item }) =>
                item.type === "artifact" ? (
                  <div className="py-2" key={item.itemId}>
                    {item.name}
                    <div className="truncate text-xs text-muted-foreground">{item.uri}</div>
                  </div>
                ) : null
              )}
            </ChatPanelContent>
          </ChatFilePreviewPanel>
        ) : (
          <EmptyPanel>
            <Trans id="chat.panel.files.empty">No files were produced</Trans>
          </EmptyPanel>
        ),
        icon: <FileIcon />,
        id: "files",
        title: i18n._(msg({ id: "chat.panel.files", message: "Files" })),
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
        content: (
          <ChatBrowserPanel>
            <EmptyPanel>
              <Trans id="chat.panel.browser.empty">No browser session is open</Trans>
            </EmptyPanel>
          </ChatBrowserPanel>
        ),
        icon: <GlobeIcon />,
        id: "browser",
        title: i18n._(msg({ id: "chat.panel.browser", message: "Browser" })),
      },
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
    snapshot.thread?.id,
    i18n,
    plans,
    reviewFiles,
    snapshot.items.length,
    sources,
    subagents,
    terminals,
    rightVisibility,
    rightTab,
    setRightVisibility,
  ])

  const rightTabs = panelTabs.filter((tab) => openRightTabs.includes(tab.id))
  useEffect(() => {
    const validIds = new Set(panelTabs.map((tab) => tab.id))
    setOpenRightTabsState((current) => {
      const filtered = current.filter((id) => validIds.has(id))
      return filtered.length === current.length ? current : filtered
    })
    setRightTabState((current) => (current && validIds.has(current) ? current : "summary"))
  }, [panelTabs])
  const launcherItems = panelTabs.map<ChatPanelLauncherItem>((tab) => ({
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
  const permissionLabel = (() => {
    const selected = permissionsQuery.data?.selected
    if (!selected) return i18n._(msg({ id: "chat.permissions", message: "Permissions" }))
    if (selected.kind === "profile") return selected.profileId
    if (selected.kind === "agent-mode") return selected.agentMode
    return selected.kind
  })()
  const updatePermissionMode = async (
    mode: "read-only" | "auto" | "guardian-approvals" | "full-access"
  ) => {
    const defaults = permissionDefaultsQuery.data
    if (!defaults) return
    const {
      allowedApprovalPolicies: _allowedApprovalPolicies,
      allowedSandboxModes: _allowedSandboxModes,
      allowedWebSearchModes: _allowedWebSearchModes,
      configPath: _configPath,
      ...write
    } = defaults
    await (await ensureCypheriaClient()).harnesses.codex.permissions.setDefaults({
      ...write,
      approvalPolicy: mode === "full-access" ? "never" : "on-request",
      approvalsReviewer: mode === "guardian-approvals" ? "auto_review" : "user",
      networkAccess: defaults.networkAccess,
      sandboxMode:
        mode === "read-only"
          ? "read-only"
          : mode === "full-access"
            ? "danger-full-access"
            : "workspace-write",
    })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["codex", "permission-defaults"] }),
      queryClient.invalidateQueries({ queryKey: ["codex", "permissions"] }),
    ])
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
    draftStatusRef.current = "submitting"
    const submittingDraft: ComposerDraft = {
      attachments: submittedAttachments,
      status: "submitting",
      text,
      updatedAt: Date.now(),
    }
    draftSnapshotRef.current = submittingDraft
    await clientStateStore.set(composerDraftAtom(activeDraftScopeRef.current), submittingDraft)
    let inputAttachments: ThreadInputBlock[]
    try {
      inputAttachments = await Promise.all(submittedAttachments.map(draftAttachmentToInputBlock))
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
      await controller.submit(
        [...(text ? [{ text, type: "text" } as const] : []), ...inputAttachments],
        mode
      )
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
    </ChatHeader>
  )

  return (
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
      <ChatMainColumn>
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
          <ChatComposerFrame>
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
                {attachments.length ? (
                  <ChatComposerHeader>
                    <ChatComposerAttachmentList
                      aria-label={i18n._(msg({ id: "chat.prompt.addFiles", message: "Add files" }))}
                      items={attachments.map((attachment) => ({
                        id: attachment.id,
                        kind:
                          isOwnedDraftAttachment(attachment) && attachment.kind === "image"
                            ? "image"
                            : "file",
                        name: draftAttachmentName(attachment),
                        detail:
                          isOwnedDraftAttachment(attachment) && attachment.status === "unavailable"
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
                            stateLabel={i18n._(msg({ id: "chat.queue.queued", message: "Queued" }))}
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
                              msg({ id: "chat.prompt.placeholderShort", message: "Ask anything…" })
                            )
                      }
                      value={composer}
                    />
                  ) : (
                    <ChatComposerEditor
                      key={composerEpoch}
                      aria-label={i18n._(
                        msg({ id: "chat.prompt.label", message: "Message Cypheria" })
                      )}
                      onChange={(text) => setComposer(text)}
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
                      }}
                      suggestions={[
                        ...attachments.map((attachment) => ({
                          id: attachment.id,
                          kind: "file" as const,
                          label: draftAttachmentName(attachment),
                          target: draftAttachmentName(attachment),
                        })),
                        {
                          id: "attach",
                          kind: "command" as const,
                          label: i18n._(msg({ id: "chat.prompt.addFiles", message: "Add files" })),
                        },
                      ]}
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
                              msg({ id: "chat.prompt.placeholderShort", message: "Ask anything…" })
                            )
                      }
                      value={composer}
                    />
                  )}
                </ChatComposerBody>
                <ChatComposerFooter>
                  <ChatComposerUtilityBar>
                    <ChatComposerControl
                      label={i18n._(msg({ id: "chat.prompt.addFiles", message: "Add files" }))}
                      onClick={() => attachmentInput.current?.click()}
                      size="icon-sm"
                      tooltip={i18n._(msg({ id: "chat.prompt.addFiles", message: "Add files" }))}
                    >
                      <ClipIcon />
                    </ChatComposerControl>
                    {project ? <ChatContextChip label={project.name} /> : null}
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
                    />
                    {codex ? (
                      <Select
                        onValueChange={(value) => {
                          if (
                            value === "read-only" ||
                            value === "auto" ||
                            value === "guardian-approvals" ||
                            value === "full-access"
                          ) {
                            void updatePermissionMode(value)
                          }
                        }}
                        value={
                          permissionsQuery.data?.selected.kind === "agent-mode"
                            ? permissionsQuery.data.selected.agentMode
                            : null
                        }
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
                        <SelectContent>
                          {permissionsQuery.data?.availableAgentModes
                            .filter(
                              (mode) =>
                                mode !== "granular" &&
                                (mode !== "full-access" ||
                                  desktopPreferences?.permissionModeVisibility)
                            )
                            .map((mode) => (
                              <SelectItem key={mode} value={mode}>
                                {mode}
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
        </ChatComposerDock>
      </ChatMainColumn>
    </ChatWorkspaceShell>
  )
}
