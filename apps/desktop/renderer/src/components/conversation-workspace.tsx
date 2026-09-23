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
  ChatComposerAttachment,
  ChatComposerAttachmentTray,
  ChatComposerBanner,
  ChatComposerBody,
  ChatComposerControl,
  ChatComposerDock,
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
  ChatTurnNotice,
  ChatUserInputRequest,
  ChatUserMessage,
  ChatWorkspaceShell,
} from "@cypheria/ui/components/chat"
import {
  AgentIcon,
  ArrowDownIcon,
  BrainIcon,
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
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { Route } from "../routes/index.js"
import { sidebarData, sidebarQueryKeys } from "../sidebar-data.js"
import {
  type ConversationSubmitMode,
  ThreadConversationController,
} from "../thread-conversation-controller.js"
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

type ComposerAttachment = {
  block: ThreadInputBlock
  id: string
  mimeType: string
  name: string
}

const fileBlock = async (file: File): Promise<ComposerAttachment> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  const data = btoa(binary)
  const mimeType = file.type || "application/octet-stream"
  const block: ThreadInputBlock = mimeType.startsWith("image/")
    ? { data, mimeType, type: "image" }
    : mimeType.startsWith("audio/")
      ? { data, mimeType, type: "audio" }
      : { data, mimeType, name: file.name, type: "embedded-resource", uri: file.name }
  return { block, id: crypto.randomUUID(), mimeType, name: file.name }
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

function TimelineItemView({ entry }: { entry: ThreadTimelineProjectedItem }) {
  const { i18n } = useLingui()
  const item = entry.item
  if (item.type === "message") {
    return (
      <ChatTimelineItem kind={item.role}>
        {item.role === "user" ? (
          <ChatUserMessage>{item.text}</ChatUserMessage>
        ) : (
          <ChatAssistantMessage>
            <ChatMessageContent isAnimating={false}>{item.text}</ChatMessageContent>
          </ChatAssistantMessage>
        )}
      </ChatTimelineItem>
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
  loading,
  loadingOlder,
  hasOlder,
  onLoadOlder,
}: {
  items: readonly ThreadTimelineProjectedItem[]
  loading: boolean
  loadingOlder: boolean
  hasOlder: boolean
  onLoadOlder: () => void
}) {
  const { i18n } = useLingui()
  const parentRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const initialPositioned = useRef(false)
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 160,
    getItemKey: (index) => {
      const entry = items[index]
      return entry ? `${entry.turnId ?? "thread"}:${entry.item.itemId}` : index
    },
    getScrollElement: () => parentRef.current,
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useLayoutEffect(() => {
    if (!items.length || initialPositioned.current) return
    initialPositioned.current = true
    virtualizer.scrollToIndex(items.length - 1, { align: "end", behavior: "auto" })
  }, [items.length, virtualizer])

  useLayoutEffect(() => {
    if (!following || !items.length) return
    virtualizer.scrollToIndex(items.length - 1, { align: "end", behavior: "auto" })
  }, [following, items.length, virtualizer])

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
        ) : items.length === 0 ? (
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
              const entry = items[virtualItem.index]
              if (!entry) return null
              return (
                <div
                  className="absolute top-0 left-0 w-full px-2 pb-8 sm:px-3"
                  data-index={virtualItem.index}
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${virtualItem.start + 32}px)` }}
                >
                  <TimelineItemView entry={entry} />
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
            virtualizer.scrollToIndex(items.length - 1, { align: "end", behavior: "auto" })
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
  const Surface = isPermission
    ? ChatPermissionRequest
    : isElicitation
      ? ChatMcpElicitationRequest
      : ChatUserInputRequest
  return (
    <Surface
      description={interaction.message}
      title={
        interaction.title ??
        i18n._(msg({ id: "chat.interaction.actionRequired", message: "Action required" }))
      }
    >
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
  const projectsQuery = useQuery({
    queryFn: () => sidebarData.listProjects(),
    queryKey: sidebarQueryKeys.projects(),
  })
  const desktopPreferencesQuery = useQuery({
    queryFn: () => window.cypheria?.settings.getPreferences(),
    queryKey: ["settings", "preferences"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const workspaceLayoutQuery = useQuery({
    queryFn: () => window.cypheria?.settings.getWorkspaceLayout(),
    queryKey: ["settings", "workspace-layout"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const desktopPreferences = desktopPreferencesQuery.data
  const workspaceLayout = workspaceLayoutQuery.data
  useEffect(
    () =>
      window.cypheria?.settings.onPreferencesChanged((settings) => {
        queryClient.setQueryData(["settings", "preferences"], settings)
      }),
    [queryClient]
  )
  const project = projectsQuery.data?.data.find((item) => item.id === initialProjectId)
  const [controller] = useState(
    () =>
      new ThreadConversationController({
        agentId,
        cwd: project?.roots[0],
        initialThreadId,
        projectId: initialProjectId,
        sectionId: initialSectionId,
        onThreadCreated: (threadId) => {
          sidebarData.invalidate()
          void queryClient.invalidateQueries({ queryKey: sidebarQueryKeys.all })
          void navigate({ replace: true, search: { thread: threadId } })
        },
      })
  )
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  const [composer, setComposer] = useState(initialPrompt ?? "")
  const [contextUsage, setContextUsage] = useState<{ tokens: number; max: number } | null>(null)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentInput = useRef<HTMLInputElement>(null)
  const [rightVisibility, setRightVisibility] = useState<ChatPanelVisibility>(
    codex ? "visible" : "hidden"
  )
  const [bottomVisibility, setBottomVisibility] = useState<ChatPanelVisibility>("hidden")
  const [rightFullscreen, setRightFullscreen] = useState(false)
  const [wideViewport, setWideViewport] = useState(true)
  const [rightTab, setRightTab] = useState<string | undefined>("summary")
  const [openRightTabs, setOpenRightTabs] = useState<string[]>(["summary"])
  const terminals = useWorkspaceTerminals(initialProjectId)

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
  useEffect(() => {
    if (!codex || !threadId) return
    let unsubscribe: (() => void) | undefined
    let disposed = false
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribe = client.harnesses.codex.threads.subscribeUsage(threadId, (update) => {
        const max = update.tokenUsage.modelContextWindow
        if (max) setContextUsage({ tokens: update.tokenUsage.last.totalTokens, max })
      })
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [codex, threadId])
  const modelsQuery = useQuery({
    enabled: codex,
    queryFn: async () => (await ensureCypheriaClient()).harnesses.codex.models.list(),
    queryKey: ["codex", "models"],
  })
  const modelSettingsQuery = useQuery({
    enabled: codex,
    queryFn: async () => (await ensureCypheriaClient()).harnesses.codex.models.settings(),
    queryKey: ["codex", "model-settings"],
  })
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
          <GitReviewPanel cwd={gitCwd} fallback={timelineReview} />
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
    i18n,
    plans,
    reviewFiles,
    snapshot.items.length,
    sources,
    subagents,
    terminals,
    rightVisibility,
    rightTab,
  ])

  const rightTabs = panelTabs.filter((tab) => openRightTabs.includes(tab.id))
  const launcherItems = panelTabs.map<ChatPanelLauncherItem>((tab) => ({
    disabled: openRightTabs.includes(tab.id),
    icon: tab.icon,
    id: tab.id,
    label: tab.title,
  }))
  const pending = snapshot.thread?.pendingInteractions[0]
  const busy = snapshot.thread?.state === "running" || snapshot.thread?.state === "starting"
  const composerStatus = snapshot.error ? "error" : busy ? "streaming" : "ready"
  const configuredModel =
    modelsQuery.data?.find((model) => model.model === modelSettingsQuery.data?.model) ??
    modelsQuery.data?.find((model) => model.isDefault) ??
    modelsQuery.data?.[0]
  const permissionLabel = (() => {
    const selected = permissionsQuery.data?.selected
    if (!selected) return i18n._(msg({ id: "chat.permissions", message: "Permissions" }))
    if (selected.kind === "profile") return selected.profileId
    if (selected.kind === "agent-mode") return selected.agentMode
    return selected.kind
  })()
  const updateModel = async (modelId: string, effort?: string | null) => {
    const settings = modelSettingsQuery.data
    if (!settings) return
    await (await ensureCypheriaClient()).harnesses.codex.models.setSettings({
      ...settings,
      model: modelId,
      reasoningEffort: effort ?? settings.reasoningEffort,
    })
    if (busy) {
      await controller.updateConfig({
        model: modelId,
        thinking: effort ?? settings.reasoningEffort,
      })
    }
    await queryClient.invalidateQueries({ queryKey: ["codex", "model-settings"] })
  }
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
      networkAccess: mode !== "read-only",
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
    setComposer("")
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
        [
          ...(text ? [{ text, type: "text" } as const] : []),
          ...submittedAttachments.map(({ block }) => block),
        ],
        mode
      )
    } catch {
      setComposer(text)
      setAttachments(submittedAttachments)
    }
  }

  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ""
    if (files.length === 0) return
    const next = await Promise.all(files.map(fileBlock))
    setAttachments((current) => [...current, ...next])
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
        state={snapshot.error ? "error" : busy ? "running" : "idle"}
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        {snapshot.error
          ? snapshot.error.message
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
      rightPanelResizeLabel={i18n._(
        msg({ id: "chat.workspace.resizeSidePanel", message: "Resize side panel" })
      )}
      rightPanelVisibility={codex && wideViewport ? rightVisibility : "closed"}
    >
      <ChatMainColumn>
        <VirtualTimeline
          hasOlder={snapshot.hasOlder}
          items={snapshot.items}
          loading={snapshot.loadState === "loading"}
          loadingOlder={snapshot.loadingOlder}
          onLoadOlder={() => void controller.loadOlder()}
        />
        <ChatComposerDock>
          <ChatComposerFrame>
            {pending ? (
              <PendingInteraction
                interaction={pending}
                onRespond={(response) => void controller.respond(pending.id, response)}
              />
            ) : (
              <ChatComposerForm onSubmit={submit}>
                <input
                  className="sr-only"
                  multiple
                  onChange={(event) => void attach(event)}
                  ref={attachmentInput}
                  type="file"
                />
                {attachments.length ? (
                  <ChatComposerHeader>
                    <ChatComposerAttachmentTray>
                      {attachments.map((attachment) => (
                        <ChatComposerAttachment
                          key={attachment.id}
                          metadata={attachment.mimeType}
                          name={attachment.name}
                          onRemove={() =>
                            setAttachments((current) =>
                              current.filter((item) => item.id !== attachment.id)
                            )
                          }
                          removeLabel={`${i18n._(msg({ id: "common.remove", message: "Remove" }))} ${attachment.name}`}
                        />
                      ))}
                    </ChatComposerAttachmentTray>
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
                  <ChatComposerTextarea
                    aria-label={i18n._(
                      msg({ id: "chat.prompt.label", message: "Message Cypheria" })
                    )}
                    onChange={(event) => setComposer(event.currentTarget.value)}
                    onPaste={(event) => {
                      if (desktopPreferences?.composerPlainTextMode) return
                      const url = event.clipboardData.getData("text/plain").trim()
                      const field = event.currentTarget
                      const selected = field.value.slice(field.selectionStart, field.selectionEnd)
                      if (!selected || !/^https?:\/\/\S+$/u.test(url)) return
                      event.preventDefault()
                      setComposer(
                        `${field.value.slice(0, field.selectionStart)}[${selected}](${url})${field.value.slice(field.selectionEnd)}`
                      )
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                      if (event.shiftKey && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        oppositeFollowUp.current = true
                        event.currentTarget.form?.requestSubmit()
                      } else if (
                        desktopPreferences?.composerEnterBehavior !== "enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
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
                    <ChatContextChip label={agentId} />
                    {project ? <ChatContextChip label={project.name} /> : null}
                    {codex && configuredModel ? (
                      <Select
                        onValueChange={(value) => {
                          if (!value) return
                          const model = modelsQuery.data?.find(
                            (candidate) => candidate.model === value
                          )
                          void updateModel(value, model?.defaultReasoningEffort)
                        }}
                        value={configuredModel.model}
                      >
                        <SelectTrigger
                          aria-label={i18n._(msg({ id: "chat.model", message: "Model" }))}
                          className="h-7 max-w-40 border-0 bg-transparent px-2 text-xs shadow-none"
                          size="sm"
                        >
                          <BrainIcon />
                          <SelectValue>{configuredModel.displayName}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {modelsQuery.data?.map((model) => (
                            <SelectItem key={model.id} value={model.model}>
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    {codex && configuredModel?.reasoningEfforts.length ? (
                      <Select
                        onValueChange={(value) =>
                          value && void updateModel(configuredModel.model, value)
                        }
                        value={
                          modelSettingsQuery.data?.reasoningEffort ??
                          configuredModel.defaultReasoningEffort
                        }
                      >
                        <SelectTrigger
                          aria-label={i18n._(
                            msg({ id: "chat.reasoningEffort", message: "Reasoning effort" })
                          )}
                          className="h-7 max-w-32 border-0 bg-transparent px-2 text-xs shadow-none"
                          size="sm"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {configuredModel.reasoningEfforts.map((effort) => (
                            <SelectItem key={effort.value} value={effort.value}>
                              {effort.value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
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
                                (mode !== "full-access" || permissionsQuery.data?.showFullAccess)
                            )
                            .map((mode) => (
                              <SelectItem key={mode} value={mode}>
                                {mode}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    {desktopPreferences?.showContextWindowUsage && contextUsage ? (
                      <ChatComposerMeter
                        detail={`${contextUsage.tokens.toLocaleString()} / ${contextUsage.max.toLocaleString()} tokens`}
                        label="Context window"
                        max={contextUsage.max}
                        value={contextUsage.tokens}
                      />
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
                {snapshot.error ? (
                  <ChatComposerBanner
                    title={i18n._(
                      msg({ id: "chat.error.conversation", message: "Conversation error" })
                    )}
                    tone="error"
                  >
                    {snapshot.error.message}
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
