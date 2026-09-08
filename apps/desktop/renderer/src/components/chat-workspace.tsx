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
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@cypheria/ui/ai-elements/model-selector"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
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
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
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
  ChevronDown,
  Copy,
  CornerDownLeft,
  Ellipsis,
  FileDiff,
  FolderGit2,
  Globe2,
  HardDrive,
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
  WalletCards,
} from "lucide-react"
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react"
import type {
  CodexChatFollowUp,
  CodexInteractionEvent,
  CodexInteractionResponse,
  CodexModelView,
  CodexPermissionSelection,
  CodexSkillView,
  CodexUiMessage,
  WalletActiveContext,
} from "../../../ipc/src/index.js"
import { CodexIpcChatTransport } from "../codex-chat.js"
import { Route } from "../routes/index"
import { newChatRevisionAtom } from "./chat-navigation"
import {
  type ChatWorkspaceArtifacts,
  deriveChatWorkspaceArtifacts,
  displayChatArtifactPath,
} from "./chat-workspace-artifacts"
import { CodexTurnMessage } from "./codex-turn.js"
import { ProjectCreateDialog } from "./project-create-dialog"
import {
  useWorkspaceTerminals,
  type WorkspaceTerminalsController,
  WorkspaceTerminalView,
} from "./workspace-terminal"

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
  return (
    <ChatSession
      key={thread ?? `new-chat-${revision}-${prompt ?? ""}-${project ?? ""}-${section ?? ""}`}
      initialProjectId={project}
      resumeThreadId={thread}
      initialPrompt={prompt}
      initialSectionId={section}
    />
  )
}

