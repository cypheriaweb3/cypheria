import { useChat } from "@ai-sdk/react"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@cypheria/ui/ai-elements/attachments"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@cypheria/ui/ai-elements/code-block"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@cypheria/ui/ai-elements/conversation"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@cypheria/ui/ai-elements/message"
import {
  isPromptInputPastedText,
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  type PromptInputFile,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@cypheria/ui/ai-elements/prompt-input"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@cypheria/ui/ai-elements/reasoning"
import { Source, Sources, SourcesContent, SourcesTrigger } from "@cypheria/ui/ai-elements/sources"
import { SpeechInput } from "@cypheria/ui/ai-elements/speech-input"
import { Task, TaskContent, TaskItem, TaskTrigger } from "@cypheria/ui/ai-elements/task"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@cypheria/ui/ai-elements/tool"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizablePanelHandle,
} from "@cypheria/ui/components/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cypheria/ui/components/tabs"
import type { I18n } from "@lingui/core"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import type {
  CustomContentUIPart,
  DynamicToolUIPart,
  FileUIPart,
  ReasoningFileUIPart,
  SourceUrlUIPart,
} from "ai"
import { useAtomValue } from "jotai"
import {
  ArrowUp,
  ChevronDown,
  Copy,
  CornerDownLeft,
  Ellipsis,
  FileDiff,
  FolderGit2,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Square,
  TerminalSquare,
  WalletCards,
  Zap,
} from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  CodexChatFollowUp,
  CodexInteractionEvent,
  CodexInteractionResponse,
  CodexModelView,
  CodexPermissionSelection,
  CodexSkillView,
  CodexThreadDetailView,
  CodexUiMessage,
  WalletActiveContext,
} from "../../../ipc/src/index.js"
import {
  acquireCodexChatThreadScope,
  type CodexChatThreadScopeBindings,
  mountCodexChatThreadScope,
} from "../chat-thread-scope.js"
import { type CodexChatOptions, interruptActiveCodexTurns } from "../codex-chat.js"
import { codexMarkdownUrlTransform } from "../generated-image-url.js"
import { Route } from "../routes/index"
import { composerMediaCapabilities } from "./chat-composer"
import { newChatRevisionAtom } from "./chat-navigation"
import {
  type ChatWorkspaceArtifacts,
  deriveChatWorkspaceArtifacts,
  displayChatArtifactPath,
} from "./chat-workspace-artifacts"
import { CodexTurnMessage } from "./codex-turn.js"
import { deriveCodexTurnView } from "./codex-turn-view.js"
import { ProjectCreateDialog } from "./project-create-dialog"
import {
  type TerminalLocation,
  toggleBottomPanelState,
  toggleTerminalPanelState,
} from "./terminal-panel-state"
import {
  getBottomDistanceRestoreOffset,
  type ThreadScrollController,
  useThreadScrollController,
} from "./thread-scroll-controller"
import {
  useWorkspaceTerminals,
  type WorkspaceTerminalsController,
  WorkspaceTerminalView,
} from "./workspace-terminal"
import "./chat-composer.css"

const fallbackModel: CodexModelView = {
  defaultReasoningEffort: "medium",
  defaultServiceTier: null,
  description: "Connect Codex to load available models.",
  displayName: "Codex model",
  hidden: false,
  id: "default",
  inputModalities: ["text"],
  isDefault: true,
  model: "default",
  reasoningEfforts: [{ description: "Balanced reasoning", value: "medium" }],
  serviceTiers: [],
}

const threadIdFromMessage = (message: CodexUiMessage): string | null => {
  const turn = message.parts.find((part) => part.type === "data-codex-turn")
  return turn?.type === "data-codex-turn" ? turn.data.threadId : null
}

type AutoReviewView = {
  readonly event: CodexInteractionResponse["content"] | null
  readonly rationale: string | null
  readonly reviewId: string
  readonly riskLevel: string | null
  readonly status: string
  readonly threadId: string
  readonly turnId: string
  readonly userAuthorization: string | null
}

const permissionSelectionValue = (selection: CodexPermissionSelection): string =>
  selection.kind === "agent-mode"
    ? `mode:${selection.agentMode}`
    : selection.kind === "profile"
      ? `profile:${selection.profileId}`
      : selection.kind

const permissionSelectionFromValue = (value: string): CodexPermissionSelection => {
  if (value.startsWith("profile:")) return { kind: "profile", profileId: value.slice(8) }
  if (value === "custom") return { kind: "custom" }
  if (value === "server-default") return { kind: "server-default" }
  return {
    agentMode: value.slice(5) as Extract<
      CodexPermissionSelection,
      { kind: "agent-mode" }
    >["agentMode"],
    kind: "agent-mode",
  }
}

const permissionSelectionLabel = (selection: CodexPermissionSelection, i18n: I18n): string => {
  if (selection.kind === "profile") return selection.profileId
  if (selection.kind === "custom")
    return i18n._(msg({ id: "chat.permissions.custom", message: "Custom" }))
  if (selection.kind === "server-default")
    return i18n._(msg({ id: "chat.permissions.managed", message: "Managed" }))
  switch (selection.agentMode) {
    case "read-only":
      return i18n._(msg({ id: "chat.sandbox.readOnly", message: "Read only" }))
    case "guardian-approvals":
      return i18n._(msg({ id: "chat.permissions.autoReview", message: "Approve for me" }))
    case "full-access":
      return i18n._(msg({ id: "chat.sandbox.fullAccess", message: "Full access" }))
    case "auto":
    case "granular":
      return i18n._(msg({ id: "chat.permissions.ask", message: "Ask for approval" }))
  }
}

export default function ChatWorkspace() {
  const { thread, prompt, project, section } = Route.useSearch()
  const revision = useAtomValue(newChatRevisionAtom)
  const routeSessionKey =
    thread ?? `new-chat-${revision}-${prompt ?? ""}-${project ?? ""}-${section ?? ""}`
  const [sessionKey, setSessionKey] = useState(routeSessionKey)
  const adoptedThreadId = useRef<string | null>(null)
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false)
  const [terminalLocation, setTerminalLocation] = useState<TerminalLocation>("bottom")
  const bottomPanelSize = useRef(280)
  const [terminalProjectId, setTerminalProjectId] = useState<string | undefined>(project)
  const workspaceTerminals = useWorkspaceTerminals(terminalProjectId)
  const getBottomPanelSize = useCallback(() => bottomPanelSize.current, [])
  const rememberBottomPanelSize = useCallback((size: number) => {
    bottomPanelSize.current = size
  }, [])

  useEffect(() => {
    if (thread && adoptedThreadId.current === thread) {
      adoptedThreadId.current = null
      return
    }
    setSessionKey(routeSessionKey)
  }, [routeSessionKey, thread])

  return (
    <ChatSession
      bottomPanelOpen={bottomPanelOpen}
      getBottomPanelSize={getBottomPanelSize}
      key={sessionKey}
      initialProjectId={project}
      resumeThreadId={thread}
      initialPrompt={prompt}
      initialSectionId={section}
      scrollStateKey={sessionKey}
      onThreadAdopted={(threadId) => {
        adoptedThreadId.current = threadId
      }}
      onTerminalProjectChange={setTerminalProjectId}
      rememberBottomPanelSize={rememberBottomPanelSize}
      setBottomPanelOpen={setBottomPanelOpen}
      setTerminalLocation={setTerminalLocation}
      terminalLocation={terminalLocation}
      workspaceTerminals={workspaceTerminals}
    />
  )
}

