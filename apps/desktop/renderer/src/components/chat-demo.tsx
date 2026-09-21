import { MessageResponse } from "@cypheria/ui/ai-elements/message"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  type PromptInputMessage,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputTextarea,
} from "@cypheria/ui/ai-elements/prompt-input"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@cypheria/ui/ai-elements/reasoning"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@cypheria/ui/ai-elements/tool"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  ChatAssistantMessage,
  ChatComposerBody,
  ChatComposerContextTray,
  ChatComposerControl,
  ChatComposerDock,
  ChatComposerFooter,
  ChatComposerFrame,
  ChatComposerHeader,
  ChatComposerRevealControl,
  ChatComposerSubmit,
  ChatComposerUtilityBar,
  ChatHeader,
  ChatHeaderActions,
  ChatHeaderBreadcrumb,
  ChatHeaderStatus,
  ChatHeaderTitle,
  ChatMainColumn,
  ChatMessageActions,
  ChatPanel,
  ChatPanelEmptyState,
  ChatPanelLauncher,
  type ChatPanelPlacement,
  type ChatPanelTabDescriptor,
  ChatPanelToggle,
  type ChatPanelVisibility,
  ChatPinnedSummary,
  ChatPlanPanel,
  ChatPlanStep,
  ChatPullRequestCard,
  ChatResponseSpacer,
  ChatReviewDiffHost,
  ChatReviewFileList,
  ChatReviewPanel,
  ChatReviewToolbar,
  ChatScrollToLatest,
  ChatSourceGroup,
  ChatSourceItem,
  ChatSourcesPanel,
  ChatSubagentGroup,
  ChatSubagentItem,
  ChatSubagentsPanel,
  ChatSummaryPanel,
  ChatSummarySection,
  ChatTerminalOutputHost,
  ChatTerminalPanel,
  ChatTerminalStatusBar,
  ChatTerminalTabs,
  ChatTimeline,
  ChatTimelineContent,
  ChatTimelineItem,
  ChatTurnActivity,
  ChatTurnMarker,
  ChatTurnNavigator,
  ChatUserMessage,
  ChatWorkspaceShell,
} from "@cypheria/ui/components/chat"
import {
  AgentIcon,
  DockIcon,
  FileIcon,
  GlobeIcon,
  SidebarRightIcon,
  TerminalIcon,
} from "@cypheria/ui/components/icons"
import type { ChatStatus } from "ai"
import {
  Check,
  ChevronRight,
  Copy,
  GitBranch,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Share2,
  Sparkles,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type DemoPanelId = "sources" | "subagents" | "plan" | "summary" | "review" | "terminal"

type DemoMessage = {
  id: string
  role: "assistant" | "user"
  text: string
  showcase?: boolean
}

const initialMessages: DemoMessage[] = [
  {
    id: "user-1",
    role: "user",
    text: "Audit the Codex conversation experience and prepare reusable UI primitives for Cypheria.",
  },
  {
    id: "assistant-1",
    role: "assistant",
    showcase: true,
    text: "I mapped the title bar, timeline, composer, right panel, and bottom panel into reusable presentation primitives. The demo keeps application state local while preserving the same controlled contracts the production workspace will use.",
  },
]

const initialPlacements: Record<DemoPanelId, ChatPanelPlacement | null> = {
  plan: "right",
  review: "right",
  sources: "right",
  subagents: "right",
  summary: "bottom",
  terminal: "bottom",
}

const panelTitles: Record<DemoPanelId, string> = {
  plan: "Plan",
  review: "Review",
  sources: "Sources",
  subagents: "Subagents",
  summary: "Summary",
  terminal: "Terminal",
}

const panelIcons: Record<DemoPanelId, React.ReactNode> = {
  plan: <Check aria-hidden="true" className="size-3.5" />,
  review: <GitBranch aria-hidden="true" className="size-3.5" />,
  sources: <FileIcon />,
  subagents: <AgentIcon />,
  summary: <Sparkles aria-hidden="true" className="size-3.5" />,
  terminal: <TerminalIcon />,
}

const panelIds = Object.keys(panelTitles) as DemoPanelId[]

const assistantReply =
  "This is a local demonstration response. It exercises message insertion, streaming state, bottom anchoring, panel state, and the reusable composer without contacting an agent runtime."

export default function ChatDemo() {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState("")
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [model, setModel] = useState("gpt-5.6")
  const [reasoning, setReasoning] = useState("high")
  const [autoApprove, setAutoApprove] = useState(false)
  const [composerVisible, setComposerVisible] = useState(true)
  const [summaryVisible, setSummaryVisible] = useState(true)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [rightVisibility, setRightVisibility] = useState<ChatPanelVisibility>("visible")
  const [bottomVisibility, setBottomVisibility] = useState<ChatPanelVisibility>("visible")
  const [placements, setPlacements] = useState(initialPlacements)
  const [rightActive, setRightActive] = useState<DemoPanelId>("sources")
  const [bottomActive, setBottomActive] = useState<DemoPanelId>("terminal")
  const [selectedReviewFile, setSelectedReviewFile] = useState("chat-demo.tsx")
  const timersRef = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer)
    timersRef.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const scrollToLatest = useCallback(() => {
    const timeline = document.querySelector<HTMLElement>('[data-slot="chat-timeline"]')
    timeline?.scrollTo({ behavior: "smooth", top: timeline.scrollHeight })
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: turn and stream changes intentionally trigger bottom anchoring
  useEffect(() => {
    scrollToLatest()
  }, [messages, status, scrollToLatest])

  const stopGeneration = useCallback(() => {
    clearTimers()
    setStatus("ready")
  }, [clearTimers])

  const submitMessage = useCallback(
    ({ text }: PromptInputMessage) => {
      const trimmed = text.trim()
      if (!trimmed || status === "submitted" || status === "streaming") return
      clearTimers()
      setDraft("")
      setMessages((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: "user", text: trimmed },
      ])
      setStatus("submitted")

      timersRef.current = [
        window.setTimeout(() => setStatus("streaming"), 250),
        window.setTimeout(() => {
          setMessages((current) => [
            ...current,
            { id: `assistant-${Date.now()}`, role: "assistant", text: assistantReply },
          ])
          setStatus("ready")
          timersRef.current = []
        }, 1_100),
      ]
    },
    [clearTimers, status]
  )

  const panelContent = useMemo<Record<DemoPanelId, React.ReactNode>>(
    () => ({
      sources: (
        <ChatSourcesPanel>
          <ChatSourceGroup count="3" title="Workspace files">
            <ChatSourceItem
              source={{
                description: "Reusable conversation shell",
                id: "source-chat",
                kind: "read",
                label: "packages/ui/src/components/chat",
                metadata: "9 files",
              }}
            />
            <ChatSourceItem
              source={{
                description: "Desktop route and demo composition",
                id: "source-demo",
                kind: "updated",
                label: "apps/desktop/renderer/src/components/chat-demo.tsx",
              }}
            />
            <ChatSourceItem
              source={{
                description: "Codex conversation UI evidence",
                id: "source-audit",
                kind: "attached",
                label: "codex-conversation-ui-reference.md",
              }}
            />
          </ChatSourceGroup>
          <ChatSourceGroup count="1" title="Web">
            <ChatSourceItem
              source={{
                description: "Component behavior reference",
                icon: <GlobeIcon />,
                id: "source-web",
                kind: "web",
                label: "OpenAI Apps SDK UI",
              }}
            />
          </ChatSourceGroup>
        </ChatSourcesPanel>
      ),
      subagents: (
        <ChatSubagentsPanel>
          <ChatSubagentGroup count="2" title="This task">
            <ChatSubagentItem
              agent={{
                description: "Comparing panel and composer states",
                id: "agent-audit",
                model: "gpt-5.6",
                reasoningEffort: "high",
                state: "running",
                title: "UI audit",
              }}
              stateLabel="Running"
            />
            <ChatSubagentItem
              agent={{
                description: "Verified component contracts",
                id: "agent-tests",
                model: "gpt-5.6",
                state: "completed",
                title: "Test review",
              }}
              stateLabel="Done"
            />
          </ChatSubagentGroup>
        </ChatSubagentsPanel>
      ),
      plan: (
        <ChatPlanPanel>
          <ol className="space-y-1">
            <ChatPlanStep state="completed" stateLabel="Done">
              Audit the conversation hierarchy
            </ChatPlanStep>
            <ChatPlanStep state="completed" stateLabel="Done">
              Implement reusable chat primitives
            </ChatPlanStep>
            <ChatPlanStep state="running" stateLabel="In progress">
              Compose the Desktop demonstration
            </ChatPlanStep>
            <ChatPlanStep state="waiting" stateLabel="Queued">
              Integrate the production timeline
            </ChatPlanStep>
          </ol>
        </ChatPlanPanel>
      ),
      summary: (
        <ChatSummaryPanel>
          <ChatSummarySection title="Goal">
            Match the Codex task experience while preserving Cypheria ownership boundaries.
          </ChatSummarySection>
          <ChatSummarySection title="Decisions">
            Panels are controlled, content accepts React nodes, and runtime services remain in the
            Desktop application layer.
          </ChatSummarySection>
          <ChatSummarySection title="Next step">
            Map canonical timeline events into these presentation components.
          </ChatSummarySection>
        </ChatSummaryPanel>
      ),
      review: (
        <ChatReviewPanel>
          <ChatReviewToolbar>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">Working tree</span>
            <Badge variant="secondary">3 files</Badge>
          </ChatReviewToolbar>
          <ChatPullRequestCard
            branch="codex/chat-demo"
            status="Draft"
            title="Desktop chat component showcase"
          >
            Demonstrates the reusable shell without connecting to production conversation state.
          </ChatPullRequestCard>
          <ChatReviewFileList
            files={[
              {
                additions: 280,
                deletions: 0,
                id: "chat-demo.tsx",
                path: "chat-demo.tsx",
                selected: selectedReviewFile === "chat-demo.tsx",
                status: "added",
              },
              {
                additions: 11,
                deletions: 1,
                id: "chat-sidebar.tsx",
                path: "chat-sidebar.tsx",
                selected: selectedReviewFile === "chat-sidebar.tsx",
                status: "modified",
              },
              {
                additions: 5,
                deletions: 0,
                id: "chat-demo.test.tsx",
                path: "chat-demo.test.tsx",
                selected: selectedReviewFile === "chat-demo.test.tsx",
                status: "added",
              },
            ]}
            selectFileLabel={(file) => `Open ${String(file.path)}`}
            statusLabel={(file) => file.status}
            onSelectFile={setSelectedReviewFile}
          />
          <ChatReviewDiffHost className="m-2 rounded-lg border p-3">
            <pre>{`@@ -0,0 +1,5 @@\n+export function ChatDemo() {\n+  return <ChatWorkspaceShell />\n+}`}</pre>
          </ChatReviewDiffHost>
        </ChatReviewPanel>
      ),
      terminal: (
        <ChatTerminalPanel>
          <ChatTerminalTabs
            activeTabId="checks"
            selectTabLabel={(tab) => `Select ${String(tab.title)}`}
            statusLabel={(terminalStatus) => terminalStatus}
            tabs={[{ id: "checks", status: "exited", title: "UI checks" }]}
          />
          <ChatTerminalOutputHost className="overflow-auto bg-zinc-950 p-3 text-zinc-200">
            <pre>{`$ pnpm --filter @cypheria/ui test\n✓ 66 tests passed\n\n$ pnpm --filter @cypheria/desktop typecheck\n✓ completed`}</pre>
          </ChatTerminalOutputHost>
          <ChatTerminalStatusBar status="exited">
            <span>Process exited with code 0</span>
            <span className="ml-auto">zsh</span>
          </ChatTerminalStatusBar>
        </ChatTerminalPanel>
      ),
    }),
    [selectedReviewFile]
  )

  const tabsFor = useCallback(
    (placement: ChatPanelPlacement): ChatPanelTabDescriptor[] =>
      panelIds
        .filter((id) => placements[id] === placement)
        .map((id) => ({
          closable: true,
          content: panelContent[id],
          icon: panelIcons[id],
          id,
          movable: true,
          title: panelTitles[id],
        })),
    [panelContent, placements]
  )

  const rightTabs = tabsFor("right")
  const bottomTabs = tabsFor("bottom")
  const resolvedRightActive = rightTabs.some(({ id }) => id === rightActive)
    ? rightActive
    : (rightTabs[0]?.id as DemoPanelId | undefined)
  const resolvedBottomActive = bottomTabs.some(({ id }) => id === bottomActive)
    ? bottomActive
    : (bottomTabs[0]?.id as DemoPanelId | undefined)

  const launchItems = (placement: ChatPanelPlacement) =>
    panelIds
      .filter((id) => placements[id] !== placement)
      .map((id) => ({
        description: placements[id] ? `Move from ${placements[id]}` : "Open panel",
        icon: panelIcons[id],
        id,
        label: panelTitles[id],
      }))

  const placePanel = (id: string, placement: ChatPanelPlacement) => {
    const panelId = id as DemoPanelId
    setPlacements((current) => ({ ...current, [panelId]: placement }))
    if (placement === "right") {
      setRightActive(panelId)
      setRightVisibility("visible")
    } else {
      setBottomActive(panelId)
      setBottomVisibility("visible")
    }
  }

  const closePanel = (id: string) => {
    setPlacements((current) => ({ ...current, [id as DemoPanelId]: null }))
  }

  const showPanel = (placement: ChatPanelPlacement) => {
    if (!panelIds.some((id) => placements[id] === placement)) {
      placePanel(placement === "right" ? "sources" : "terminal", placement)
    }
    if (placement === "right") setRightVisibility("visible")
    else setBottomVisibility("visible")
  }

  const togglePanel = (placement: ChatPanelPlacement) => {
    const visibility = placement === "right" ? rightVisibility : bottomVisibility
    if (visibility === "visible") {
      if (placement === "right") setRightVisibility("hidden")
      else setBottomVisibility("hidden")
      return
    }
    showPanel(placement)
  }

  const panelLauncher = (placement: ChatPanelPlacement) => (
    <ChatPanelLauncher
      items={launchItems(placement)}
      label={`Add panel to ${placement}`}
      onLaunch={(id) => placePanel(id, placement)}
    />
  )

  const renderPanel = (placement: ChatPanelPlacement) => {
    const isRight = placement === "right"
    const visibility = isRight ? rightVisibility : bottomVisibility
    const tabs = isRight ? rightTabs : bottomTabs
    const activeId = isRight ? resolvedRightActive : resolvedBottomActive
    return (
      <ChatPanel
        activeTabId={activeId}
        closeTabLabel={(tab) => `Close ${String(tab.title)}`}
        emptyState={
          <ChatPanelEmptyState>
            <span>No open panels</span>
          </ChatPanelEmptyState>
        }
        hideLabel={`Hide ${placement} panel`}
        launcher={panelLauncher(placement)}
        moveTabLabel={(tab, destination) => `Move ${String(tab.title)} to ${destination}`}
        placement={placement}
        tabs={tabs}
        visibility={visibility}
        onActiveTabChange={(id) =>
          isRight ? setRightActive(id as DemoPanelId) : setBottomActive(id as DemoPanelId)
        }
        onCloseTab={closePanel}
        onMoveTab={placePanel}
        onVisibilityChange={(next) =>
          isRight ? setRightVisibility(next) : setBottomVisibility(next)
        }
      />
    )
  }

  const generating = status === "submitted" || status === "streaming"

  return (
    <ChatWorkspaceShell
      bottomPanel={renderPanel("bottom")}
      bottomPanelSize={250}
      bottomPanelVisibility={bottomVisibility}
      header={
        <>
          <ChatHeader>
            <ChatHeaderBreadcrumb>
              <span>Cypheria</span>
              <ChevronRight aria-hidden="true" className="size-3.5" />
              <span>Development</span>
            </ChatHeaderBreadcrumb>
            <ChatHeaderTitle>Chat Demo</ChatHeaderTitle>
            <ChatHeaderStatus state={generating ? "running" : "completed"}>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {generating ? "Generating" : "Demo ready"}
            </ChatHeaderStatus>
            <ChatHeaderActions>
              <Button aria-label="Share demo" size="icon-sm" type="button" variant="ghost">
                <Share2 aria-hidden="true" className="size-4" />
              </Button>
              <ChatPanelToggle
                label="Toggle pinned summary"
                panel="summary"
                pressed={summaryVisible}
                tooltip="Pinned summary"
                onClick={() => setSummaryVisible((current) => !current)}
              >
                <Sparkles aria-hidden="true" className="size-4" />
              </ChatPanelToggle>
              <ChatPanelToggle
                label="Toggle bottom panel"
                panel="bottom"
                pressed={bottomVisibility === "visible"}
                tooltip="Bottom panel"
                onClick={() => togglePanel("bottom")}
              >
                <DockIcon />
              </ChatPanelToggle>
              <ChatPanelToggle
                label="Toggle right panel"
                panel="right"
                pressed={rightVisibility === "visible"}
                tooltip="Right panel"
                onClick={() => togglePanel("right")}
              >
                <SidebarRightIcon />
              </ChatPanelToggle>
              <Button aria-label="More demo actions" size="icon-sm" type="button" variant="ghost">
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </Button>
            </ChatHeaderActions>
          </ChatHeader>
          {summaryVisible ? (
            <ChatPinnedSummary>
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  Building a reusable Codex-style conversation shell for Cypheria Desktop.
                </span>
                <Badge variant="secondary">Local demo</Badge>
              </div>
            </ChatPinnedSummary>
          ) : null}
        </>
      }
      rightPanel={renderPanel("right")}
      rightPanelSize={344}
      rightPanelVisibility={rightVisibility}
    >
      <ChatMainColumn>
        <ChatTurnNavigator label="Conversation turns">
          {messages.map((message, index) => (
            <ChatTurnMarker
              active={index === messages.length - 1}
              key={message.id}
              label={`Go to turn ${index + 1}`}
              onClick={() =>
                document.querySelector(`[data-demo-message="${message.id}"]`)?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                })
              }
            />
          ))}
        </ChatTurnNavigator>
        <ChatTimeline
          onScroll={(event) => {
            const timeline = event.currentTarget
            setShowScrollToLatest(
              timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight > 48
            )
          }}
        >
          <ChatTimelineContent>
            {messages.map((message) => (
              <ChatTimelineItem
                data-demo-message={message.id}
                key={message.id}
                kind={message.role}
                state="completed"
              >
                {message.role === "user" ? (
                  <ChatUserMessage>{message.text}</ChatUserMessage>
                ) : (
                  <ChatAssistantMessage>
                    {message.showcase ? (
                      <>
                        <Reasoning defaultOpen={false} duration={8}>
                          <ReasoningTrigger />
                          <ReasoningContent>
                            Inspect the spatial model, identify reusable state boundaries, and keep
                            renderer-owned behavior outside the UI package.
                          </ReasoningContent>
                        </Reasoning>
                        <Tool defaultOpen>
                          <ToolHeader
                            state="output-available"
                            title="Read component inventory"
                            toolName="read_files"
                            type="dynamic-tool"
                          />
                          <ToolContent>
                            <ToolInput input={{ path: "packages/ui/src/components/chat" }} />
                            <ToolOutput
                              errorText={undefined}
                              output="Found shell, timeline, composer, panel, and content primitives."
                            />
                          </ToolContent>
                        </Tool>
                      </>
                    ) : null}
                    <MessageResponse>{message.text}</MessageResponse>
                  </ChatAssistantMessage>
                )}
                <ChatMessageActions>
                  <Button aria-label="Copy message" size="icon-xs" type="button" variant="ghost">
                    <Copy aria-hidden="true" className="size-3.5" />
                  </Button>
                  <Button aria-label="Retry message" size="icon-xs" type="button" variant="ghost">
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                  </Button>
                </ChatMessageActions>
              </ChatTimelineItem>
            ))}
            {status === "submitted" ? (
              <ChatTimelineItem kind="activity" state="waiting">
                <ChatTurnActivity state="waiting" icon={<Sparkles className="size-4" />}>
                  Preparing a response…
                </ChatTurnActivity>
              </ChatTimelineItem>
            ) : null}
            {status === "streaming" ? (
              <ChatTimelineItem kind="activity" state="running">
                <ChatTurnActivity state="running" icon={<Sparkles className="size-4" />}>
                  Streaming the local demonstration response…
                </ChatTurnActivity>
              </ChatTimelineItem>
            ) : null}
            <ChatResponseSpacer height={generating ? 96 : 0} />
          </ChatTimelineContent>
        </ChatTimeline>
        {showScrollToLatest ? (
          <ChatScrollToLatest
            label="Scroll to latest message"
            tooltip="Scroll to latest"
            onClick={scrollToLatest}
          />
        ) : null}
        <ChatComposerDock visible={composerVisible}>
          <ChatComposerFrame>
            <PromptInput accept="image/*,.md,.txt" multiple onSubmit={submitMessage}>
              <ChatComposerHeader>
                <ChatComposerContextTray>
                  <Badge className="gap-1" variant="secondary">
                    <FileIcon /> README.md
                    <X aria-hidden="true" className="size-3" />
                  </Badge>
                  <Badge className="gap-1" variant="secondary">
                    <GlobeIcon /> UI audit
                    <X aria-hidden="true" className="size-3" />
                  </Badge>
                </ChatComposerContextTray>
              </ChatComposerHeader>
              <ChatComposerBody>
                <PromptInputTextarea
                  aria-label="Message Chat Demo"
                  className="max-h-40 min-h-14 resize-none border-0 px-0 shadow-none focus-visible:ring-0"
                  disabled={status === "submitted"}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  placeholder="Ask Cypheria to build, explain, or review…"
                  value={draft}
                />
              </ChatComposerBody>
              <ChatComposerFooter>
                <ChatComposerUtilityBar>
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger
                      aria-label="Add context"
                      size="icon-sm"
                      tooltip="Add context"
                    >
                      <Paperclip aria-hidden="true" className="size-4" />
                    </PromptInputActionMenuTrigger>
                    <PromptInputActionMenuContent align="start">
                      <PromptInputActionAddAttachments label="Add photos or files" />
                    </PromptInputActionMenuContent>
                  </PromptInputActionMenu>
                  <ChatComposerControl
                    label="Toggle approval mode"
                    onClick={() => setAutoApprove((current) => !current)}
                    tooltip="Approval mode"
                  >
                    {autoApprove ? "Auto approve" : "Ask to approve"}
                  </ChatComposerControl>
                  <span aria-hidden="true" className="h-4 w-px bg-border" />
                  <span className="hidden truncate sm:inline">cypheria · working tree</span>
                  <PromptInputSelect
                    value={model}
                    onValueChange={(value) => setModel(String(value))}
                  >
                    <PromptInputSelectTrigger
                      aria-label="Model"
                      className="h-7 w-auto border-0 px-2"
                    >
                      <PromptInputSelectValue />
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent>
                      <PromptInputSelectItem value="gpt-5.6">GPT-5.6</PromptInputSelectItem>
                      <PromptInputSelectItem value="gpt-6">GPT-6</PromptInputSelectItem>
                    </PromptInputSelectContent>
                  </PromptInputSelect>
                  <PromptInputSelect
                    value={reasoning}
                    onValueChange={(value) => setReasoning(String(value))}
                  >
                    <PromptInputSelectTrigger
                      aria-label="Reasoning effort"
                      className="h-7 w-auto border-0 px-2"
                    >
                      <PromptInputSelectValue />
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent>
                      <PromptInputSelectItem value="medium">Medium</PromptInputSelectItem>
                      <PromptInputSelectItem value="high">High</PromptInputSelectItem>
                      <PromptInputSelectItem value="xhigh">XHigh</PromptInputSelectItem>
                    </PromptInputSelectContent>
                  </PromptInputSelect>
                </ChatComposerUtilityBar>
                <ChatComposerControl
                  label="Hide composer"
                  size="icon-sm"
                  tooltip="Hide composer"
                  onClick={() => setComposerVisible(false)}
                >
                  <X aria-hidden="true" className="size-4" />
                </ChatComposerControl>
                <ChatComposerSubmit
                  disabled={!draft.trim() && !generating}
                  status={status}
                  stopLabel="Stop generating"
                  submitLabel="Send message"
                  onStop={stopGeneration}
                />
              </ChatComposerFooter>
            </PromptInput>
          </ChatComposerFrame>
        </ChatComposerDock>
        {!composerVisible ? (
          <div className="absolute inset-x-0 bottom-4 z-30 flex justify-center">
            <ChatComposerRevealControl
              label="Show composer"
              tooltip="Show composer"
              onClick={() => setComposerVisible(true)}
            />
          </div>
        ) : null}
      </ChatMainColumn>
    </ChatWorkspaceShell>
  )
}