function ChatSession({
  resumeThreadId,
  initialPrompt,
  initialProjectId,
  initialSectionId,
}: Readonly<{
  resumeThreadId?: string
  initialPrompt?: string
  initialProjectId?: string
  initialSectionId?: string
}>) {
  const { i18n } = useLingui()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const composerFormId = useId()
  const hydratedThreadId = useRef<string | null>(null)
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
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false)
  const [terminalLocation, setTerminalLocation] = useState<"bottom" | "right">("bottom")
  const [wideViewport, setWideViewport] = useState(true)
  const [permissionSelection, setPermissionSelection] = useState<CodexPermissionSelection | null>(
    null
  )
  const [interactions, setInteractions] = useState<CodexInteractionEvent[]>([])
  const [autoReviews, setAutoReviews] = useState<AutoReviewView[]>([])
  const [strictReviewTurns, setStrictReviewTurns] = useState<Set<string>>(() => new Set())
  const selectedModel = models.find((model) => model.model === selectedModelId) ?? initialModel
  const selectedReasoning =
    reasoningEffort ?? settings?.reasoningEffort ?? selectedModel.defaultReasoningEffort
  const provider = settings?.provider ?? "openai"
  const projects = projectsQuery.data?.data ?? []
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const workspaceTerminals = useWorkspaceTerminals(selectedProjectId ?? undefined)
  const permissionsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.getPermissionsCatalog(selectedProject?.roots[0]),
    queryKey: ["codex", "permissions", selectedProject?.roots[0] ?? null],
  })
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
  const transport = useMemo(
    () =>
      new CodexIpcChatTransport(
        () => ({
          cwd: selectedProject?.roots[0],
          model: selectedModel.model,
          projectId: selectedProject?.id,
          provider,
          reasoningEffort: selectedReasoning,
          resumeThreadId,
          permissionSelection:
            resumeThreadId && !permissionSelection ? undefined : effectivePermissionSelection,
          serviceTier: settings?.serviceTier ?? undefined,
        }),
        async (threadId) => {
          if (resumeThreadId) return
          if (initialSectionId) {
            await window.cypheria?.codex.moveThreadToSection({
              sectionId: initialSectionId,
              threadId,
            })
            void queryClient.invalidateQueries({ queryKey: ["codex", "thread-sections"] })
          }
          void queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
          void queryClient.invalidateQueries({ queryKey: ["codex", "projects"] })
          void navigate({ replace: true, search: { thread: threadId } })
        }
      ),
    [
      provider,
      initialSectionId,
      navigate,
      queryClient,
      selectedProject?.id,
      selectedProject?.roots,
      resumeThreadId,
      effectivePermissionSelection,
      permissionSelection,
      selectedModel.model,
      selectedReasoning,
      settings?.serviceTier,
    ]
  )
  const { error, messages, sendMessage, setMessages, status, stop } = useChat<CodexUiMessage>({
    id: resumeThreadId ?? "new-chat",
    transport,
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
      changedFiles: workspaceArtifacts.files.length,
      completedSteps,
      totalSteps: plan?.type === "data-codex-plan" ? plan.data.plan.length : 0,
    }
  }, [messages, workspaceArtifacts.files.length])
  const visibleTurnIds = useMemo(
    () =>
      new Set(
        messages.flatMap((message) =>
          message.parts.flatMap((part) => (part.type === "data-codex-turn" ? [part.data.id] : []))
        )
      ),
    [messages]
  )
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
  const displayedTitle =
    titleOverride ??
    threadQuery.data?.title ??
    (resumeThreadId
      ? i18n._(msg({ id: "chat.title.chat", message: "Chat" }))
      : i18n._(msg({ id: "navigation.newChat", message: "New chat" })))

  useEffect(() => {
    if (!resumeThreadId || !threadQuery.data || hydratedThreadId.current === resumeThreadId) return
    hydratedThreadId.current = resumeThreadId
    setMessages(threadQuery.data.messages as CodexUiMessage[])
    setSelectedProjectId(threadQuery.data.projectId)
  }, [resumeThreadId, setMessages, threadQuery.data])

  useEffect(
    () => () => {
      void stop()
    },
    [stop]
  )

  useEffect(() => {
    const api = window.cypheria?.codex
    if (!api) return
    return api.onInteraction((interaction) => {
      if (resumeThreadId && interaction.threadId && interaction.threadId !== resumeThreadId) return
      setInteractions((current) =>
        current.some((item) => item.interactionId === interaction.interactionId)
          ? current
          : [...current, interaction]
      )
    })
  }, [resumeThreadId])

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault()
        setTerminalLocation("bottom")
        setBottomPanelOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

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

  const handleSubmit = async ({ text, files }: { text: string; files: FileUIPart[] }) => {
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
      try {
        if (mode === "queue") {
          if (!resumeThreadId) throw new Error("Wait for this new chat to finish before queueing.")
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
        throw reason
      }
      return
    }
    await sendMessage({ files, text: value })
  }

  return (
    <section className="h-screen min-h-0 bg-background max-[767px]:h-[calc(100vh-48px)]">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel id="workspace" minSize={240}>
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="conversation" minSize={480}>
              <main className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[var(--chrome-height,44px)_minmax(0,1fr)_auto] overflow-hidden [container-type:inline-size]">
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
                    <Button
                      aria-label={
                        bottomPanelOpen
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
                      onClick={() => {
                        setTerminalLocation("bottom")
                        setBottomPanelOpen((open) => !open)
                      }}
                      size="icon"
                      title={i18n._(
                        msg({
                          id: "chat.workspace.bottomPanelShortcut",
                          message: "Bottom panel (⌘J)",
                        })
                      )}
                      variant="ghost"
                    >
                      {bottomPanelOpen ? (
                        <PanelBottomClose aria-hidden="true" size={16} />
                      ) : (
                        <PanelBottomOpen aria-hidden="true" size={16} />
                      )}
                    </Button>
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
                        <DropdownMenuItem
                          onClick={() => {
                            setTerminalLocation("bottom")
                            setBottomPanelOpen((open) => !open)
                          }}
                        >
                          <PanelBottomOpen aria-hidden="true" />
                          <Trans id="chat.workspace.toggleBottomPanel">Toggle bottom panel</Trans>
                          <span className="ml-auto text-xs text-muted-foreground">⌘J</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </header>

                <Conversation className="min-h-0 min-w-0 overflow-x-hidden">
                  <ConversationContent className="mx-auto min-h-full w-[calc(100cqw-3rem)] min-w-0 max-w-3xl px-4 py-8">
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
                          onForkTurn={forkFromTurn}
                          onResolve={resolveInteraction}
                          scrollElementRef={conversation.scrollRef}
                        />
                      )
                    }
                  </ConversationContent>
                  {error ? (
                    <div className="absolute inset-x-4 bottom-4 mx-auto max-w-3xl rounded-lg border border-destructive/35 bg-background px-3 py-2 text-sm text-destructive shadow-lg">
                      {error.message}
                    </div>
                  ) : null}
                  <ConversationScrollButton />
                </Conversation>

                <div className="mx-auto w-full max-w-[880px] px-4 pb-5">
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
                    .filter((review) => !resumeThreadId || review.threadId === resumeThreadId)
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
                  <PromptInputProvider initialInput={initialPrompt}>
                    <PromptInput
                      accept="image/*,audio/*,video/*,text/*,.md,.json,.pdf"
                      className="[&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:shadow-sm"
                      globalDrop
                      id={composerFormId}
                      maxFileSize={25 * 1024 * 1024}
                      maxFiles={20}
                      multiple
                      onError={(nextError) => setAttachmentError(nextError.message)}
                      onSubmit={handleSubmit}
                    >
                      <PromptInputHeader>
                        <ComposerAttachments />
                      </PromptInputHeader>
                      <PromptInputBody>
                        <PromptInputTextarea
                          aria-label={i18n._(
                            msg({ id: "chat.prompt.label", message: "Message Cypheria" })
                          )}
                          className="min-h-14"
                          placeholder={i18n._(
                            msg({
                              id: "chat.prompt.placeholder",
                              message: "Ask Cypheria to inspect, edit, run, research, or review…",
                            })
                          )}
                        />
                      </PromptInputBody>
                      <PromptInputFooter>
                        <PromptInputTools className="flex-wrap">
                          <PromptInputActionMenu>
                            <PromptInputActionMenuTrigger
                              tooltip={i18n._(
                                msg({
                                  id: "chat.prompt.addContext",
                                  message: "Add files or screen context",
                                })
                              )}
                            />
                            <PromptInputActionMenuContent className="w-56">
                              <PromptInputActionAddAttachments
                                label={i18n._(
                                  msg({ id: "chat.prompt.addFiles", message: "Add files" })
                                )}
                              />
                              <PromptInputActionAddScreenshot
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
                            onValueChange={(value) =>
                              setSelectedProjectId(value === "none" ? null : String(value))
                            }
                            value={selectedProjectId ?? "none"}
                          >
                            <PromptInputSelectTrigger className="max-w-48">
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
                            </PromptInputSelectContent>
                          </PromptInputSelect>
                          <Button
                            aria-label={i18n._(
                              msg({ id: "chat.project.create", message: "Create project" })
                            )}
                            onClick={() => setProjectDialogOpen(true)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Plus aria-hidden="true" />
                          </Button>
                          <PromptInputSelect
                            onValueChange={(value) =>
                              setPermissionSelection(permissionSelectionFromValue(String(value)))
                            }
                            value={permissionValue}
                          >
                            <PromptInputSelectTrigger className="w-auto">
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
                          <ModelPicker
                            models={models.length ? models : [fallbackModel]}
                            onSelect={(model) => {
                              setSelectedModelId(model.model)
                              setReasoningEffort(model.defaultReasoningEffort)
                            }}
                            selected={selectedModel}
                          />
                          <PromptInputSelect
                            onValueChange={(value) => setReasoningEffort(String(value))}
                            value={selectedReasoning}
                          >
                            <PromptInputSelectTrigger className="w-auto">
                              <PromptInputSelectValue />
                            </PromptInputSelectTrigger>
                            <PromptInputSelectContent>
                              {selectedModel.reasoningEfforts.map((effort) => (
                                <PromptInputSelectItem key={effort.value} value={effort.value}>
                                  {effort.value}
                                </PromptInputSelectItem>
                              ))}
                            </PromptInputSelectContent>
                          </PromptInputSelect>
                        </PromptInputTools>
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
                              variant="secondary"
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
                        <PromptInputSubmit onStop={stop} status={status} />
                      </PromptInputFooter>
                    </PromptInput>
                  </PromptInputProvider>
                  {status !== "ready" ? (
                    <div
                      aria-live="polite"
                      className="mt-2 flex items-center gap-2 px-2 text-xs font-medium text-foreground"
                      role="status"
                    >
                      {status !== "error" ? (
                        <LoaderCircle aria-hidden="true" className="animate-spin" size={12} />
                      ) : null}
                      {statusLabel}
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-center gap-3 px-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <HardDrive size={12} /> <Trans id="chat.localAgent">Local agent</Trans>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <WalletCards size={12} />
                      <Trans id="chat.noSigningAuthority">No signing authority</Trans>
                    </span>
                    <span>{provider}</span>
                  </div>
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
        {bottomPanelOpen && terminalLocation === "bottom" ? (
          <>
            <ResizableHandle className="z-20 hover:bg-ring/45" />
            <ResizablePanel
              defaultSize={280}
              groupResizeBehavior="preserve-pixel-size"
              id="bottom-panel"
              maxSize="50%"
              minSize={160}
            >
              <WorkspaceTerminalView
                controller={workspaceTerminals}
                onHide={() => setBottomPanelOpen(false)}
                onMove={() => {
                  setTerminalLocation("right")
                  setBottomPanelOpen(false)
                  setWorkspacePanelOpen(true)
                }}
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
  onForkTurn,
  onResolve,
  scrollElementRef,
}: Readonly<{
  interactions: CodexInteractionEvent[]
  messages: CodexUiMessage[]
  onForkTurn: (turnId: string) => Promise<void>
  onResolve: (response: CodexInteractionResponse) => Promise<void>
  scrollElementRef: Readonly<{ current: HTMLElement | null }>
}>) {
  const virtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: (index) => (messages[index]?.role === "user" ? 112 : 320),
    getItemKey: (index) => messages[index]?.id ?? index,
    getScrollElement: () => scrollElementRef.current,
    overscan: 4,
  })

  return (
    <div
      className="relative w-full"
      data-chat-virtualizer="true"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const message = messages[virtualRow.index]
        if (!message) return null
        return (
          <div
            className="absolute top-0 left-0 w-full pb-8"
            data-index={virtualRow.index}
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <ChatMessage
              interactions={interactions}
              message={message}
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
  onForkTurn,
  onResolve,
}: Readonly<{
  interactions: readonly CodexInteractionEvent[]
  message: CodexUiMessage
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
              <MessageResponse key={`${message.id}-text-${part.text}`}>{part.text}</MessageResponse>
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

function ComposerAttachments() {
  const { i18n } = useLingui()
  const attachments = usePromptInputAttachments()
  if (!attachments.files.length) return null
  return (
    <Attachments className="ml-0 max-w-full" variant="inline">
      {attachments.files.map((file) => (
        <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove
            label={i18n._(
              msg({ id: "chat.prompt.removeAttachment", message: "Remove attachment" })
            )}
          />
        </Attachment>
      ))}
    </Attachments>
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
        disabled={!skills.length}
        tooltip={i18n._(msg({ id: "chat.prompt.skills", message: "Skills" }))}
      >
        <Sparkles className="size-3.5" />
        <span className="max-[620px]:hidden">
          <Trans id="chat.prompt.skills">Skills</Trans>
        </span>
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
  onSelect,
  selected,
}: Readonly<{
  models: CodexModelView[]
  onSelect: (model: CodexModelView) => void
  selected: CodexModelView
}>) {
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)
  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger
        render={
          <Button className="max-w-44 gap-1 px-2" size="sm" variant="ghost">
            <span className="truncate">{selected.displayName}</span>
            <ChevronDown className="size-3.5" />
          </Button>
        }
      />
      <ModelSelectorContent>
        <ModelSelectorInput
          placeholder={i18n._(msg({ id: "chat.model.search", message: "Search models…" }))}
        />
        <ModelSelectorList>
          <ModelSelectorEmpty>
            <Trans id="chat.model.empty">No models found.</Trans>
          </ModelSelectorEmpty>
          <ModelSelectorGroup
            heading={i18n._(msg({ id: "chat.model.available", message: "Available models" }))}
          >
            {models.map((model) => (
              <ModelSelectorItem
                key={model.id}
                onSelect={() => {
                  onSelect(model)
                  setOpen(false)
                }}
                value={`${model.displayName} ${model.model}`}
              >
                <ModelSelectorName>{model.displayName}</ModelSelectorName>
                {model.isDefault ? (
                  <Badge variant="secondary">
                    <Trans id="chat.model.default">Default</Trans>
                  </Badge>
                ) : null}
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
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