function ChatSession({
  bottomPanelOpen,
  getBottomPanelSize,
  resumeThreadId,
  initialPrompt,
  initialProjectId,
  initialSectionId,
  scrollStateKey,
  onThreadAdopted,
  onTerminalProjectChange,
  rememberBottomPanelSize,
  setBottomPanelOpen,
  setTerminalLocation,
  terminalLocation,
  workspaceTerminals,
}: Readonly<{
  bottomPanelOpen: boolean
  getBottomPanelSize: () => number
  resumeThreadId?: string
  initialPrompt?: string
  initialProjectId?: string
  initialSectionId?: string
  scrollStateKey: string
  onThreadAdopted: (threadId: string) => void
  onTerminalProjectChange: (projectId: string | undefined) => void
  rememberBottomPanelSize: (size: number) => void
  setBottomPanelOpen: (open: boolean) => void
  setTerminalLocation: (location: TerminalLocation) => void
  terminalLocation: TerminalLocation
  workspaceTerminals: WorkspaceTerminalsController
}>) {
  const { i18n } = useLingui()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const composerFormId = useId()
  const hydratedThreadId = useRef<string | null>(null)
  const threadScroll = useThreadScrollController(scrollStateKey)
  const threadQuery = useQuery({
    enabled: Boolean(resumeThreadId),
    queryFn: () => {
      const api = window.cypheria?.codex
      if (!api || !resumeThreadId) throw new Error("Codex thread is unavailable.")
      return api.readThread(resumeThreadId)
    },
    queryKey: ["codex", "thread", resumeThreadId],
  })
  const modelSettingsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.getModelSettings(),
    queryKey: ["codex", "model-settings"],
  })
  const modelsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.listModels() ?? [],
    queryKey: ["codex", "models"],
  })
  const workspaceLayoutQuery = useQuery({
    queryFn: () =>
      window.cypheria?.settings.getWorkspaceLayout() ?? {
        configPath: "Browser preview",
        defaultTerminalLocation: "bottom" as const,
        showBottomPanelControl: true,
      },
    queryKey: ["settings", "workspace-layout"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const projectsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.codex.listProjects({ limit: 100 }) ?? { data: [], nextCursor: null },
    queryKey: ["codex", "projects"],
  })
  const activeWalletQuery = useQuery({
    queryFn: () => window.cypheria?.wallet.getActive(),
    queryKey: ["wallet", "active"],
  })
  const settings = modelSettingsQuery.data
  const models = modelsQuery.data ?? []
  const initialModel =
    models.find((model) => model.model === settings?.model) ??
    models.find((model) => model.isDefault) ??
    models[0] ??
    fallbackModel
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjectId ?? null
  )
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleOverride, setTitleOverride] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState("")
  const submitMode = useRef<"queue" | "steer" | null>(null)
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(true)
  const bottomPanelRef = useRef<ResizablePanelHandle>(null)
  const [wideViewport, setWideViewport] = useState(true)
  const [permissionSelection, setPermissionSelection] = useState<CodexPermissionSelection | null>(
    null
  )
  const [interactions, setInteractions] = useState<CodexInteractionEvent[]>([])
  const [autoReviews, setAutoReviews] = useState<AutoReviewView[]>([])
  const [strictReviewTurns, setStrictReviewTurns] = useState<Set<string>>(() => new Set())
  const [createdThreadId, setCreatedThreadId] = useState<string | null>(null)
  const chatScopeMounted = useRef(false)
  const selectedModel = models.find((model) => model.model === selectedModelId) ?? initialModel
  const composerMedia = composerMediaCapabilities(selectedModel.inputModalities)
  const selectedReasoning =
    reasoningEffort ?? settings?.reasoningEffort ?? selectedModel.defaultReasoningEffort
  const provider = settings?.provider ?? "openai"
  const projects = projectsQuery.data?.data ?? []
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const permissionsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.getPermissionsCatalog(selectedProject?.roots[0]),
    queryKey: ["codex", "permissions", selectedProject?.roots[0] ?? null],
  })
  const defaultTerminalLocation = workspaceLayoutQuery.data?.defaultTerminalLocation ?? "bottom"
  const showBottomPanelControl = workspaceLayoutQuery.data?.showBottomPanelControl ?? true
  const skillsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.listSkills({ cwd: selectedProject?.roots[0] }),
    queryKey: ["codex", "skills", selectedProject?.roots[0] ?? null],
  })
  const effectivePermissionSelection = permissionSelection ??
    permissionsQuery.data?.selected ?? {
      agentMode: "auto" as const,
      kind: "agent-mode" as const,
    }
  const permissionValue = permissionSelectionValue(effectivePermissionSelection)
  const permissionLabel = permissionSelectionLabel(effectivePermissionSelection, i18n)

  useEffect(() => {
    onTerminalProjectChange(selectedProjectId ?? undefined)
  }, [onTerminalProjectChange, selectedProjectId])
  const transportOptions: CodexChatOptions = {
    cwd: selectedProject?.roots[0],
    model: selectedModel.model,
    projectId: selectedProject?.id,
    provider,
    reasoningEffort: selectedReasoning,
    resumeThreadId,
    permissionSelection:
      resumeThreadId && !permissionSelection ? undefined : effectivePermissionSelection,
    serviceTier: settings?.serviceTier ?? undefined,
  }
  const chatScopeBindings: CodexChatThreadScopeBindings = {
    initialComposerText: initialPrompt,
    onFinish: ({ message, messages: finishedMessages }) => {
      const threadId = threadIdFromMessage(message) ?? resumeThreadId
      if (!threadId) return
      queryClient.setQueryData<CodexThreadDetailView>(["codex", "thread", threadId], (detail) => {
        if (!detail) return detail
        return {
          ...detail,
          messages: finishedMessages as unknown as CodexThreadDetailView["messages"],
        }
      })
      void queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
    },
    onThreadCreated: (threadId) => {
      if (!chatScopeMounted.current || resumeThreadId) return
      setCreatedThreadId(threadId)
    },
    options: transportOptions,
  }
  const [chatScope] = useState(() => acquireCodexChatThreadScope(scrollStateKey, chatScopeBindings))
  chatScope.bindings = chatScopeBindings
  const transport = chatScope.transport
  const { error, messages, sendMessage, setMessages, status, stop } = useChat<CodexUiMessage>({
    chat: chatScope.chat,
  })
  const workspaceArtifacts = useMemo(() => deriveChatWorkspaceArtifacts(messages), [messages])
  const activeTurnProgress = useMemo(() => {
    const activeMessage = messages.findLast((message) =>
      message.parts.some(
        (part) => part.type === "data-codex-turn" && part.data.status === "inProgress"
      )
    )
    if (!activeMessage) return null
    const plan = activeMessage.parts.find((part) => part.type === "data-codex-plan")
    const completedSteps =
      plan?.type === "data-codex-plan"
        ? plan.data.plan.filter((step) => step.status === "completed").length
        : 0
    return {
      changedFiles: deriveCodexTurnView(activeMessage)?.changedFileCount ?? 0,
      completedSteps,
      totalSteps: plan?.type === "data-codex-plan" ? plan.data.plan.length : 0,
    }
  }, [messages])
  const visibleTurnIds = useMemo(
    () =>
      new Set(
        messages.flatMap((message) =>
          message.parts.flatMap((part) => (part.type === "data-codex-turn" ? [part.data.id] : []))
        )
      ),
    [messages]
  )
  const activeThreadId =
    resumeThreadId ??
    createdThreadId ??
    messages.reduce<string | null>(
      (current, message) => threadIdFromMessage(message) ?? current,
      null
    )
  const activeThreadIdRef = useRef(activeThreadId)
  activeThreadIdRef.current = activeThreadId
  const unboundInteractions = interactions.filter(
    (interaction) => !interaction.turnId || !visibleTurnIds.has(interaction.turnId)
  )
  const statusLabel =
    status === "ready"
      ? i18n._(msg({ id: "chat.status.local", message: "Local" }))
      : status === "submitted"
        ? i18n._(msg({ id: "chat.status.starting", message: "Starting…" }))
        : status === "streaming"
          ? i18n._(msg({ id: "chat.status.working", message: "Working…" }))
          : i18n._(msg({ id: "chat.status.attention", message: "Needs attention" }))
  const scrollToBottomLabel = i18n._(
    msg({ id: "chat.scrollToBottom", message: "Scroll to bottom" })
  )
  const displayedTitle =
    titleOverride ??
    threadQuery.data?.title ??
    (resumeThreadId
      ? i18n._(msg({ id: "chat.title.chat", message: "Chat" }))
      : i18n._(msg({ id: "navigation.newChat", message: "New chat" })))

  useEffect(() => {
    if (!resumeThreadId || !threadQuery.data || hydratedThreadId.current === resumeThreadId) return
    hydratedThreadId.current = resumeThreadId
    if (messages.length === 0) setMessages(threadQuery.data.messages as CodexUiMessage[])
    setSelectedProjectId(threadQuery.data.projectId)
  }, [messages.length, resumeThreadId, setMessages, threadQuery.data])

  useEffect(() => {
    chatScopeMounted.current = true
    const release = mountCodexChatThreadScope(chatScope)
    return () => {
      chatScopeMounted.current = false
      release()
    }
  }, [chatScope])
  useEffect(() => {
    if (!createdThreadId || resumeThreadId || status !== "ready") return
    const threadId = createdThreadId
    setCreatedThreadId(null)
    hydratedThreadId.current = threadId
    threadScroll.adoptStateKey(threadId)
    onThreadAdopted(threadId)
    void (async () => {
      if (initialSectionId) {
        await window.cypheria?.codex.moveThreadToSection({
          sectionId: initialSectionId,
          threadId,
        })
        void queryClient.invalidateQueries({ queryKey: ["codex", "thread-sections"] })
      }
      void queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
      void queryClient.invalidateQueries({ queryKey: ["codex", "projects"] })
      await navigate({ replace: true, search: { thread: threadId } })
    })()
  }, [
    createdThreadId,
    initialSectionId,
    navigate,
    onThreadAdopted,
    queryClient,
    resumeThreadId,
    status,
    threadScroll,
  ])
  const stopActiveTurn = useCallback(async () => {
    await stop()
    const interruptedMessages = interruptActiveCodexTurns(messages)
    setMessages(interruptedMessages)
    const threadId =
      resumeThreadId ??
      interruptedMessages.reduce<string | null>(
        (current, message) => threadIdFromMessage(message) ?? current,
        null
      )
    if (!threadId) return
    queryClient.setQueryData<CodexThreadDetailView>(["codex", "thread", threadId], (detail) =>
      detail
        ? {
            ...detail,
            messages: interruptedMessages as unknown as CodexThreadDetailView["messages"],
          }
        : detail
    )
    void queryClient.invalidateQueries({ queryKey: ["codex", "thread", threadId] })
    void queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
  }, [messages, queryClient, resumeThreadId, setMessages, stop])

  useEffect(() => {
    const api = window.cypheria?.codex
    if (!api) return
    let disposed = false
    const belongsToCurrentThread = (interaction: CodexInteractionEvent) =>
      interaction.threadId === null || interaction.threadId === activeThreadIdRef.current
    const mergeInteractions = (incoming: readonly CodexInteractionEvent[]) => {
      setInteractions((current) => {
        const next = [...current]
        for (const interaction of incoming) {
          if (!next.some((item) => item.interactionId === interaction.interactionId)) {
            next.push(interaction)
          }
        }
        return next
      })
    }
    const unsubscribe = api.onInteraction((interaction) => {
      if (belongsToCurrentThread(interaction)) mergeInteractions([interaction])
    })
    void api
      .listInteractions()
      .then((pending) => {
        if (!disposed) mergeInteractions(pending.filter(belongsToCurrentThread))
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const api = window.cypheria?.codex
    if (!api) return
    return api.onEvent((event) => {
      if (event.event !== "codex.notification" || !("method" in event.payload)) return
      if (event.payload.method === "serverRequest/resolved") {
        const params = jsonObject(event.payload.params)
        if (typeof params.requestId === "string" || typeof params.requestId === "number") {
          setInteractions((current) =>
            current.filter((interaction) => interaction.serverRequestId !== params.requestId)
          )
        }
        return
      }
      if (event.payload.method === "autoApprovalReview/strictReviewRequired") {
        const params = jsonObject(event.payload.params)
        if (typeof params.turnId === "string") {
          setStrictReviewTurns((current) => new Set(current).add(params.turnId as string))
        }
        return
      }
      if (
        event.payload.method !== "item/autoApprovalReview/started" &&
        event.payload.method !== "item/autoApprovalReview/completed"
      )
        return
      const params = jsonObject(event.payload.params)
      const review = jsonObject(params.review)
      if (
        typeof params.reviewId !== "string" ||
        typeof params.threadId !== "string" ||
        typeof params.turnId !== "string"
      )
        return
      const next: AutoReviewView = {
        event: jsonValueOrNull(params.event),
        rationale: typeof review.rationale === "string" ? review.rationale : null,
        reviewId: params.reviewId,
        riskLevel: typeof review.riskLevel === "string" ? review.riskLevel : null,
        status: typeof review.status === "string" ? review.status : "inProgress",
        threadId: params.threadId,
        turnId: params.turnId,
        userAuthorization:
          typeof review.userAuthorization === "string" ? review.userAuthorization : null,
      }
      setAutoReviews((current) => [
        ...current.filter((item) => item.reviewId !== next.reviewId),
        next,
      ])
    })
  }, [])

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1181px)")
    const update = () => setWideViewport(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  const toggleTerminalPanel = useCallback(() => {
    const nextState = toggleTerminalPanelState(
      { bottomPanelOpen, terminalLocation, workspacePanelOpen },
      defaultTerminalLocation
    )
    setBottomPanelOpen(nextState.bottomPanelOpen)
    setTerminalLocation(nextState.terminalLocation)
    setWorkspacePanelOpen(nextState.workspacePanelOpen)
    if (
      nextState.bottomPanelOpen &&
      nextState.terminalLocation === "bottom" &&
      workspaceTerminals.sessions.length === 0
    ) {
      void workspaceTerminals.openTerminal()
    }
  }, [
    bottomPanelOpen,
    defaultTerminalLocation,
    setBottomPanelOpen,
    setTerminalLocation,
    terminalLocation,
    workspaceTerminals.openTerminal,
    workspaceTerminals.sessions.length,
    workspacePanelOpen,
  ])

  const toggleBottomPanel = useCallback(() => {
    const nextState = toggleBottomPanelState({
      bottomPanelOpen,
      terminalLocation,
      workspacePanelOpen,
    })
    setBottomPanelOpen(nextState.bottomPanelOpen)
    setTerminalLocation(nextState.terminalLocation)
    setWorkspacePanelOpen(nextState.workspacePanelOpen)
    if (
      nextState.bottomPanelOpen &&
      nextState.terminalLocation === "bottom" &&
      workspaceTerminals.sessions.length === 0
    ) {
      void workspaceTerminals.openTerminal()
    }
  }, [
    bottomPanelOpen,
    setBottomPanelOpen,
    setTerminalLocation,
    terminalLocation,
    workspaceTerminals.openTerminal,
    workspaceTerminals.sessions.length,
    workspacePanelOpen,
  ])

  const bottomPanelVisible = bottomPanelOpen && terminalLocation === "bottom"

  useLayoutEffect(() => {
    const panel = bottomPanelRef.current
    if (!panel || terminalLocation !== "bottom") return
    if (bottomPanelOpen) {
      panel.resize(getBottomPanelSize())
      return
    }
    const currentSize = panel.getSize().inPixels
    if (currentSize >= 160) rememberBottomPanelSize(currentSize)
    panel.collapse()
  }, [bottomPanelOpen, getBottomPanelSize, rememberBottomPanelSize, terminalLocation])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault()
        toggleBottomPanel()
        return
      }
      if (event.ctrlKey && event.code === "Backquote") {
        event.preventDefault()
        toggleTerminalPanel()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggleBottomPanel, toggleTerminalPanel])

  const resolveInteraction = async (response: CodexInteractionResponse) => {
    await window.cypheria?.codex.respondToInteraction(response)
    setInteractions((current) =>
      current.filter((item) => item.interactionId !== response.interactionId)
    )
  }

  const forkFromTurn = async (turnId: string) => {
    if (!resumeThreadId) return
    const fork = await window.cypheria?.codex.forkThread(resumeThreadId, turnId)
    if (!fork) return
    void queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
    await navigate({ search: { thread: fork.threadId } })
  }

  const commitTitle = async () => {
    const name = titleDraft.trim()
    setEditingTitle(false)
    if (!resumeThreadId || !name || name === displayedTitle) return
    try {
      const result = await window.cypheria?.codex.renameThread(resumeThreadId, name)
      if (!result?.renamed) return
      setTitleOverride(name)
      void queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
      void queryClient.invalidateQueries({ queryKey: ["codex", "thread", resumeThreadId] })
    } catch {
      setTitleDraft(displayedTitle)
    }
  }

  const handleSubmit = ({ text, files }: { text: string; files: PromptInputFile[] }) => {
    const value = text.trim()
    if (!value && files.length === 0) return
    setAttachmentError(null)
    const followUp: CodexChatFollowUp = {
      files: files.map(({ filename, mediaType, url }) => ({
        ...(filename ? { filename } : {}),
        mediaType,
        url,
      })),
      text: value,
    }
    if (status === "submitted" || status === "streaming") {
      const mode = submitMode.current ?? "steer"
      submitMode.current = null
      void (async () => {
        try {
          if (mode === "queue") {
            if (!resumeThreadId)
              throw new Error("Wait for this new chat to finish before queueing.")
            await window.cypheria?.codex.queueThreadMessage(
              resumeThreadId,
              crypto.randomUUID(),
              followUp
            )
          } else {
            await transport.steer(followUp)
          }
        } catch (reason) {
          setAttachmentError(reason instanceof Error ? reason.message : String(reason))
        }
      })()
      return
    }
    void sendMessage({ files, text: value }).catch((reason: unknown) => {
      setAttachmentError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const answerAsyncQuestions = async (text: string) => {
    setAttachmentError(null)
    const followUp: CodexChatFollowUp = { files: [], text }
    try {
      if (status === "submitted" || status === "streaming") await transport.steer(followUp)
      else await sendMessage({ text })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setAttachmentError(message)
      throw reason
    }
  }

  return (
    <section className="h-screen min-h-0 bg-background max-[767px]:h-[calc(100vh-48px)]">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel id="workspace" minSize={240}>
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="conversation" minSize={480}>
              <main className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[var(--chrome-height,44px)_minmax(0,1fr)_auto] overflow-hidden [--thread-content-max-width:48rem] [container-type:inline-size]">
                <header className="desktop-titlebar flex min-h-[44px] items-center justify-between gap-3 border-b border-border px-4">
                  <div className="inline-flex min-w-0 max-w-[420px] flex-1 items-center gap-2 overflow-hidden text-sm font-medium">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <FolderGit2 aria-hidden="true" size={13} />
                    </span>
                    {editingTitle ? (
                      <Input
                        aria-label={i18n._(
                          msg({ id: "chat.header.rename", message: "Rename chat" })
                        )}
                        autoFocus
                        className="h-7 min-w-32 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-1"
                        maxLength={200}
                        onBlur={() => void commitTitle()}
                        onChange={(event) => setTitleDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur()
                          if (event.key === "Escape") setEditingTitle(false)
                        }}
                        value={titleDraft}
                      />
                    ) : (
                      <button
                        className="min-w-[2ch] truncate text-left"
                        disabled={!resumeThreadId}
                        onDoubleClick={() => {
                          setTitleDraft(displayedTitle)
                          setEditingTitle(true)
                        }}
                        title={
                          resumeThreadId
                            ? i18n._(
                                msg({
                                  id: "chat.header.renameHint",
                                  message: "Double-click to rename",
                                })
                              )
                            : undefined
                        }
                        type="button"
                      >
                        {displayedTitle}
                      </button>
                    )}
                    {selectedProject ? (
                      <span className="shrink truncate text-xs font-normal text-muted-foreground">
                        {selectedProject.name}
                      </span>
                    ) : null}
                    <span aria-live="polite" className="sr-only">
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      aria-label={
                        workspacePanelOpen
                          ? i18n._(
                              msg({ id: "chat.workspace.close", message: "Close workspace panel" })
                            )
                          : i18n._(
                              msg({ id: "chat.workspace.open", message: "Open workspace panel" })
                            )
                      }
                      onClick={() => setWorkspacePanelOpen((open) => !open)}
                      size="icon"
                      variant="ghost"
                    >
                      {workspacePanelOpen ? (
                        <PanelRightClose aria-hidden="true" size={16} />
                      ) : (
                        <PanelRightOpen aria-hidden="true" size={16} />
                      )}
                    </Button>
                    {showBottomPanelControl ? (
                      <Button
                        aria-pressed={bottomPanelVisible}
                        aria-label={
                          bottomPanelVisible
                            ? i18n._(
                                msg({
                                  id: "chat.workspace.hideBottomPanel",
                                  message: "Hide bottom panel",
                                })
                              )
                            : i18n._(
                                msg({
                                  id: "chat.workspace.showBottomPanel",
                                  message: "Show bottom panel",
                                })
                              )
                        }
                        onClick={toggleBottomPanel}
                        size="icon"
                        title={i18n._(
                          msg({
                            id: "chat.workspace.bottomPanelShortcut",
                            message: "Bottom panel (⌘J)",
                          })
                        )}
                        variant="ghost"
                      >
                        {bottomPanelVisible ? (
                          <PanelBottomClose aria-hidden="true" size={16} />
                        ) : (
                          <PanelBottomOpen aria-hidden="true" size={16} />
                        )}
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={i18n._(
                              msg({
                                id: "chat.header.moreActions",
                                message: "More chat actions",
                              })
                            )}
                            size="icon"
                            variant="ghost"
                          >
                            <Ellipsis aria-hidden="true" size={16} />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          disabled={!resumeThreadId}
                          onClick={() => {
                            setTitleDraft(displayedTitle)
                            setEditingTitle(true)
                          }}
                        >
                          <Pencil aria-hidden="true" />
                          <Trans id="chat.header.rename">Rename chat</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem render={<Link to="/settings/models" />}>
                          <Settings aria-hidden="true" />
                          <Trans id="settings.models">Models</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setWorkspacePanelOpen((open) => !open)}>
                          <PanelRightOpen aria-hidden="true" />
                          <Trans id="chat.workspace.toggleSidePanel">Toggle side panel</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={toggleBottomPanel}>
                          <PanelBottomOpen aria-hidden="true" />
                          <Trans id="chat.workspace.toggleBottomPanel">Toggle bottom panel</Trans>
                          <span className="ml-auto text-xs text-muted-foreground">⌘J</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={toggleTerminalPanel}>
                          <TerminalSquare aria-hidden="true" />
                          <Trans id="chat.workspace.toggleTerminal">Toggle terminal</Trans>
                          <span className="ml-auto text-xs text-muted-foreground">⌃`</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </header>

                <Conversation
                  className="min-h-0 min-w-0 overflow-x-hidden"
                  initial={false}
                  instance={threadScroll.conversationInstance}
                  resize="instant"
                >
                  <ConversationContent
                    className="mx-auto min-h-full w-full min-w-0 max-w-(--thread-content-max-width) px-4 py-8"
                    scrollClassName="cypheria-scrollbar overflow-y-auto overscroll-contain [overflow-anchor:none]"
                  >
                    {(conversation) =>
                      resumeThreadId && threadQuery.isPending ? (
                        <div
                          className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
                          role="status"
                        >
                          <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
                          <Trans id="chat.loadingConversation">Loading conversation…</Trans>
                        </div>
                      ) : threadQuery.error ? (
                        <div className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                          {threadQuery.error.message}
                        </div>
                      ) : messages.length === 0 ? (
                        <ConversationEmptyState
                          className="min-h-[60vh]"
                          description={i18n._(
                            msg({
                              id: "chat.empty.description",
                              message:
                                "Work across code, wallets, and the web while you stay in control of permissions.",
                            })
                          )}
                          icon={<Sparkles className="size-6" />}
                          title={i18n._(
                            msg({
                              id: "chat.empty.title",
                              message: "What should Cypheria work on?",
                            })
                          )}
                        />
                      ) : (
                        <VirtualizedChatMessages
                          interactions={interactions}
                          messages={messages}
                          onAnswerAsyncQuestions={answerAsyncQuestions}
                          onForkTurn={forkFromTurn}
                          onResolve={resolveInteraction}
                          scrollController={threadScroll}
                          scrollElementRef={conversation.scrollRef}
                        />
                      )
                    }
                  </ConversationContent>
                  {error ? (
                    <div className="absolute inset-x-4 bottom-4 mx-auto max-w-(--thread-content-max-width) rounded-lg border border-destructive/35 bg-background px-3 py-2 text-sm text-destructive shadow-lg">
                      {error.message}
                    </div>
                  ) : null}
                  <ConversationScrollButton
                    aria-label={scrollToBottomLabel}
                    title={scrollToBottomLabel}
                  />
                </Conversation>

                <div className="mx-auto w-full max-w-(--thread-content-max-width) px-4 pb-5">
                  {activeTurnProgress &&
                  (activeTurnProgress.totalSteps || activeTurnProgress.changedFiles) ? (
                    <div className="mb-2 flex justify-center" data-in-progress-fixed-content="true">
                      <div className="flex max-w-full items-center gap-3 rounded-3xl border border-border/80 bg-background/85 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
                        <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                        {activeTurnProgress.totalSteps ? (
                          <span>
                            {activeTurnProgress.completedSteps}/{activeTurnProgress.totalSteps}{" "}
                            <Trans id="chat.turn.planSteps">plan steps</Trans>
                          </span>
                        ) : null}
                        {activeTurnProgress.changedFiles ? (
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => setWorkspacePanelOpen(true)}
                            type="button"
                          >
                            {activeTurnProgress.changedFiles}{" "}
                            <Trans id="chat.turn.changedFiles">changed files</Trans>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {autoReviews
                    .filter(
                      (review) =>
                        review.status !== "approved" &&
                        (!resumeThreadId || review.threadId === resumeThreadId)
                    )
                    .map((review) => (
                      <AutoReviewCard key={review.reviewId} review={review} />
                    ))}
                  {strictReviewTurns.size ? (
                    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                      Strict Auto-review is active for this turn. Every subsequent command is
                      reviewed.
                    </div>
                  ) : null}
                  {unboundInteractions.map((interaction) => (
                    <CodexInteractionCard
                      interaction={interaction}
                      key={interaction.interactionId}
                      onResolve={resolveInteraction}
                    />
                  ))}
                  {attachmentError ? (
                    <div className="mb-2 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {attachmentError}
                    </div>
                  ) : null}
                  <PromptInputProvider
                    initialAttachments={chatScope.composerAttachments}
                    initialInput={chatScope.composerText}
                    onAttachmentsChange={chatScope.setComposerAttachments}
                    onInputChange={chatScope.setComposerText}
                    retainAttachmentsOnUnmount
                  >
                    <PromptInput
                      accept={composerMedia.accept}
                      className="cypheria-composer [&_[data-slot=input-group]]:bg-card"
                      globalDrop={composerMedia.canAttach}
                      id={composerFormId}
                      maxFileSize={25 * 1024 * 1024}
                      maxFiles={20}
                      multiple
                      onError={(nextError) => setAttachmentError(nextError.message)}
                      onSubmit={handleSubmit}
                    >
                      <ComposerAttachments onError={setAttachmentError} />
                      <PromptInputBody>
                        <PromptInputTextarea
                          aria-label={i18n._(
                            msg({ id: "chat.prompt.label", message: "Message Cypheria" })
                          )}
                          className="cypheria-scrollbar"
                          placeholder={i18n._(
                            msg({
                              id: "chat.prompt.placeholder",
                              message: "Ask Cypheria to inspect, edit, run, research, or review…",
                            })
                          )}
                        />
                      </PromptInputBody>
                      <PromptInputFooter className="cypheria-composer-footer">
                        <PromptInputTools className="cypheria-composer-leading-controls">
                          <PromptInputActionMenu>
                            <PromptInputActionMenuTrigger
                              aria-label={i18n._(
                                msg({
                                  id: "chat.prompt.addContext",
                                  message: "Add files or screen context",
                                })
                              )}
                              className="cypheria-composer-icon-button"
                              disabled={!composerMedia.canAttach}
                              tooltip={i18n._(
                                msg({
                                  id: "chat.prompt.addContext",
                                  message: "Add files or screen context",
                                })
                              )}
                            />
                            <PromptInputActionMenuContent className="w-56">
                              <PromptInputActionAddAttachments
                                disabled={!composerMedia.canAttach}
                                label={i18n._(
                                  msg({ id: "chat.prompt.addFiles", message: "Add files" })
                                )}
                              />
                              <PromptInputActionAddScreenshot
                                disabled={!composerMedia.image}
                                label={i18n._(
                                  msg({
                                    id: "chat.prompt.addScreenshot",
                                    message: "Take screenshot",
                                  })
                                )}
                              />
                            </PromptInputActionMenuContent>
                          </PromptInputActionMenu>
                          <ComposerSkillPicker
                            skills={(skillsQuery.data?.skills ?? []).filter(
                              (skill) => skill.enabled
                            )}
                          />
                          <PromptInputSelect
                            onValueChange={(value) => {
                              if (value === "create-project") {
                                setProjectDialogOpen(true)
                                return
                              }
                              setSelectedProjectId(value === "none" ? null : String(value))
                            }}
                            value={selectedProjectId ?? "none"}
                          >
                            <PromptInputSelectTrigger className="cypheria-composer-control max-w-44">
                              <FolderGit2 className="size-3.5" />
                              <PromptInputSelectValue>
                                {selectedProject?.name ??
                                  i18n._(msg({ id: "chat.project.none", message: "No project" }))}
                              </PromptInputSelectValue>
                            </PromptInputSelectTrigger>
                            <PromptInputSelectContent>
                              <PromptInputSelectItem value="none">
                                <Trans id="chat.project.none">No project</Trans>
                              </PromptInputSelectItem>
                              {projects.map((project) => (
                                <PromptInputSelectItem key={project.id} value={project.id}>
                                  {project.name}
                                </PromptInputSelectItem>
                              ))}
                              <PromptInputSelectItem value="create-project">
                                <Plus aria-hidden="true" />
                                <Trans id="chat.project.create">Create project</Trans>
                              </PromptInputSelectItem>
                            </PromptInputSelectContent>
                          </PromptInputSelect>
                          <PromptInputSelect
                            onValueChange={(value) =>
                              setPermissionSelection(permissionSelectionFromValue(String(value)))
                            }
                            value={permissionValue}
                          >
                            <PromptInputSelectTrigger
                              className={`cypheria-composer-control w-auto ${
                                effectivePermissionSelection.kind === "agent-mode" &&
                                effectivePermissionSelection.agentMode === "full-access"
                                  ? "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                                  : ""
                              }`}
                            >
                              <LockKeyhole className="size-3.5" />
                              <PromptInputSelectValue>{permissionLabel}</PromptInputSelectValue>
                            </PromptInputSelectTrigger>
                            <PromptInputSelectContent>
                              {permissionsQuery.data?.availableAgentModes.includes("read-only") !==
                              false ? (
                                <PromptInputSelectItem value="mode:read-only">
                                  <Trans id="chat.sandbox.readOnly">Read only</Trans>
                                </PromptInputSelectItem>
                              ) : null}
                              {permissionsQuery.data?.availableAgentModes.includes("auto") !==
                              false ? (
                                <PromptInputSelectItem value="mode:auto">
                                  <Trans id="chat.permissions.ask">Ask for approval</Trans>
                                </PromptInputSelectItem>
                              ) : null}
                              {permissionsQuery.data?.availableAgentModes.includes(
                                "guardian-approvals"
                              ) ? (
                                <PromptInputSelectItem value="mode:guardian-approvals">
                                  <Trans id="chat.permissions.autoReview">Approve for me</Trans>
                                </PromptInputSelectItem>
                              ) : null}
                              {permissionsQuery.data?.profiles
                                .filter((profile) => profile.allowed)
                                .map((profile) => (
                                  <PromptInputSelectItem
                                    key={profile.id}
                                    value={`profile:${profile.id}`}
                                  >
                                    {profile.description
                                      ? `${profile.id} — ${profile.description}`
                                      : profile.id}
                                  </PromptInputSelectItem>
                                ))}
                              {permissionsQuery.data?.showFullAccess &&
                              permissionsQuery.data.fullAccessCanBeShown ? (
                                <PromptInputSelectItem value="mode:full-access">
                                  <Trans id="chat.sandbox.fullAccess">Full access</Trans>
                                </PromptInputSelectItem>
                              ) : null}
                            </PromptInputSelectContent>
                          </PromptInputSelect>
                        </PromptInputTools>
                        <div className="cypheria-composer-trailing-controls">
                          <ModelPicker
                            models={models.length ? models : [fallbackModel]}
                            onReasoningEffortChange={setReasoningEffort}
                            onSelect={(model) => {
                              setSelectedModelId(model.model)
                              setReasoningEffort(model.defaultReasoningEffort)
                            }}
                            reasoningEffort={selectedReasoning}
                            selected={selectedModel}
                          />
                          <ComposerSpeechInput />
                          {status === "submitted" || status === "streaming" ? (
                            <>
                              <Button
                                aria-label={i18n._(
                                  msg({ id: "chat.prompt.steer", message: "Steer active turn" })
                                )}
                                size="icon-sm"
                                title={i18n._(
                                  msg({ id: "chat.prompt.steer", message: "Steer active turn" })
                                )}
                                type="submit"
                                variant="ghost"
                              >
                                <CornerDownLeft aria-hidden="true" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      aria-label={i18n._(
                                        msg({
                                          id: "chat.prompt.followUpOptions",
                                          message: "Follow-up options",
                                        })
                                      )}
                                      size="icon-sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      <ChevronDown aria-hidden="true" />
                                    </Button>
                                  }
                                />
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuItem
                                    disabled={!resumeThreadId}
                                    onClick={() => {
                                      submitMode.current = "queue"
                                      const form = document.getElementById(composerFormId)
                                      if (form instanceof HTMLFormElement) form.requestSubmit()
                                    }}
                                  >
                                    <Trans id="chat.prompt.queue">Queue for next turn</Trans>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          ) : null}
                          <ComposerSubmitButton
                            onStop={() => void stopActiveTurn()}
                            status={status}
                          />
                        </div>
                      </PromptInputFooter>
                    </PromptInput>
                  </PromptInputProvider>
                  {status !== "ready" ? (
                    <div aria-live="polite" className="sr-only" role="status">
                      {statusLabel}
                    </div>
                  ) : null}
                </div>
                <ProjectCreateDialog
                  onCreated={(projectId) => {
                    setSelectedProjectId(projectId)
                    setProjectDialogOpen(false)
                  }}
                  onOpenChange={setProjectDialogOpen}
                  open={projectDialogOpen}
                />
              </main>
            </ResizablePanel>
            {workspacePanelOpen && wideViewport ? (
              <>
                <ResizableHandle className="z-10 hover:bg-ring/45" />
                <ResizablePanel
                  defaultSize={420}
                  groupResizeBehavior="preserve-pixel-size"
                  id="side-panel"
                  maxSize="50%"
                  minSize={320}
                >
                  <WorkspacePanel
                    activeWallet={activeWalletQuery.data}
                    artifacts={workspaceArtifacts}
                    key={terminalLocation}
                    onClose={() => setWorkspacePanelOpen(false)}
                    onMoveTerminalToBottom={() => {
                      setTerminalLocation("bottom")
                      setBottomPanelOpen(true)
                    }}
                    projectRoot={selectedProject?.roots[0]}
                    terminalController={workspaceTerminals}
                    terminalInSidePanel={terminalLocation === "right"}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </ResizablePanel>
        {terminalLocation === "bottom" ? (
          <>
            <ResizableHandle
              aria-hidden={!bottomPanelVisible}
              className={bottomPanelVisible ? "z-20 hover:bg-ring/45" : "hidden"}
            />
            <ResizablePanel
              collapsible
              collapsedSize={0}
              defaultSize={bottomPanelVisible ? getBottomPanelSize() : 0}
              groupResizeBehavior="preserve-pixel-size"
              id="bottom-panel"
              maxSize="50%"
              minSize={160}
              onResize={({ inPixels }) => {
                if (inPixels >= 160) rememberBottomPanelSize(inPixels)
              }}
              panelRef={bottomPanelRef}
            >
              <WorkspaceTerminalView
                active={bottomPanelVisible}
                controller={workspaceTerminals}
                onHide={() => setBottomPanelOpen(false)}
                onMove={() => {
                  setTerminalLocation("right")
                  setBottomPanelOpen(false)
                  setWorkspacePanelOpen(true)
                }}
                openWhenEmpty={false}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </section>
  )
}

function AutoReviewCard({ review }: Readonly<{ review: AutoReviewView }>) {
  const [retrying, setRetrying] = useState(false)
  const [retried, setRetried] = useState(false)
  const retryEvent = review.event
  const statusLabel =
    review.status === "inProgress"
      ? "Reviewing"
      : review.status === "timedOut"
        ? "Timed out"
        : review.status.charAt(0).toUpperCase() + review.status.slice(1)
  return (
    <section className="mb-3 rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {review.status === "inProgress" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <LockKeyhole className="size-3.5" />
          )}
          Auto-review
        </div>
        <Badge variant="outline">{statusLabel}</Badge>
      </div>
      {review.rationale ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{review.rationale}</p>
      ) : null}
      {review.riskLevel || review.userAuthorization ? (
        <div className="mt-2 flex gap-2 text-[11px] text-muted-foreground">
          {review.riskLevel ? <span>Risk: {review.riskLevel}</span> : null}
          {review.userAuthorization ? <span>Authorization: {review.userAuthorization}</span> : null}
        </div>
      ) : null}
      {review.status === "denied" && retryEvent ? (
        <div className="mt-3 flex justify-end">
          <Button
            disabled={retrying || retried}
            onClick={async () => {
              setRetrying(true)
              try {
                await window.cypheria?.codex.retryAutoReviewDenial(review.threadId, retryEvent)
                setRetried(true)
              } finally {
                setRetrying(false)
              }
            }}
            size="sm"
            variant="outline"
          >
            {retried ? "Approval recorded" : retrying ? "Recording…" : "Approve one retry"}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function CodexInteractionCard({
  interaction,
  onResolve,
}: Readonly<{
  interaction: CodexInteractionEvent
  onResolve: (response: CodexInteractionResponse) => Promise<void>
}>) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [content, setContent] = useState("{}")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [grantFileSystem, setGrantFileSystem] = useState(true)
  const [grantNetwork, setGrantNetwork] = useState(true)
  const params = jsonObject(interaction.params)
  const requestedPermissions = jsonObject(params.permissions)
  const availableDecisions = Array.isArray(params.availableDecisions)
    ? params.availableDecisions
    : null

  const submit = async (action: CodexInteractionResponse["action"]) => {
    setSubmitting(true)
    setError(null)
    try {
      let parsedContent: CodexInteractionResponse["content"]
      if (interaction.kind === "elicitation" && action === "accept") {
        parsedContent = JSON.parse(content)
      }
      await onResolve({
        action,
        ...(interaction.kind === "user-input"
          ? {
              answers: Object.fromEntries(
                Object.entries(answers).map(([id, answer]) => [id, [answer]])
              ),
            }
          : {}),
        ...(interaction.kind === "elicitation" && action === "accept"
          ? { content: parsedContent }
          : {}),
        interactionId: interaction.interactionId,
        ...(interaction.method === "item/permissions/requestApproval" && action.startsWith("accept")
          ? {
              permissions: {
                ...(grantFileSystem && requestedPermissions.fileSystem
                  ? { fileSystem: requestedPermissions.fileSystem }
                  : {}),
                ...(grantNetwork && requestedPermissions.network
                  ? { network: requestedPermissions.network }
                  : {}),
              } as CodexInteractionResponse["permissions"],
              scope: action === "accept-for-session" ? ("session" as const) : ("turn" as const),
            }
          : {}),
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSubmitting(false)
    }
  }

  return (
    <section className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{interaction.title}</div>
          {interaction.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{interaction.description}</p>
          ) : null}
        </div>
        <Badge variant="outline">Action required</Badge>
      </div>

      {interaction.kind === "approval" ? (
        <ApprovalDetails
          interaction={interaction}
          params={params}
          requestedPermissions={requestedPermissions}
          grantFileSystem={grantFileSystem}
          grantNetwork={grantNetwork}
          onGrantFileSystem={setGrantFileSystem}
          onGrantNetwork={setGrantNetwork}
        />
      ) : null}

      {interaction.questions?.map((question) => {
        const inputId = `${interaction.interactionId}-${question.id}`
        return (
          <div className="mt-3 grid gap-1 text-xs" key={question.id}>
            <label className="font-medium" htmlFor={inputId}>
              {question.header || question.question}
            </label>
            {question.header ? (
              <span className="text-muted-foreground">{question.question}</span>
            ) : null}
            {question.options ? (
              <select
                className="h-9 rounded-md border bg-background px-2"
                id={inputId}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
                value={answers[question.id] ?? ""}
              >
                <option value="">Select…</option>
                {question.options.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label} — {option.description}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="h-9 rounded-md border bg-background px-2"
                id={inputId}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
                type={question.isSecret ? "password" : "text"}
                value={answers[question.id] ?? ""}
              />
            )}
          </div>
        )
      })}

      {interaction.kind === "elicitation" ? (
        <textarea
          className="mt-3 min-h-24 w-full rounded-md border bg-background p-2 font-mono text-xs"
          onChange={(event) => setContent(event.target.value)}
          value={content}
        />
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        {decisionAvailable(availableDecisions, "decline") ? (
          <Button
            disabled={submitting}
            onClick={() => void submit("decline")}
            size="sm"
            variant="ghost"
          >
            Decline
          </Button>
        ) : null}
        {interaction.kind === "approval" &&
        decisionAvailable(availableDecisions, "acceptForSession") ? (
          <Button
            disabled={submitting}
            onClick={() => void submit("accept-for-session")}
            size="sm"
            variant="outline"
          >
            Allow for session
          </Button>
        ) : null}
        {interaction.kind === "approval" &&
          availableDecisions?.map((decision) => {
            if (typeof decision === "string") return null
            const amendment = jsonObject(decision)
            if (
              !("acceptWithExecpolicyAmendment" in amendment) &&
              !("applyNetworkPolicyAmendment" in amendment)
            )
              return null
            return (
              <Button
                disabled={submitting}
                key={JSON.stringify(decision)}
                onClick={() =>
                  void onResolve({
                    action: "accept",
                    decision: decision as CodexInteractionResponse["decision"],
                    interactionId: interaction.interactionId,
                  })
                }
                size="sm"
                variant="outline"
              >
                Allow and remember
              </Button>
            )
          })}
        {decisionAvailable(availableDecisions, "accept") ? (
          <Button disabled={submitting} onClick={() => void submit("accept")} size="sm">
            {interaction.kind === "user-input" ? "Submit" : "Allow"}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

const jsonObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const isJsonValue = (value: unknown): value is NonNullable<CodexInteractionResponse["content"]> => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => isJsonValue(entry))
  )
}

const jsonValueOrNull = (value: unknown): CodexInteractionResponse["content"] | null =>
  isJsonValue(value) ? value : null

const decisionAvailable = (decisions: unknown[] | null, expected: string): boolean =>
  !decisions || decisions.some((decision) => decision === expected)

function ApprovalDetails({
  grantFileSystem,
  grantNetwork,
  interaction,
  onGrantFileSystem,
  onGrantNetwork,
  params,
  requestedPermissions,
}: Readonly<{
  grantFileSystem: boolean
  grantNetwork: boolean
  interaction: CodexInteractionEvent
  onGrantFileSystem: (value: boolean) => void
  onGrantNetwork: (value: boolean) => void
  params: Record<string, unknown>
  requestedPermissions: Record<string, unknown>
}>) {
  if (interaction.method === "item/permissions/requestApproval") {
    return (
      <div className="mt-3 grid gap-2 rounded-lg bg-muted/60 p-3 text-xs">
        {requestedPermissions.fileSystem ? (
          <label
            className="flex items-start gap-2"
            htmlFor={`${interaction.interactionId}-filesystem`}
          >
            <Checkbox
              checked={grantFileSystem}
              id={`${interaction.interactionId}-filesystem`}
              onCheckedChange={(value) => onGrantFileSystem(value === true)}
            />
            <span>
              <strong>File access</strong>
              <span className="mt-0.5 block break-all text-muted-foreground">
                {JSON.stringify(requestedPermissions.fileSystem)}
              </span>
            </span>
          </label>
        ) : null}
        {requestedPermissions.network ? (
          <label
            className="flex items-start gap-2"
            htmlFor={`${interaction.interactionId}-network`}
          >
            <Checkbox
              checked={grantNetwork}
              id={`${interaction.interactionId}-network`}
              onCheckedChange={(value) => onGrantNetwork(value === true)}
            />
            <span>
              <strong>Network access</strong>
              <span className="mt-0.5 block break-all text-muted-foreground">
                {JSON.stringify(requestedPermissions.network)}
              </span>
            </span>
          </label>
        ) : null}
        {typeof params.cwd === "string" ? (
          <span className="text-muted-foreground">Working directory: {params.cwd}</span>
        ) : null}
      </div>
    )
  }
  return (
    <div className="mt-3 grid gap-1 rounded-lg bg-muted/60 p-3 text-xs">
      {typeof params.command === "string" ? (
        <code className="break-all font-mono text-[12px]">{params.command}</code>
      ) : null}
      {typeof params.cwd === "string" ? (
        <span className="text-muted-foreground">Working directory: {params.cwd}</span>
      ) : null}
      {typeof params.grantRoot === "string" ? (
        <span className="text-muted-foreground">Requested write root: {params.grantRoot}</span>
      ) : null}
      {params.networkApprovalContext ? (
        <span className="font-medium text-amber-700 dark:text-amber-300">
          This command is requesting network access.
        </span>
      ) : null}
    </div>
  )
}

function VirtualizedChatMessages({
  interactions,
  messages,
  onAnswerAsyncQuestions,
  onForkTurn,
  onResolve,
  scrollController,
  scrollElementRef,
}: Readonly<{
  interactions: CodexInteractionEvent[]
  messages: CodexUiMessage[]
  onAnswerAsyncQuestions: (text: string) => Promise<void>
  onForkTurn: (turnId: string) => Promise<void>
  onResolve: (response: CodexInteractionResponse) => Promise<void>
  scrollController: ThreadScrollController
  scrollElementRef: Readonly<{ current: HTMLElement | null }>
}>) {
  const restoreStateRef = useRef(scrollController.initialRestoreState)
  const virtualizerRootRef = useRef<HTMLDivElement | null>(null)
  const didRestoreRef = useRef(false)
  const getItemKey = useCallback(
    (index: number) => messages[index]?.id ?? `missing-message-${index}`,
    [messages]
  )
  const estimateSize = useCallback(
    (index: number) => (messages[index]?.role === "user" ? 112 : 320),
    [messages]
  )
  const initialMeasurements = useMemo(() => {
    const restoreState = restoreStateRef.current
    if (!restoreState) return []
    const indexByKey = new Map(messages.map((message, index) => [message.id, index]))
    return restoreState.measurements.flatMap((measurement) => {
      const key = String(measurement.key)
      const index = indexByKey.get(key)
      return index == null ? [] : [{ ...measurement, index, key }]
    })
  }, [messages])
  const estimatedInitialOffset = useMemo(() => {
    const restoreState = restoreStateRef.current
    if (restoreState) return restoreState.scrollOffsetPx
    const viewportHeight = 800
    return Math.max(
      0,
      messages.reduce((total, _message, index) => total + estimateSize(index), 0) - viewportHeight
    )
  }, [estimateSize, messages])
  const virtualizer = useVirtualizer({
    anchorTo: "end",
    count: messages.length,
    estimateSize,
    followOnAppend: "auto",
    getItemKey,
    getScrollElement: () => scrollElementRef.current,
    initialMeasurementsCache: initialMeasurements,
    initialOffset: estimatedInitialOffset,
    initialRect: {
      height: restoreStateRef.current?.viewportHeightPx ?? 800,
      width: 0,
    },
    overscan: 4,
    scrollEndThreshold: 24,
    useAnimationFrameWithResizeObserver: true,
  })

  const { completeInitialRestore, registerVirtualizer, saveState } = scrollController

  useLayoutEffect(() => {
    registerVirtualizer(virtualizer)
    return () => {
      saveState()
      registerVirtualizer(null)
    }
  }, [registerVirtualizer, saveState, virtualizer])

  useLayoutEffect(() => {
    if (didRestoreRef.current) return
    const element = scrollElementRef.current
    if (!element) return
    let animationFrame = 0
    let settleFrameCount = 0
    let cancelled = false

    const restorePosition = () => {
      if (cancelled) return
      const restoreState = restoreStateRef.current
      const maxOffset = Math.max(0, element.scrollHeight - element.clientHeight)
      let targetOffset = maxOffset

      if (restoreState) {
        targetOffset = getBottomDistanceRestoreOffset({
          clientHeight: element.clientHeight,
          distanceFromBottomPx: restoreState.distanceFromBottomPx,
          scrollHeight: element.scrollHeight,
        })
        if (!restoreState.wasAtBottom && restoreState.anchor && virtualizerRootRef.current) {
          const anchorIndex = messages.findIndex(
            (message) => message.id === restoreState.anchor?.key
          )
          const anchorMeasurement =
            anchorIndex < 0 ? null : virtualizer.measurementsCache[anchorIndex]
          if (anchorMeasurement) {
            const viewportBounds = element.getBoundingClientRect()
            const virtualizerBounds = virtualizerRootRef.current.getBoundingClientRect()
            const virtualizerTopInScrollContent =
              virtualizerBounds.top - viewportBounds.top + element.scrollTop
            targetOffset =
              virtualizerTopInScrollContent +
              anchorMeasurement.start -
              restoreState.anchor.offsetFromViewportTopPx
          }
        }
      }

      element.scrollTo({
        behavior: "auto",
        top: Math.min(maxOffset, Math.max(0, targetOffset)),
      })
    }

    const settleRestore = () => {
      restorePosition()
      settleFrameCount += 1
      if (settleFrameCount < 2) {
        animationFrame = window.requestAnimationFrame(settleRestore)
        return
      }
      didRestoreRef.current = true
      completeInitialRestore()
    }

    restorePosition()
    animationFrame = window.requestAnimationFrame(settleRestore)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(animationFrame)
    }
  }, [completeInitialRestore, messages, scrollElementRef, virtualizer])

  return (
    <div
      className="relative w-full"
      data-chat-virtualizer="true"
      ref={virtualizerRootRef}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const message = messages[virtualRow.index]
        if (!message) return null
        return (
          <div
            className="absolute top-0 left-0 w-full pb-6"
            data-index={virtualRow.index}
            data-thread-message-key={message.id}
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <ChatMessage
              interactions={interactions}
              message={message}
              onAnswerAsyncQuestions={onAnswerAsyncQuestions}
              onForkTurn={onForkTurn}
              onResolve={onResolve}
            />
          </div>
        )
      })}
    </div>
  )
}

function ChatMessage({
  interactions,
  message,
  onAnswerAsyncQuestions,
  onForkTurn,
  onResolve,
}: Readonly<{
  interactions: readonly CodexInteractionEvent[]
  message: CodexUiMessage
  onAnswerAsyncQuestions: (text: string) => Promise<void>
  onForkTurn: (turnId: string) => Promise<void>
  onResolve: (response: CodexInteractionResponse) => Promise<void>
}>) {
  const { i18n } = useLingui()
  const turn = message.parts.find((part) => part.type === "data-codex-turn")
  if (message.role === "assistant" && turn?.type === "data-codex-turn") {
    const turnInteractions = interactions.filter(
      (interaction) => interaction.turnId === turn.data.id
    )
    return (
      <CodexTurnMessage
        blockingContent={
          turnInteractions.length
            ? turnInteractions.map((interaction) => (
                <CodexInteractionCard
                  interaction={interaction}
                  key={interaction.interactionId}
                  onResolve={onResolve}
                />
              ))
            : undefined
        }
        message={message}
        onAnswerAsyncQuestions={onAnswerAsyncQuestions}
        onFork={onForkTurn}
      />
    )
  }
  const sources = message.parts.filter(
    (part): part is SourceUrlUIPart => part.type === "source-url"
  )
  const firstSourceIndex = message.parts.findIndex((part) => part.type === "source-url")

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => {
          if (part.type === "text")
            return (
              <MessageResponse
                key={`${message.id}-text-${part.text}`}
                urlTransform={codexMarkdownUrlTransform}
              >
                {part.text}
              </MessageResponse>
            )
          if (part.type === "reasoning")
            return (
              <Reasoning key={`${message.id}-reasoning-${part.text}`}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            )
          if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
            const toolPart = part as DynamicToolUIPart
            return (
              <Tool
                defaultOpen={toolPart.state === "output-error"}
                key={`${message.id}-tool-${toolPart.toolCallId}`}
              >
                <ToolHeader
                  state={toolPart.state}
                  toolName={toolPart.toolName}
                  type="dynamic-tool"
                />
                <ToolContent>
                  {"input" in toolPart ? <ToolInput input={toolPart.input} /> : null}
                  {toolPart.state === "output-available" ? (
                    <ToolOutput errorText={undefined} output={toolPart.output} />
                  ) : toolPart.state === "output-error" ? (
                    <ToolOutput errorText={toolPart.errorText} output={undefined} />
                  ) : null}
                </ToolContent>
              </Tool>
            )
          }
          if (part.type === "file" || part.type === "reasoning-file") {
            const fileId = codexFilePartId(message.id, part)
            return <CodexFilePart fileId={fileId} key={fileId} part={part} />
          }
          if (part.type === "source-url") {
            if (index !== firstSourceIndex) return null
            return (
              <Sources key={`${message.id}-sources`}>
                <SourcesTrigger count={sources.length} />
                <SourcesContent>
                  {sources.map((source) => (
                    <Source
                      href={source.url}
                      key={source.sourceId}
                      title={source.title ?? source.url}
                    />
                  ))}
                </SourcesContent>
              </Sources>
            )
          }
          if (part.type === "source-document") {
            return (
              <Attachments key={`${message.id}-source-${part.sourceId}`} variant="list">
                <Attachment data={{ ...part, id: part.sourceId }}>
                  <AttachmentPreview />
                  <AttachmentInfo showMediaType />
                </Attachment>
              </Attachments>
            )
          }
          if (part.type === "custom") {
            const item = part.providerMetadata?.["cypheria.codex"]?.item
            const itemId =
              typeof item === "object" && item !== null && "id" in item
                ? String(item.id)
                : part.kind
            return <CodexCustomPart key={`${message.id}-custom-${itemId}`} part={part} />
          }
          return null
        })}
      </MessageContent>
      {message.parts.some((part) => part.type === "text") ? (
        <MessageActions
          className={
            message.role === "user"
              ? "justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
              : "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          }
        >
          <MessageAction
            onClick={() =>
              void navigator.clipboard.writeText(
                message.parts
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n\n")
              )
            }
            tooltip={i18n._(msg({ id: "chat.turn.copyMessage", message: "Copy message" }))}
          >
            <Copy className="size-3.5" />
          </MessageAction>
        </MessageActions>
      ) : null}
    </Message>
  )
}

function CodexFilePart({
  fileId,
  part,
}: Readonly<{
  fileId: string
  part: FileUIPart | ReasoningFileUIPart
}>) {
  const file: FileUIPart & { id: string } = {
    ...part,
    id: fileId,
    type: "file",
  }
  return (
    <Attachments variant={file.mediaType.startsWith("image/") ? "grid" : "list"}>
      <Attachment data={file}>
        <AttachmentPreview />
        <AttachmentInfo showMediaType />
      </Attachment>
    </Attachments>
  )
}

function codexFilePartId(messageId: string, part: FileUIPart | ReasoningFileUIPart): string {
  const itemId = part.providerMetadata?.["cypheria.codex"]?.itemId
  return `${messageId}-file-${typeof itemId === "string" ? itemId : part.url}`
}

function CodexCustomPart({ part }: Readonly<{ part: CustomContentUIPart }>) {
  const item = part.providerMetadata?.["cypheria.codex"]?.item
  return (
    <Task defaultOpen={false}>
      <TaskTrigger title={part.kind.replace("cypheria.codex-", "Codex: ")} />
      <TaskContent>
        <TaskItem className="whitespace-pre-wrap break-all font-mono text-xs">
          {item === undefined ? part.kind : JSON.stringify(item, null, 2)}
        </TaskItem>
      </TaskContent>
    </Task>
  )
}

function ComposerAttachments({ onError }: Readonly<{ onError: (message: string) => void }>) {
  const { i18n } = useLingui()
  const attachments = usePromptInputAttachments()
  const { textInput } = usePromptInputController()
  if (!attachments.files.length) return null

  const restorePastedText = async (file: (typeof attachments.files)[number]) => {
    if (!isPromptInputPastedText(file) || file.pastedText.characterCount > 25_000) return
    try {
      const response = await fetch(file.url)
      if (!response.ok) throw new Error("Pasted text is no longer available.")
      const text = await response.text()
      if (text.length > 25_000) throw new Error("Pasted text is too large to restore.")
      textInput.insertAtSelection(text)
      attachments.remove(file.id)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <PromptInputHeader className="cypheria-composer-attachments">
      <Attachments className="ml-0 max-w-full" variant="inline">
        {attachments.files.map((file) => {
          const pastedText = isPromptInputPastedText(file) ? file.pastedText : null
          const canRestore = pastedText !== null && pastedText.characterCount <= 25_000
          return (
            <Attachment
              className={
                pastedText ? "h-14 min-w-52 max-w-72 gap-2 px-2 py-1.5 font-normal" : undefined
              }
              data={file}
              key={file.id}
              onRemove={() => attachments.remove(file.id)}
            >
              <AttachmentPreview
                className={pastedText ? "size-9 rounded-md bg-muted" : undefined}
              />
              {pastedText ? (
                <div className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-medium">
                    {pastedText.preview ||
                      i18n._(msg({ id: "chat.prompt.pastedText", message: "Pasted text" }))}
                  </span>
                  {canRestore ? (
                    <button
                      className="mt-1 inline-flex items-center gap-1 text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation()
                        void restorePastedText(file)
                      }}
                      type="button"
                    >
                      <Trans>Show in text field</Trans>
                      <CornerDownLeft aria-hidden="true" className="size-3" />
                    </button>
                  ) : (
                    <span className="mt-1 block text-muted-foreground text-xs">
                      <Trans>Pasted text</Trans>
                    </span>
                  )}
                </div>
              ) : (
                <AttachmentInfo />
              )}
              <AttachmentRemove
                label={i18n._(
                  pastedText
                    ? msg({
                        id: "chat.prompt.removePastedText",
                        message: "Remove pasted text attachment",
                      })
                    : msg({ id: "chat.prompt.removeAttachment", message: "Remove attachment" })
                )}
              />
            </Attachment>
          )
        })}
      </Attachments>
    </PromptInputHeader>
  )
}

function ComposerSpeechInput() {
  const { i18n } = useLingui()
  const { textInput } = usePromptInputController()
  return (
    <SpeechInput
      aria-label={i18n._(msg({ id: "chat.prompt.dictation", message: "Dictation" }))}
      lang={typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US"}
      onTranscriptionChange={(transcript) => {
        const prefix = textInput.value && !textInput.value.endsWith(" ") ? " " : ""
        textInput.setInput(`${textInput.value}${prefix}${transcript}`)
      }}
      className="cypheria-composer-speech-button"
      size="icon-sm"
      title={i18n._(msg({ id: "chat.prompt.dictation", message: "Dictation" }))}
      type="button"
    />
  )
}

function ComposerSkillPicker({ skills }: Readonly<{ skills: CodexSkillView[] }>) {
  const { i18n } = useLingui()
  const { textInput } = usePromptInputController()
  const insertSkill = (skill: CodexSkillView) => {
    const prefix = textInput.value && !textInput.value.endsWith(" ") ? " " : ""
    textInput.setInput(`${textInput.value}${prefix}$${skill.name} `)
  }
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        aria-label={i18n._(msg({ id: "chat.prompt.skills", message: "Skills" }))}
        className="cypheria-composer-icon-button"
        disabled={!skills.length}
        tooltip={i18n._(msg({ id: "chat.prompt.skills", message: "Skills" }))}
      >
        <Sparkles className="size-3.5" />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className="max-h-80 w-72 overflow-y-auto">
        {skills.length ? (
          skills.map((skill) => (
            <PromptInputActionMenuItem key={skill.path} onSelect={() => insertSkill(skill)}>
              <Sparkles className="size-3.5" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{skill.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {skill.description}
                </span>
              </span>
            </PromptInputActionMenuItem>
          ))
        ) : (
          <PromptInputActionMenuItem disabled>
            <Trans id="chat.prompt.noSkills">No enabled skills</Trans>
          </PromptInputActionMenuItem>
        )}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  )
}

function ModelPicker({
  models,
  onReasoningEffortChange,
  onSelect,
  reasoningEffort,
  selected,
}: Readonly<{
  models: CodexModelView[]
  onReasoningEffortChange: (effort: string) => void
  onSelect: (model: CodexModelView) => void
  reasoningEffort: string
  selected: CodexModelView
}>) {
  const { i18n } = useLingui()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`${selected.displayName}, ${reasoningEffortLabel(reasoningEffort, i18n)}`}
            className="cypheria-composer-model-button"
            size="sm"
            variant="ghost"
          >
            <Zap aria-hidden="true" className="size-3.5 fill-current" />
            <span className="min-w-0 truncate">{selected.displayName}</span>
            <span className="shrink-0 text-muted-foreground">
              {reasoningEffortLabel(reasoningEffort, i18n)}
            </span>
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="cypheria-scrollbar max-h-[min(28rem,var(--available-height))] w-72"
        side="top"
        sideOffset={8}
      >
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            const model = models.find((candidate) => candidate.model === String(value))
            if (model) onSelect(model)
          }}
          value={selected.model}
        >
          <DropdownMenuLabel>
            <Trans id="chat.model.available">Available models</Trans>
          </DropdownMenuLabel>
          {models.map((model) => (
            <DropdownMenuRadioItem
              className="items-start py-2"
              closeOnClick={false}
              key={model.id}
              value={model.model}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{model.displayName}</span>
                <span className="block line-clamp-2 text-xs text-muted-foreground">
                  {model.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(value) => onReasoningEffortChange(String(value))}
          value={reasoningEffort}
        >
          <DropdownMenuLabel>
            <Trans id="chat.model.reasoning">Reasoning</Trans>
          </DropdownMenuLabel>
          {selected.reasoningEfforts.map((effort) => (
            <DropdownMenuRadioItem closeOnClick={false} key={effort.value} value={effort.value}>
              <span className="min-w-0">
                <span className="block font-medium">
                  {reasoningEffortLabel(effort.value, i18n)}
                </span>
                <span className="block line-clamp-2 text-xs text-muted-foreground">
                  {effort.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function reasoningEffortLabel(value: string, i18n: I18n): string {
  switch (value) {
    case "none":
      return i18n._(msg({ id: "chat.reasoning.none", message: "None" }))
    case "minimal":
      return i18n._(msg({ id: "chat.reasoning.minimal", message: "Minimal" }))
    case "low":
      return i18n._(msg({ id: "chat.reasoning.low", message: "Low" }))
    case "medium":
      return i18n._(msg({ id: "chat.reasoning.medium", message: "Medium" }))
    case "high":
      return i18n._(msg({ id: "chat.reasoning.high", message: "High" }))
    case "xhigh":
      return i18n._(msg({ id: "chat.reasoning.xhigh", message: "Extra high" }))
    case "max":
      return i18n._(msg({ id: "chat.reasoning.max", message: "Max" }))
    default:
      return value
  }
}

function ComposerSubmitButton({
  onStop,
  status,
}: Readonly<{
  onStop: () => void
  status: "error" | "ready" | "streaming" | "submitted"
}>) {
  const { i18n } = useLingui()
  const attachments = usePromptInputAttachments()
  const { textInput } = usePromptInputController()
  const isGenerating = status === "submitted" || status === "streaming"
  const disabled = !isGenerating && !textInput.value.trim() && attachments.files.length === 0
  const label = isGenerating
    ? i18n._(msg({ id: "chat.prompt.stop", message: "Stop" }))
    : i18n._(msg({ id: "chat.prompt.submit", message: "Submit" }))
  return (
    <PromptInputSubmit
      aria-label={label}
      className={`cypheria-composer-submit-button disabled:bg-muted disabled:text-muted-foreground ${
        isGenerating
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-foreground text-background hover:bg-foreground/85"
      }`}
      disabled={disabled}
      onStop={onStop}
      status={status}
      title={label}
    >
      {status === "submitted" ? (
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      ) : status === "streaming" ? (
        <Square aria-hidden="true" className="size-3 fill-current" />
      ) : (
        <ArrowUp aria-hidden="true" className="size-4" />
      )}
    </PromptInputSubmit>
  )
}

function WorkspacePanel({
  activeWallet,
  artifacts,
  onClose,
  onMoveTerminalToBottom,
  projectRoot,
  terminalController,
  terminalInSidePanel,
}: Readonly<{
  activeWallet?: WalletActiveContext
  artifacts: ChatWorkspaceArtifacts
  onClose: () => void
  onMoveTerminalToBottom: () => void
  projectRoot?: string
  terminalController: WorkspaceTerminalsController
  terminalInSidePanel: boolean
}>) {
  const { i18n } = useLingui()
  const statusLabel = (status: string) => {
    if (status === "completed") return i18n._(msg({ id: "chat.artifact.done", message: "Done" }))
    if (status === "failed") return i18n._(msg({ id: "chat.artifact.failed", message: "Failed" }))
    if (status === "declined")
      return i18n._(msg({ id: "chat.artifact.declined", message: "Declined" }))
    return i18n._(msg({ id: "chat.artifact.running", message: "Running" }))
  }
  const kindLabel = (kind: ChatWorkspaceArtifacts["files"][number]["kind"]) => {
    if (kind === "add") return i18n._(msg({ id: "chat.artifact.added", message: "Added" }))
    if (kind === "delete") return i18n._(msg({ id: "chat.artifact.deleted", message: "Deleted" }))
    return i18n._(msg({ id: "chat.artifact.updated", message: "Updated" }))
  }
  return (
    <aside
      aria-label={i18n._(msg({ id: "chat.workspace.label", message: "Workspace panel" }))}
      className="min-h-0 min-w-0 overflow-hidden border-l border-border bg-background shadow-[-8px_0_20px_-18px_rgb(0_0_0/0.45)]"
    >
      <Tabs
        className="grid h-full grid-rows-[var(--chrome-height,44px)_minmax(0,1fr)]"
        defaultValue={terminalInSidePanel ? "terminal" : "context"}
      >
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-2">
          <TabsList className="min-w-0 bg-transparent">
            <TabsTrigger value="context">
              <Trans id="chat.workspace.context">Context</Trans>
            </TabsTrigger>
            <TabsTrigger value="files">
              <Trans id="chat.workspace.files">Files</Trans>
            </TabsTrigger>
            <TabsTrigger value="review">
              <Trans id="chat.workspace.review">Review</Trans>
            </TabsTrigger>
            {terminalInSidePanel ? (
              <TabsTrigger value="terminal">
                <Trans id="chat.workspace.terminal">Terminal</Trans>
              </TabsTrigger>
            ) : null}
          </TabsList>
          <Button
            aria-label={i18n._(
              msg({ id: "chat.workspace.close", message: "Close workspace panel" })
            )}
            className="shrink-0"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <PanelRightClose aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
        <TabsContent className="m-0 overflow-auto p-4" value="context">
          <div className="grid gap-4">
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium">
                <WalletCards size={16} />
                <Trans id="chat.workspace.web3Context">Web3 context</Trans>
              </div>
              {activeWallet?.wallet && activeWallet.chainAccount ? (
                <div className="mt-2 grid gap-1 text-sm">
                  <span>
                    {activeWallet.wallet.wallet.name} · {activeWallet.mode}
                  </span>
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {activeWallet.chainAccount.address}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {activeWallet.chainAccount.chain.namespace}:
                    {activeWallet.chainAccount.chain.reference}
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  <Trans id="chat.workspace.noWallet">
                    No wallet selected. On-chain actions remain read only.
                  </Trans>
                </p>
              )}
            </section>
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium">
                <Globe2 size={16} /> <Trans id="chat.workspace.browser">Browser</Trans>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                <Trans id="chat.workspace.browserDescription">
                  Open an isolated dApp session from a chat result or browser action.
                </Trans>
              </p>
            </section>
          </div>
        </TabsContent>
        <TabsContent className="m-0 overflow-auto p-4" value="files">
          {artifacts.files.length ? (
            <div className="grid gap-2">
              <p className="text-xs text-muted-foreground">
                <Trans id="chat.workspace.filesSummary">
                  Files changed by this chat, with their latest recorded state.
                </Trans>
              </p>
              {artifacts.files.map((file) => (
                <section className="rounded-lg border bg-card p-3" key={file.path}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-xs">
                      {displayChatArtifactPath(file.path, projectRoot)}
                    </span>
                    <Badge className="shrink-0" variant="outline">
                      {kindLabel(file.kind)}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {statusLabel(file.status)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={<FolderGit2 />}
              text={i18n._(
                msg({
                  id: "chat.workspace.filesEmpty",
                  message: "No files have been changed in this chat yet.",
                })
              )}
            />
          )}
        </TabsContent>
        <TabsContent className="m-0 overflow-auto p-4" value="review">
          {artifacts.files.some((file) => file.diff) ? (
            <div className="grid gap-4">
              {artifacts.files
                .filter((file) => file.diff)
                .map((file) => (
                  <CodeBlock code={file.diff} key={file.id} language="diff">
                    <CodeBlockHeader>
                      <CodeBlockTitle>
                        <FileDiff size={14} />
                        <CodeBlockFilename>
                          {displayChatArtifactPath(file.path, projectRoot)}
                        </CodeBlockFilename>
                      </CodeBlockTitle>
                      <CodeBlockActions>
                        <Badge variant="outline">{statusLabel(file.status)}</Badge>
                        <CodeBlockCopyButton
                          aria-label={i18n._(
                            msg({ id: "chat.workspace.copyDiff", message: "Copy diff" })
                          )}
                          title={i18n._(
                            msg({ id: "chat.workspace.copyDiff", message: "Copy diff" })
                          )}
                        />
                      </CodeBlockActions>
                    </CodeBlockHeader>
                  </CodeBlock>
                ))}
            </div>
          ) : (
            <EmptyPanel
              icon={<FileDiff />}
              text={i18n._(
                msg({
                  id: "chat.workspace.reviewEmpty",
                  message: "No code changes are available for review yet.",
                })
              )}
            />
          )}
        </TabsContent>
        {terminalInSidePanel ? (
          <TabsContent className="m-0 min-h-0 overflow-hidden" value="terminal">
            <WorkspaceTerminalView
              controller={terminalController}
              onHide={onClose}
              onMove={onMoveTerminalToBottom}
              placement="right"
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </aside>
  )
}

function EmptyPanel({ icon, text }: Readonly<{ icon: ReactNode; text: string }>) {
  return (
    <div className="grid min-h-48 place-content-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <span className="mx-auto">{icon}</span>
      <span>{text}</span>
    </div>
  )
}
