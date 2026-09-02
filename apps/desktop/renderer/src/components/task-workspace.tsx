import { useChat } from "@ai-sdk/react"
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
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@cypheria/ui/ai-elements/tool"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Separator } from "@cypheria/ui/components/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cypheria/ui/components/tabs"
import { useQuery } from "@tanstack/react-query"
import type { DynamicToolUIPart, FileUIPart, UIMessage } from "ai"
import {
  ChevronDown,
  FileDiff,
  FolderGit2,
  Globe2,
  HardDrive,
  LockKeyhole,
  PanelRightClose,
  Settings,
  Sparkles,
  TerminalSquare,
  WalletCards,
} from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import type { CodexModelView, WalletActiveContext } from "../../../ipc/src/index.js"
import { CodexIpcChatTransport } from "../codex-chat.js"

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
  const params = new URLSearchParams(globalThis.location?.search ?? "")
  const resumeThreadId = params.get("thread") ?? undefined
  const modelSettingsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.getModelSettings(),
    queryKey: ["codex", "model-settings"],
  })
  const modelsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.listModels() ?? [],
    queryKey: ["codex", "models"],
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
  const [sandboxMode, setSandboxMode] = useState<
    "read-only" | "workspace-write" | "danger-full-access"
  >("workspace-write")
  const selectedModel = models.find((model) => model.model === selectedModelId) ?? initialModel
  const selectedReasoning =
    reasoningEffort ?? settings?.reasoningEffort ?? selectedModel.defaultReasoningEffort
  const provider = settings?.provider ?? "openai"
  const transport = useMemo(
    () =>
      new CodexIpcChatTransport(() => ({
        approvalPolicy: "on-request",
        model: selectedModel.model,
        provider,
        reasoningEffort: selectedReasoning,
        resumeThreadId,
        sandboxMode,
        serviceTier: settings?.serviceTier ?? undefined,
      })),
    [
      provider,
      resumeThreadId,
      sandboxMode,
      selectedModel.model,
      selectedReasoning,
      settings?.serviceTier,
    ]
  )
  const { error, messages, sendMessage, status, stop } = useChat({
    id: resumeThreadId ?? "new-task",
    transport,
  })

  const handleSubmit = async ({ text, files }: { text: string; files: FileUIPart[] }) => {
    const value = text.trim()
    if (!value && files.length === 0) return
    await sendMessage({ files, text: value })
  }

  return (
    <section className="grid h-screen min-h-0 grid-cols-[minmax(520px,1fr)_minmax(320px,32vw)] bg-background max-[1180px]:grid-cols-1 max-[860px]:h-[calc(100vh-48px)]">
      <main className="grid min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)_auto] border-r border-border max-[1180px]:border-r-0">
        <header className="flex min-h-[54px] items-center justify-between gap-3 border-b border-border px-4">
          <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
            <FolderGit2 aria-hidden="true" size={16} />
            <span className="truncate">{resumeThreadId ? "Task" : "New task"}</span>
            <Badge variant="outline">{status === "ready" ? "Local" : status}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              render={
                <a href="/settings/models">
                  <span className="sr-only">Model settings</span>
                </a>
              }
              size="sm"
              variant="ghost"
            >
              <Settings aria-hidden="true" size={14} />
              Models
            </Button>
            <Button aria-label="Close workspace panel" size="icon" variant="ghost">
              <PanelRightClose aria-hidden="true" size={16} />
            </Button>
          </div>
        </header>

        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto w-full max-w-3xl px-6 py-8">
            {messages.length === 0 ? (
              <ConversationEmptyState
                description="Work across code, wallets, and the web while you stay in control of permissions."
                icon={<Sparkles className="size-6" />}
                title="What should Cypheria work on?"
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
          <PromptInput accept="image/*,text/*,.md,.json" multiple onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea placeholder="Ask Cypheria to inspect, edit, run, research, or review…" />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputSelect
                  onValueChange={(value) => setSandboxMode(value as typeof sandboxMode)}
                  value={sandboxMode}
                >
                  <PromptInputSelectTrigger className="w-auto">
                    <LockKeyhole className="size-3.5" />
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    <PromptInputSelectItem value="read-only">Read only</PromptInputSelectItem>
                    <PromptInputSelectItem value="workspace-write">
                      Workspace write
                    </PromptInputSelectItem>
                    <PromptInputSelectItem value="danger-full-access">
                      Full computer access
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
          <div className="mt-2 flex items-center gap-3 px-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <HardDrive size={12} /> Local agent
            </span>
            <span className="inline-flex items-center gap-1">
              <WalletCards size={12} /> No signing authority
            </span>
            <span>{provider}</span>
          </div>
        </div>
      </main>
      <WorkspacePanel activeWallet={activeWalletQuery.data} />
    </section>
  )
}

function ChatMessage({ message }: Readonly<{ message: UIMessage }>) {
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part) => {
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
          return null
        })}
      </MessageContent>
    </Message>
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
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          <ModelSelectorGroup heading="Available models">
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
                {model.isDefault ? <Badge variant="secondary">Default</Badge> : null}
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}

function WorkspacePanel({ activeWallet }: Readonly<{ activeWallet?: WalletActiveContext }>) {
  return (
    <aside
      aria-label="Workspace panel"
      className="min-h-0 min-w-0 overflow-hidden bg-muted/20 max-[1180px]:hidden"
    >
      <Tabs className="grid h-full grid-rows-[54px_minmax(0,1fr)]" defaultValue="context">
        <div className="flex items-center border-b border-border px-3">
          <TabsList className="bg-transparent">
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent className="m-0 overflow-auto p-4" value="context">
          <div className="grid gap-4">
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium">
                <WalletCards size={16} /> Web3 context
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
                    Chain {activeWallet.chainAccount.chainId}
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No wallet selected. The task remains read only.
                </p>
              )}
            </section>
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium">
                <Globe2 size={16} /> Browser
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Open an isolated dApp session from a task result or browser action.
              </p>
            </section>
          </div>
        </TabsContent>
        <TabsContent className="m-0 p-4" value="files">
          <EmptyPanel icon={<FolderGit2 />} text="Workspace files open here." />
        </TabsContent>
        <TabsContent className="m-0 p-4" value="review">
          <EmptyPanel icon={<FileDiff />} text="Code changes open here for review." />
        </TabsContent>
        <TabsContent className="m-0 p-4" value="terminal">
          <EmptyPanel icon={<TerminalSquare />} text="Command output opens here." />
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
