import { useChat } from "@ai-sdk/react"
import { cn } from "@cypheria/ui"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@cypheria/ui/ai-elements/attachments"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@cypheria/ui/ai-elements/conversation"
import { Message, MessageContent, MessageResponse } from "@cypheria/ui/ai-elements/message"
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
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@cypheria/ui/ai-elements/prompt-input"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@cypheria/ui/ai-elements/reasoning"
import { Source, Sources, SourcesContent, SourcesTrigger } from "@cypheria/ui/ai-elements/sources"
import { Task, TaskContent, TaskItem, TaskTrigger } from "@cypheria/ui/ai-elements/task"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@cypheria/ui/ai-elements/tool"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import { Label } from "@cypheria/ui/components/label"
import { Separator } from "@cypheria/ui/components/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cypheria/ui/components/tabs"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type {
  CustomContentUIPart,
  DynamicToolUIPart,
  FileUIPart,
  ReasoningFileUIPart,
  SourceUrlUIPart,
  UIMessage,
} from "ai"
import { useAtomValue } from "jotai"
import {
  ChevronDown,
  FileDiff,
  FolderGit2,
  Globe2,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  Sparkles,
  TerminalSquare,
  WalletCards,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type {
  CodexInteractionEvent,
  CodexInteractionResponse,
  CodexModelView,
  WalletActiveContext,
} from "../../../ipc/src/index.js"
import { CodexIpcChatTransport } from "../codex-chat.js"
import { Route } from "../routes/index"
import { newTaskRevisionAtom } from "./task-navigation"

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

export default function TaskWorkspace() {
  const { thread, prompt } = Route.useSearch()
  const revision = useAtomValue(newTaskRevisionAtom)
  return (
    <TaskSession
      key={thread ?? `new-task-${revision}-${prompt ?? ""}`}
      resumeThreadId={thread}
      initialPrompt={prompt}
    />
  )
}

function TaskSession({
  resumeThreadId,
  initialPrompt,
}: Readonly<{ resumeThreadId?: string; initialPrompt?: string }>) {
  const { i18n } = useLingui()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(true)
  const [sandboxMode, setSandboxMode] = useState<
    "read-only" | "workspace-write" | "danger-full-access"
  >("workspace-write")
  const [interactions, setInteractions] = useState<CodexInteractionEvent[]>([])
  const selectedModel = models.find((model) => model.model === selectedModelId) ?? initialModel
  const selectedReasoning =
    reasoningEffort ?? settings?.reasoningEffort ?? selectedModel.defaultReasoningEffort
  const provider = settings?.provider ?? "openai"
  const projects = projectsQuery.data?.data ?? []
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const transport = useMemo(
    () =>
      new CodexIpcChatTransport(
        () => ({
          approvalPolicy: "on-request",
          cwd: selectedProject?.roots[0],
          model: selectedModel.model,
          projectId: selectedProject?.id,
          provider,
          reasoningEffort: selectedReasoning,
          resumeThreadId,
          sandboxMode,
          serviceTier: settings?.serviceTier ?? undefined,
        }),
        (threadId) => {
          if (resumeThreadId) return
          void queryClient.invalidateQueries({ queryKey: ["codex", "threads"] })
          void queryClient.invalidateQueries({ queryKey: ["codex", "projects"] })
          void navigate({ replace: true, search: { thread: threadId } })
        }
      ),
    [
      provider,
      navigate,
      queryClient,
      selectedProject?.id,
      selectedProject?.roots,
      resumeThreadId,
      sandboxMode,
      selectedModel.model,
      selectedReasoning,
      settings?.serviceTier,
    ]
  )
  const { error, messages, sendMessage, setMessages, status, stop } = useChat({
    id: resumeThreadId ?? "new-task",
    transport,
  })
  const statusLabel =
    status === "ready"
      ? i18n._(msg({ id: "task.status.local", message: "Local" }))
      : status === "submitted"
        ? i18n._(msg({ id: "task.status.starting", message: "Starting…" }))
        : status === "streaming"
          ? i18n._(msg({ id: "task.status.working", message: "Working…" }))
          : i18n._(msg({ id: "task.status.attention", message: "Needs attention" }))

  useEffect(() => {
    if (!resumeThreadId || !threadQuery.data || hydratedThreadId.current === resumeThreadId) return
    hydratedThreadId.current = resumeThreadId
    setMessages(threadQuery.data.messages as UIMessage[])
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

  const resolveInteraction = async (response: CodexInteractionResponse) => {
    await window.cypheria?.codex.respondToInteraction(response)
    setInteractions((current) =>
      current.filter((item) => item.interactionId !== response.interactionId)
    )
  }

  const handleSubmit = async ({ text, files }: { text: string; files: FileUIPart[] }) => {
    const value = text.trim()
    if (!value && files.length === 0) return
    await sendMessage({ files, text: value })
  }

  return (
    <section
      className={cn(
        "grid h-screen min-h-0 bg-background max-[1180px]:grid-cols-1 max-[767px]:h-[calc(100vh-48px)]",
        workspacePanelOpen ? "grid-cols-[minmax(520px,1fr)_minmax(320px,32vw)]" : "grid-cols-1"
      )}
    >
      <main className="grid min-h-0 min-w-0 grid-rows-[var(--chrome-height,44px)_minmax(0,1fr)_auto] border-r border-border max-[1180px]:border-r-0">
        <header className="desktop-titlebar flex min-h-[44px] items-center justify-between gap-3 border-b border-border px-4">
          <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
            <FolderGit2 aria-hidden="true" size={16} />
            <span className="truncate">
              {threadQuery.data?.title ??
                (resumeThreadId
                  ? i18n._(msg({ id: "task.title.task", message: "Task" }))
                  : i18n._(msg({ id: "navigation.newTask", message: "New task" })))}
            </span>
            <Badge aria-live="polite" variant="outline">
              {statusLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              nativeButton={false}
              render={
                <Link to="/settings/models">
                  <Settings aria-hidden="true" size={14} />
                  <Trans id="settings.models">Models</Trans>
                </Link>
              }
              size="sm"
              variant="ghost"
            />
            <Button
              aria-label={
                workspacePanelOpen
                  ? i18n._(msg({ id: "task.workspace.close", message: "Close workspace panel" }))
                  : i18n._(msg({ id: "task.workspace.open", message: "Open workspace panel" }))
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
          </div>
        </header>

        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto w-full max-w-3xl px-6 py-8">
            {resumeThreadId && threadQuery.isPending ? (
              <div
                className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
                <Trans id="task.loadingConversation">Loading conversation…</Trans>
              </div>
            ) : threadQuery.error ? (
              <div className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {threadQuery.error.message}
              </div>
            ) : messages.length === 0 ? (
              <ConversationEmptyState
                description={i18n._(
                  msg({
                    id: "task.empty.description",
                    message:
                      "Work across code, wallets, and the web while you stay in control of permissions.",
                  })
                )}
                icon={<Sparkles className="size-6" />}
                title={i18n._(
                  msg({ id: "task.empty.title", message: "What should Cypheria work on?" })
                )}
              />
            ) : (
              messages.map((message) => <ChatMessage key={message.id} message={message} />)
            )}
            {error ? (
              <div className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error.message}
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="mx-auto w-full max-w-[880px] px-4 pb-5">
          {interactions.map((interaction) => (
            <CodexInteractionCard
              interaction={interaction}
              key={interaction.interactionId}
              onResolve={resolveInteraction}
            />
          ))}
          <PromptInput accept="image/*,audio/*,text/*,.md,.json" multiple onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                defaultValue={initialPrompt}
                placeholder={i18n._(
                  msg({
                    id: "task.prompt.placeholder",
                    message: "Ask Cypheria to inspect, edit, run, research, or review…",
                  })
                )}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputSelect
                  onValueChange={(value) =>
                    setSelectedProjectId(value === "none" ? null : String(value))
                  }
                  value={selectedProjectId ?? "none"}
                >
                  <PromptInputSelectTrigger className="max-w-48">
                    <FolderGit2 className="size-3.5" />
                    <PromptInputSelectValue
                      placeholder={i18n._(msg({ id: "task.project.none", message: "No project" }))}
                    />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    <PromptInputSelectItem value="none">
                      <Trans id="task.project.none">No project</Trans>
                    </PromptInputSelectItem>
                    {projects.map((project) => (
                      <PromptInputSelectItem key={project.id} value={project.id}>
                        {project.name}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
                <Button
                  aria-label={i18n._(msg({ id: "task.project.create", message: "Create project" }))}
                  onClick={() => setProjectDialogOpen(true)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Plus aria-hidden="true" />
                </Button>
                <PromptInputSelect
                  onValueChange={(value) => setSandboxMode(value as typeof sandboxMode)}
                  value={sandboxMode}
                >
                  <PromptInputSelectTrigger className="w-auto">
                    <LockKeyhole className="size-3.5" />
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    <PromptInputSelectItem value="read-only">
                      <Trans id="task.sandbox.readOnly">Read only</Trans>
                    </PromptInputSelectItem>
                    <PromptInputSelectItem value="workspace-write">
                      <Trans id="task.sandbox.workspaceWrite">Workspace write</Trans>
                    </PromptInputSelectItem>
                    <PromptInputSelectItem value="danger-full-access">
                      <Trans id="task.sandbox.fullAccess">Full computer access</Trans>
                    </PromptInputSelectItem>
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
              <PromptInputSubmit onStop={stop} status={status} />
            </PromptInputFooter>
          </PromptInput>
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
              <HardDrive size={12} /> <Trans id="task.localAgent">Local agent</Trans>
            </span>
            <span className="inline-flex items-center gap-1">
              <WalletCards size={12} />
              <Trans id="task.noSigningAuthority">No signing authority</Trans>
            </span>
            <span>{provider}</span>
          </div>
        </div>
        <NewProjectDialog
          onCreated={(projectId) => {
            setSelectedProjectId(projectId)
            setProjectDialogOpen(false)
          }}
          onOpenChange={setProjectDialogOpen}
          open={projectDialogOpen}
        />
      </main>
      {workspacePanelOpen ? <WorkspacePanel activeWallet={activeWalletQuery.data} /> : null}
    </section>
  )
}

function NewProjectDialog({
  onCreated,
  onOpenChange,
  open,
}: Readonly<{
  onCreated: (projectId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}>) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [root, setRoot] = useState("")
  const [error, setError] = useState<string | null>(null)
  const createProject = useMutation({
    mutationFn: () => {
      const api = window.cypheria?.codex
      if (!api)
        throw new Error(
          i18n._(
            msg({
              id: "task.project.desktopOnly",
              message: "Codex is only available in the Cypheria desktop app.",
            })
          )
        )
      return api.createProject({ name: name.trim(), root })
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["codex", "projects"] })
      setName("")
      setRoot("")
      onCreated(project.id)
    },
  })

  const chooseRoot = async () => {
    const result = await window.cypheria?.codex.pickProjectRoot()
    if (!result?.path) return
    setRoot(result.path)
    if (!name.trim()) setName(result.path.split(/[\\/]/u).filter(Boolean).at(-1) ?? "Project")
  }

  const submit = async () => {
    setError(null)
    if (!name.trim() || !root) {
      setError(
        i18n._(
          msg({
            id: "task.project.validation",
            message: "Choose a folder and enter a project name.",
          })
        )
      )
      return
    }
    try {
      await createProject.mutateAsync()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans id="task.project.create">Create project</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="task.project.description">
              Group tasks around a local workspace and use it as the task working directory.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">
              <Trans id="task.project.name">Name</Trans>
            </Label>
            <Input
              id="project-name"
              onChange={(event) => setName(event.target.value)}
              placeholder={i18n._(
                msg({ id: "task.project.namePlaceholder", message: "My project" })
              )}
              value={name}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-root">
              <Trans id="task.project.folder">Folder</Trans>
            </Label>
            <div className="flex gap-2">
              <Input id="project-root" readOnly value={root} />
              <Button onClick={() => void chooseRoot()} type="button" variant="outline">
                <Trans id="task.project.chooseFolder">Choose…</Trans>
              </Button>
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={createProject.isPending} onClick={() => void submit()} type="button">
            {createProject.isPending ? (
              <Trans id="task.project.creating">Creating…</Trans>
            ) : (
              <Trans id="task.project.create">Create project</Trans>
            )}
          </Button>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            <Trans id="task.cancel">Cancel</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-muted p-2 text-[11px]">
          {JSON.stringify(interaction.params, null, 2)}
        </pre>
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
        <Button
          disabled={submitting}
          onClick={() => void submit("decline")}
          size="sm"
          variant="ghost"
        >
          Decline
        </Button>
        {interaction.kind === "approval" ? (
          <Button
            disabled={submitting}
            onClick={() => void submit("accept-for-session")}
            size="sm"
            variant="outline"
          >
            Allow for session
          </Button>
        ) : null}
        <Button disabled={submitting} onClick={() => void submit("accept")} size="sm">
          {interaction.kind === "user-input" ? "Submit" : "Allow"}
        </Button>
      </div>
    </section>
  )
}

function ChatMessage({ message }: Readonly<{ message: UIMessage }>) {
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
          placeholder={i18n._(msg({ id: "task.model.search", message: "Search models…" }))}
        />
        <ModelSelectorList>
          <ModelSelectorEmpty>
            <Trans id="task.model.empty">No models found.</Trans>
          </ModelSelectorEmpty>
          <ModelSelectorGroup
            heading={i18n._(msg({ id: "task.model.available", message: "Available models" }))}
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
                    <Trans id="task.model.default">Default</Trans>
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

function WorkspacePanel({ activeWallet }: Readonly<{ activeWallet?: WalletActiveContext }>) {
  const { i18n } = useLingui()
  return (
    <aside
      aria-label={i18n._(msg({ id: "task.workspace.label", message: "Workspace panel" }))}
      className="min-h-0 min-w-0 overflow-hidden bg-muted/20 max-[1180px]:hidden"
    >
      <Tabs
        className="grid h-full grid-rows-[var(--chrome-height,44px)_minmax(0,1fr)]"
        defaultValue="context"
      >
        <div className="flex items-center border-b border-border px-3">
          <TabsList className="bg-transparent">
            <TabsTrigger value="context">
              <Trans id="task.workspace.context">Context</Trans>
            </TabsTrigger>
            <TabsTrigger value="files">
              <Trans id="task.workspace.files">Files</Trans>
            </TabsTrigger>
            <TabsTrigger value="review">
              <Trans id="task.workspace.review">Review</Trans>
            </TabsTrigger>
            <TabsTrigger value="terminal">
              <Trans id="task.workspace.terminal">Terminal</Trans>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent className="m-0 overflow-auto p-4" value="context">
          <div className="grid gap-4">
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium">
                <WalletCards size={16} />
                <Trans id="task.workspace.web3Context">Web3 context</Trans>
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
                  <Trans id="task.workspace.noWallet">
                    No wallet selected. On-chain actions remain read only.
                  </Trans>
                </p>
              )}
            </section>
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium">
                <Globe2 size={16} /> <Trans id="task.workspace.browser">Browser</Trans>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                <Trans id="task.workspace.browserDescription">
                  Open an isolated dApp session from a task result or browser action.
                </Trans>
              </p>
            </section>
          </div>
        </TabsContent>
        <TabsContent className="m-0 p-4" value="files">
          <EmptyPanel
            icon={<FolderGit2 />}
            text={i18n._(
              msg({ id: "task.workspace.filesEmpty", message: "Workspace files open here." })
            )}
          />
        </TabsContent>
        <TabsContent className="m-0 p-4" value="review">
          <EmptyPanel
            icon={<FileDiff />}
            text={i18n._(
              msg({
                id: "task.workspace.reviewEmpty",
                message: "Code changes open here for review.",
              })
            )}
          />
        </TabsContent>
        <TabsContent className="m-0 p-4" value="terminal">
          <EmptyPanel
            icon={<TerminalSquare />}
            text={i18n._(
              msg({
                id: "task.workspace.terminalEmpty",
                message: "Command output opens here.",
              })
            )}
          />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function EmptyPanel({ icon, text }: Readonly<{ icon: ReactNode; text: string }>) {
  return (
    <div className="grid h-full place-content-center gap-3 text-center text-sm text-muted-foreground">
      {icon}
      <Separator />
      {text}
    </div>
  )
}
