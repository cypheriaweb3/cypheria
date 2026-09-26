import type { ThreadTimelineItem, ThreadTimelineProjectedItem } from "@cypheria/protocol"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  ChatActivityItem,
  ChatActivityList,
  ChatActivitySummary,
  ChatActivitySummaryPart,
  ChatAgentCard,
  ChatApprovalCard,
  ChatApprovalRequest,
  ChatAssistantMessage,
  ChatCommandBlock,
  type ChatComposerAttachmentItem,
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
  ChatComposerPanel,
  ChatComposerRevealControl,
  type ChatComposerStatus,
  ChatComposerStatusMessage,
  ChatComposerSubmit,
  type ChatComposerSuggestion,
  ChatComposerTopTray,
  ChatComposerUtilityBar,
  ChatContextUsage,
  ChatDesktopNotificationPreview,
  ChatFileChange,
  ChatFileChanges,
  ChatFixedTurnSummary,
  ChatFixedTurnSummaryItem,
  ChatGeneratedImage,
  ChatGeneratedImageGrid,
  ChatHeader,
  ChatHeaderActions,
  ChatHeaderBreadcrumb,
  ChatHeaderStatus,
  ChatHeaderTitle,
  ChatMainColumn,
  ChatMcpElicitationRequest,
  ChatMcpFilePanel,
  ChatMcpThreadPanel,
  ChatMessageActions,
  ChatMessageContent,
  ChatModelSelector,
  ChatOptionPickerRequest,
  ChatPanel,
  ChatPanelContent,
  ChatPanelEmptyState,
  ChatPanelLauncher,
  ChatPanelList,
  ChatPanelListItem,
  type ChatPanelPlacement,
  ChatPanelSection,
  type ChatPanelTabDescriptor,
  ChatPanelToggle,
  type ChatPanelVisibility,
  ChatPendingCode,
  ChatPendingInteractionBody,
  ChatPendingInteractionFooter,
  ChatPendingOption,
  ChatPendingQuestion,
  ChatPendingTextInput,
  ChatPermissionRequest,
  ChatPinnedSummary,
  ChatPlanCard,
  ChatPlanImplementationRequest,
  ChatPlanPanel,
  ChatPlanStep,
  ChatPreviewHost,
  ChatPreviewPanel,
  ChatPreviewStatusBar,
  ChatPreviewToolbar,
  ChatPullRequestCard,
  ChatQueuedInputItem,
  ChatQueuedInputList,
  ChatReasoning,
  ChatReasoningContent,
  ChatReasoningTrigger,
  ChatResourceCard,
  ChatResourceGroup,
  ChatResponseSpacer,
  ChatReviewDiffHost,
  ChatReviewFileList,
  ChatReviewPanel,
  ChatReviewToolbar,
  ChatSandboxPanel,
  ChatScrollToLatest,
  ChatSecondaryTimelinePanel,
  ChatSetupStepRequest,
  ChatSideChatPanel,
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
  ChatThinkingPlaceholder,
  ChatThreadHandoff,
  ChatTimeline,
  ChatTimelineContent,
  ChatTimelineEvent,
  ChatTimelineItem,
  ChatTimelineState,
  ChatTimestampSeparator,
  ChatTodoItem,
  ChatTodoList,
  ChatTool,
  ChatToolCode,
  ChatToolContent,
  ChatToolSection,
  ChatToolTrigger,
  ChatTranscriptLine,
  ChatTurnActivity,
  ChatTurnGroup,
  ChatTurnMarker,
  ChatTurnNavigator,
  ChatTurnNotice,
  ChatUserInputCard,
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
  ArrowRotateCcwIcon,
  BranchIcon,
  CalendarIcon,
  CertificateIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CloseBoldIcon,
  CollapseIcon,
  CompareIcon,
  CopyIcon,
  CubeIcon,
  DockIcon,
  DocumentIcon,
  EditPencilIcon,
  ErrorIcon,
  ExpandIcon,
  FileCodeIcon,
  FileDocumentIcon,
  FileIcon,
  FileImageIcon,
  FolderOpenIcon,
  GlobeIcon,
  ImagesIcon,
  McpIcon,
  MoreCircleMenuDotsIcon,
  NotebookIcon,
  PinIcon,
  PlusComposerIcon,
  PullRequestOpenIcon,
  SearchIcon,
  SettingsSliderIcon,
  ShareChatIcon,
  SidebarRightIcon,
  SparklesIcon,
  StatusIcon,
  TerminalIcon,
  ToolsIcon,
  WebsiteNetworkIcon,
} from "@cypheria/ui/components/icons"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@cypheria/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Switch } from "@cypheria/ui/components/switch"
import { useVirtualizer } from "@tanstack/react-virtual"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"

import promptWallpaper from "../assets/plugins/prompt-wallpaper.webp"
import { splitCodexRenderGroups } from "../codex-render-groups.js"
import { DemoFilesPanel } from "./chat-demo-files.js"
import { HarnessIcon } from "./harness-icon.js"

type DemoPanelId =
  | "sources"
  | "subagents"
  | "plan"
  | "summary"
  | "goal"
  | "review"
  | "pull-request"
  | "terminal"
  | "file"
  | "files"
  | "image"
  | "browser"
  | "mcp"
  | "automation"
  | "artifact"
  | "pdf"
  | "document"
  | "notebook"
  | "presentation"
  | "workbook"
  | "entity"
  | "side-chat"
  | "mcp-thread"
  | "mcp-file"
  | "sandbox"
  | "timeline"

type DemoTimelineGroup =
  | "grouping"
  | "reasoning"
  | "planning"
  | "tools"
  | "approvals"
  | "agents"
  | "resources"
  | "system"
  | "errors"
  | "voice"

type DemoComposerExtra =
  | "fixed-summary"
  | "queue"
  | "goal"
  | "subagents"
  | "warning"
  | "status"
  | "notification"
  | "attachments"

type DemoPendingSurface =
  | "none"
  | "approval"
  | "permission"
  | "question"
  | "elicitation"
  | "computer-use"
  | "plan"
  | "options"
  | "setup"

type DemoMessage = {
  id: string
  role: "assistant" | "user"
  text: string
  showcase?: "audit" | "implementation" | "validation" | "catalog"
  attachments?: string[]
}

const showcaseMessages: DemoMessage[] = [
  {
    attachments: ["codex-conversation-ui-reference.md"],
    id: "user-audit",
    role: "user",
    text: "Audit the Codex conversation experience and map the title bar, conversation stream, composer, and panels into reusable Cypheria components.",
  },
  {
    id: "assistant-audit",
    role: "assistant",
    showcase: "audit",
    text: "The shell is now mapped around an aligned 48rem timeline and floating composer, with independently controlled right and bottom panels. Runtime data and persistence stay in the application layer.",
  },
  {
    id: "user-implementation",
    role: "user",
    text: "Implement the reusable layer and make the development demo exercise the states we will need in production.",
  },
  {
    id: "assistant-implementation",
    role: "assistant",
    showcase: "implementation",
    text: "The shared package now exposes controlled presentation primitives. The Desktop demo composes them with local state, so every interaction is inspectable without contacting an agent runtime.",
  },
  {
    id: "user-validation",
    role: "user",
    text: "Run the checks, show failures and recovery in the transcript, and summarize what is ready for production integration.",
  },
  {
    id: "assistant-validation",
    role: "assistant",
    showcase: "validation",
    text: "Validation is complete. The UI package, Desktop demo, and documentation checks pass; the remaining production work is protocol mapping and persisted panel state.",
  },
  {
    id: "user-catalog",
    role: "user",
    text: "Show the complete audited event catalog, including approvals, agent activity, resources, system transitions, errors, and voice.",
  },
  {
    id: "assistant-catalog",
    role: "assistant",
    showcase: "catalog",
    text: "Every bundle-confirmed conversation item now has a reusable visual representation. Use the floating display controller to focus the transcript on one family at a time.",
  },
]

const historyPrompts = [
  "Trace the scroll anchor after a streamed response changes height.",
  "Review the panel layout at compact, medium, and wide widths.",
  "Explain which conversation state belongs to Desktop rather than the UI package.",
  "Check keyboard navigation for message actions and panel tabs.",
  "Compare the composer spacing with the audited Codex reference.",
  "Summarize the latest source and terminal activity for this task.",
]

const historyResponses = [
  "The scroll controller retains a stable message key and viewport offset while measured row heights settle. New output follows only from the live edge.",
  "The main reading column remains bounded while panels consume independent space. At compact widths, secondary surfaces should hide before the transcript becomes unusable.",
  "Desktop owns timeline mapping, virtualization, persisted drafts, panel state, and transport. The shared package owns presentation and accessible interaction contracts.",
  "Tab order reaches the active transcript actions, composer controls, and selected panel tab without entering hidden or inert surfaces.",
  "The composer uses a quiet floating surface, two compact control levels, and the same outer measure as the timeline without dominating the transcript.",
  "Sources record workspace context, Review presents changed files, and Terminal exposes process lifecycle while the conversation remains the primary surface.",
]

const historicalMessages: DemoMessage[] = Array.from({ length: 60 }, (_, turnIndex) => {
  const prompt = historyPrompts[turnIndex % historyPrompts.length] ?? historyPrompts[0]
  const response = historyResponses[turnIndex % historyResponses.length] ?? historyResponses[0]
  return [
    {
      attachments: turnIndex % 12 === 0 ? [`conversation-snapshot-${turnIndex + 1}.md`] : undefined,
      id: `history-user-${turnIndex + 1}`,
      role: "user" as const,
      text: `${prompt} This is archived turn ${turnIndex + 1}.`,
    },
    {
      id: `history-assistant-${turnIndex + 1}`,
      role: "assistant" as const,
      text: `${response}\n\nRecorded as long-conversation sample ${turnIndex + 1} so variable-height rows can be measured rather than assumed.`,
    },
  ]
}).flat()

const initialMessages: DemoMessage[] = [...historicalMessages, ...showcaseMessages]

const demoProjectedItem = (
  item: ThreadTimelineItem,
  seq: number,
  turnId = "demo-render-group-turn"
): ThreadTimelineProjectedItem => ({
  collapsed: false,
  item,
  seqEnd: seq,
  seqStart: seq,
  sourceSeqRanges: [{ start: seq, end: seq }],
  timestamp: "2026-09-24T00:00:00.000Z",
  turnId,
})

const demoRenderRows = splitCodexRenderGroups(
  [
    demoProjectedItem(
      {
        boundary: "turn-user",
        itemId: "demo-user",
        operation: "replace",
        role: "user",
        text: "Compare the latest Codex turn grouping.",
        type: "message",
      },
      1
    ),
    demoProjectedItem(
      {
        boundary: null,
        itemId: "demo-commentary",
        operation: "replace",
        role: "assistant",
        text: "I’ll inspect the activity and then summarize the result.",
        type: "message",
        harnessData: {
          agentId: "codex",
          nativeType: "codex.item.agentMessage",
          payload: {
            lifecycle: "completed",
            item: { phase: "commentary", delivery: null, questions: null },
          },
        },
      },
      2
    ),
    demoProjectedItem(
      {
        command: "rg 'render group' analysis/",
        cwd: null,
        durationMs: 34,
        exitCode: 0,
        itemId: "demo-command-1",
        output: "3 matches",
        status: "completed",
        type: "command",
      },
      3
    ),
    demoProjectedItem(
      {
        error: null,
        input: { path: "split-items-into-render-groups.js" },
        itemId: "demo-tool",
        name: "read_file",
        output: "Source inspected",
        status: "completed",
        type: "tool",
      },
      4
    ),
    demoProjectedItem(
      {
        entries: [
          { status: "completed", text: "Group activity by turn" },
          { status: "in_progress", text: "Render the final answer separately" },
        ],
        itemId: "demo-plan",
        type: "plan",
      },
      5
    ),
    demoProjectedItem(
      {
        boundary: "assistant-final",
        itemId: "demo-final",
        operation: "replace",
        role: "assistant",
        text: "The final answer is separate from the process activity.",
        type: "message",
        harnessData: {
          agentId: "codex",
          nativeType: "codex.item.agentMessage",
          payload: {
            lifecycle: "completed",
            item: { phase: "final_answer", delivery: null, questions: null },
          },
        },
      },
      6
    ),
    demoProjectedItem(
      {
        command: "git status --short",
        cwd: null,
        durationMs: 12,
        exitCode: 0,
        itemId: "demo-late-command",
        output: "clean",
        status: "completed",
        type: "command",
      },
      7
    ),
    demoProjectedItem(
      {
        itemId: "demo-reroute",
        message: "Model rerouted to an available backend",
        status: "completed",
        type: "status",
        harnessData: { agentId: "codex", nativeType: "model/rerouted" },
      },
      8
    ),
    demoProjectedItem(
      {
        boundary: "turn-user",
        itemId: "demo-live-user",
        operation: "replace",
        role: "user",
        text: "Show the live commentary and tool group too.",
        type: "message",
      },
      9,
      "demo-live-turn"
    ),
    demoProjectedItem(
      {
        boundary: null,
        itemId: "demo-live-commentary",
        operation: "replace",
        role: "assistant",
        text: "I’m grouping the active tool calls now.",
        type: "message",
        harnessData: {
          agentId: "codex",
          nativeType: "codex.item.agentMessage",
          payload: {
            lifecycle: "started",
            item: { phase: "commentary", delivery: null, questions: null },
          },
        },
      },
      10,
      "demo-live-turn"
    ),
    demoProjectedItem(
      {
        command: "pnpm --filter @cypheria/ui test",
        cwd: null,
        durationMs: null,
        exitCode: null,
        itemId: "demo-live-command",
        output: "Tests running…",
        status: "running",
        type: "command",
      },
      11,
      "demo-live-turn"
    ),
  ],
  "demo-live-turn"
)

const initialPlacements: Record<DemoPanelId, ChatPanelPlacement | null> = {
  artifact: "right",
  automation: "bottom",
  browser: "bottom",
  document: "right",
  entity: "right",
  "side-chat": "right",
  "mcp-thread": "right",
  "mcp-file": "right",
  sandbox: "bottom",
  timeline: "bottom",
  file: "right",
  files: "right",
  goal: "right",
  image: "right",
  mcp: "bottom",
  notebook: "right",
  pdf: "right",
  plan: "right",
  presentation: "right",
  "pull-request": "right",
  review: "right",
  sources: "right",
  subagents: "right",
  summary: "bottom",
  terminal: "bottom",
  workbook: "right",
}

const panelTitles: Record<DemoPanelId, string> = {
  artifact: "Artifact",
  automation: "Automation",
  browser: "Browser",
  document: "Document",
  entity: "Entity",
  "side-chat": "Side chat",
  "mcp-thread": "MCP thread",
  "mcp-file": "MCP file",
  sandbox: "Sandbox",
  timeline: "Timeline",
  file: "File",
  files: "Files",
  goal: "Goal",
  image: "Image",
  mcp: "MCP App",
  notebook: "Notebook",
  pdf: "PDF",
  plan: "Plan",
  presentation: "Presentation",
  "pull-request": "Pull request",
  review: "Review",
  sources: "Sources",
  subagents: "Subagents",
  summary: "Summary",
  terminal: "Terminal",
  workbook: "Workbook",
}

const panelIcons: Record<DemoPanelId, React.ReactNode> = {
  artifact: <CubeIcon />,
  automation: <CalendarIcon />,
  browser: <WebsiteNetworkIcon />,
  document: <DocumentIcon />,
  entity: <AgentIcon />,
  "side-chat": <SparklesIcon />,
  "mcp-thread": <McpIcon />,
  "mcp-file": <FileCodeIcon />,
  sandbox: <TerminalIcon />,
  timeline: <StatusIcon />,
  file: <FileCodeIcon />,
  files: <FolderOpenIcon />,
  goal: <PinIcon />,
  image: <FileImageIcon />,
  mcp: <McpIcon />,
  notebook: <NotebookIcon />,
  pdf: <FileDocumentIcon />,
  plan: <CheckIcon />,
  presentation: <ImagesIcon />,
  "pull-request": <PullRequestOpenIcon />,
  review: <BranchIcon />,
  sources: <FileIcon />,
  subagents: <AgentIcon />,
  summary: <SparklesIcon />,
  terminal: <TerminalIcon />,
  workbook: <CompareIcon />,
}

const panelIds: DemoPanelId[] = [
  "files",
  "review",
  "sources",
  "plan",
  "subagents",
  "goal",
  "pull-request",
  "file",
  "image",
  "pdf",
  "document",
  "notebook",
  "artifact",
  "presentation",
  "workbook",
  "entity",
  "side-chat",
  "mcp-thread",
  "mcp-file",
  "terminal",
  "browser",
  "mcp",
  "automation",
  "summary",
  "sandbox",
  "timeline",
]

const timelineGroups: ReadonlyArray<{ id: DemoTimelineGroup; label: string }> = [
  { id: "grouping", label: "Turn render groups" },
  { id: "reasoning", label: "Reasoning & response" },
  { id: "planning", label: "Plans & todos" },
  { id: "tools", label: "Tools & execution" },
  { id: "approvals", label: "Approvals & prompts" },
  { id: "agents", label: "Agents & handoffs" },
  { id: "resources", label: "Resources & media" },
  { id: "system", label: "System transitions" },
  { id: "errors", label: "Errors & recovery" },
  { id: "voice", label: "Voice & steering" },
]

const composerExtras: ReadonlyArray<{ id: DemoComposerExtra; label: string }> = [
  { id: "fixed-summary", label: "Fixed turn summary" },
  { id: "queue", label: "Queued follow-ups" },
  { id: "goal", label: "Thread goal" },
  { id: "subagents", label: "Background agents" },
  { id: "warning", label: "Safety and usage banner" },
  { id: "status", label: "Live status message" },
  { id: "notification", label: "Desktop notification preview" },
  { id: "attachments", label: "Attachment tray samples" },
]

const pendingSurfaceOptions: ReadonlyArray<{ id: DemoPendingSurface; label: string }> = [
  { id: "none", label: "Normal composer" },
  { id: "approval", label: "Command approval" },
  { id: "permission", label: "Permission request" },
  { id: "question", label: "User input" },
  { id: "elicitation", label: "MCP elicitation" },
  { id: "computer-use", label: "Computer Use app approval" },
  { id: "plan", label: "Implement plan" },
  { id: "options", label: "Option picker" },
  { id: "setup", label: "Setup step" },
]

const initialTimelineGroups = new Set<DemoTimelineGroup>([
  "grouping",
  "reasoning",
  "planning",
  "tools",
  "approvals",
  "resources",
])

const initialEnabledPanels = new Set<DemoPanelId>([
  "files",
  "review",
  "sources",
  "plan",
  "terminal",
  "browser",
])

const initialComposerExtras = new Set<DemoComposerExtra>([
  "fixed-summary",
  "goal",
  "subagents",
  "status",
])

const assistantReply =
  "This local response demonstrates submitted, streaming, and completed states without contacting an agent runtime. New turns retain the same bottom anchoring and controlled panel contracts."

const demoSuggestions: ChatComposerSuggestion[] = [
  {
    id: "chat-demo",
    kind: "file",
    label: "chat-demo.tsx",
    target: "apps/desktop/renderer/src/components/chat-demo.tsx",
    description: "Workspace file",
    icon: <FileCodeIcon />,
  },
  {
    id: "ui-chat",
    kind: "file",
    label: "chat components",
    target: "packages/ui/src/components/chat",
    description: "Folder",
    icon: <FolderOpenIcon />,
  },
  {
    id: "agent-review",
    kind: "agent",
    label: "review agent",
    target: "agent://review",
    description: "Agent",
    icon: <AgentIcon />,
  },
  {
    id: "mcp-docs",
    kind: "resource",
    label: "MCP docs",
    target: "mcp://docs",
    description: "Resource",
    icon: <McpIcon />,
  },
  {
    id: "browser",
    kind: "browser-tab",
    label: "Current browser tab",
    target: "browser://current",
    description: "Browser tab",
    icon: <GlobeIcon />,
  },
  {
    id: "review",
    kind: "skill",
    label: "review",
    target: "skill://review",
    description: "Skill",
    icon: <SparklesIcon />,
  },
  {
    id: "figma",
    kind: "app",
    label: "Figma",
    target: "app://figma",
    description: "App",
    icon: <CubeIcon />,
  },
  {
    id: "computer-use",
    kind: "plugin",
    label: "computer-use",
    target: "plugin://computer-use",
    description: "Plugin",
    icon: <ToolsIcon />,
  },
  {
    id: "attach",
    kind: "command",
    label: "Attach files",
    description: "Open file picker",
    icon: <FileIcon />,
  },
  {
    id: "clear",
    kind: "command",
    label: "Clear draft",
    description: "Empty the editor",
    icon: <CloseBoldIcon />,
  },
]

const demoTraySamples: ChatComposerAttachmentItem[] = [
  {
    id: "sample-image",
    kind: "image",
    name: "layout-screenshot.png",
    detail: "Image",
    previewUrl: promptWallpaper,
  },
  {
    id: "sample-appshot",
    kind: "appshot",
    name: "Browser window",
    detail: "Appshot",
    previewUrl: promptWallpaper,
  },
  { id: "sample-file", kind: "file", name: "composer.tsx", detail: "Workspace file" },
  { id: "sample-paste", kind: "pasted-text", name: "Pasted text", detail: "5,420 characters" },
  { id: "sample-upload", kind: "file", name: "design-notes.pdf", status: "uploading" },
  { id: "sample-error", kind: "file", name: "failed-upload.zip", status: "error" },
]

export default function ChatDemo() {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState("")
  const [composerEpoch, setComposerEpoch] = useState(0)
  const [status, setStatus] = useState<ChatComposerStatus>("ready")
  const [pendingAttachments, setPendingAttachments] = useState<ChatComposerAttachmentItem[]>([])
  const [sampleAttachments, setSampleAttachments] = useState(demoTraySamples)
  const [attachmentOrder, setAttachmentOrder] = useState<string[]>([])
  const attachmentPreviewUrls = useRef<string[]>([])
  const composerFormRef = useRef<HTMLFormElement>(null)
  const [model, setModel] = useState("gpt-5.6")
  const [reasoning, setReasoning] = useState("high")
  const [demoAgent, setDemoAgent] = useState<"codex" | "claude" | "pi" | "opencode" | "acp">(
    "codex"
  )
  const [speed, setSpeed] = useState("standard")
  const [autoApprove, setAutoApprove] = useState(false)
  const [approvalDecision, setApprovalDecision] = useState<"pending" | "approved" | "rejected">(
    "pending"
  )
  const [retrySucceeded, setRetrySucceeded] = useState(false)
  const [composerVisible, setComposerVisible] = useState(true)
  const [summaryVisible, setSummaryVisible] = useState(false)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [rightVisibility, setRightVisibility] = useState<ChatPanelVisibility>("visible")
  const [bottomVisibility, setBottomVisibility] = useState<ChatPanelVisibility>("visible")
  const [rightFullscreen, setRightFullscreen] = useState(false)
  const [wideViewport, setWideViewport] = useState(true)
  const rightPanelSize = useRef(420)
  const bottomPanelSize = useRef(280)
  const [placements, setPlacements] = useState(initialPlacements)
  const [enabledPanels, setEnabledPanels] = useState(initialEnabledPanels)
  const [visibleTimelineGroups, setVisibleTimelineGroups] = useState(initialTimelineGroups)
  const [visibleComposerExtras, setVisibleComposerExtras] = useState(initialComposerExtras)
  const [pendingSurface, setPendingSurface] = useState<DemoPendingSurface>("none")
  const [pendingOption, setPendingOption] = useState("changed-files")
  const [rightActive, setRightActive] = useState<DemoPanelId>("files")
  const [bottomActive, setBottomActive] = useState<DemoPanelId>("terminal")
  const [selectedReviewFile, setSelectedReviewFile] = useState("chat-demo.tsx")
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const timersRef = useRef<number[]>([])
  const timelineMountedRef = useRef(false)

  useEffect(
    () => () => {
      for (const url of attachmentPreviewUrls.current) URL.revokeObjectURL(url)
    },
    []
  )

  const previewForFile = (file: File) => {
    if (!file.type.startsWith("image/")) return undefined
    const url = URL.createObjectURL(file)
    attachmentPreviewUrls.current.push(url)
    return url
  }

  const releasePreview = useCallback((item: ChatComposerAttachmentItem) => {
    if (!item.previewUrl?.startsWith("blob:")) return
    URL.revokeObjectURL(item.previewUrl)
    attachmentPreviewUrls.current = attachmentPreviewUrls.current.filter(
      (url) => url !== item.previewUrl
    )
  }, [])

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer)
    timersRef.current = []
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1181px)")
    if (!media) return
    const update = () => setWideViewport(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  const getMessageKey = useCallback(
    (index: number) => messages[index]?.id ?? `missing-demo-message-${index}`,
    [messages]
  )
  const estimateMessageSize = useCallback(
    (index: number) => {
      const message = messages[index]
      if (message?.showcase === "implementation") return 720
      if (message?.showcase === "validation") return 620
      if (message?.showcase === "audit") return 520
      if (message?.showcase === "catalog") return 1760
      return message?.role === "user" ? 112 : 176
    },
    [messages]
  )
  const virtualizer = useVirtualizer({
    anchorTo: "end",
    count: messages.length,
    estimateSize: estimateMessageSize,
    followOnAppend: "auto",
    getItemKey: getMessageKey,
    getScrollElement: () => timelineRef.current,
    initialOffset: Number.MAX_SAFE_INTEGER,
    initialRect: { height: 760, width: 640 },
    overscan: 6,
    paddingStart: 44,
    scrollEndThreshold: 32,
    useAnimationFrameWithResizeObserver: true,
  })
  const scrollToMessage = useCallback(
    (index: number) => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
      virtualizer.scrollToIndex(index, { align: "center", behavior: "auto" })
    },
    [virtualizer]
  )
  const navigatorTargets = useMemo(() => {
    const userTurns = messages.flatMap((message, index) =>
      message.role === "user" ? [{ id: message.id, index }] : []
    )
    const targetCount = Math.min(18, userTurns.length)
    if (targetCount === userTurns.length) return userTurns
    return Array.from({ length: targetCount }, (_, markerIndex) => {
      const position = Math.round((markerIndex * (userTurns.length - 1)) / (targetCount - 1))
      return userTurns[position]
    }).filter((target): target is { id: string; index: number } => target !== undefined)
  }, [messages])

  const scrollToLatest = useCallback(() => {
    if (!messages.length) return
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
    virtualizer.scrollToIndex(messages.length - 1, { align: "end" })

    let settleAttempts = 0
    let stableFrames = 0
    let previousHeight = -1
    const settleAtBottom = () => {
      const timeline = timelineRef.current
      if (!timeline) return
      const scrollHeight = timeline.scrollHeight
      timeline.scrollTo({
        behavior: "auto",
        top: scrollHeight,
      })
      stableFrames = Math.abs(scrollHeight - previousHeight) < 1 ? stableFrames + 1 : 0
      previousHeight = scrollHeight
      settleAttempts += 1
      if (settleAttempts < 48 && stableFrames < 3) {
        scrollFrameRef.current = window.requestAnimationFrame(settleAtBottom)
      } else {
        scrollFrameRef.current = null
        setShowScrollToLatest(false)
      }
    }
    scrollFrameRef.current = window.requestAnimationFrame(settleAtBottom)
  }, [messages.length, virtualizer])

  // biome-ignore lint/correctness/useExhaustiveDependencies: turn and stream changes intentionally trigger bottom anchoring
  useEffect(() => {
    if (!timelineMountedRef.current) {
      timelineMountedRef.current = true
      return
    }
    scrollToLatest()
  }, [messages, status])

  const stopGeneration = useCallback(() => {
    clearTimers()
    setStatus("ready")
  }, [clearTimers])

  const submitMessage = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = draft.trim()
      if (!trimmed || status === "submitted" || status === "streaming") return
      clearTimers()
      pendingAttachments.forEach(releasePreview)
      setDraft("")
      setComposerEpoch((current) => current + 1)
      setPendingAttachments([])
      setMessages((current) => [
        ...current,
        {
          attachments: pendingAttachments.length
            ? pendingAttachments.map((item) => item.name)
            : undefined,
          id: `user-${Date.now()}`,
          role: "user",
          text: trimmed,
        },
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
    [clearTimers, draft, pendingAttachments, releasePreview, status]
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
      goal: (
        <ChatPanelContent>
          <ChatPanelSection>
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <PinIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Align the Cypheria conversation experience</div>
                <div className="text-xs text-muted-foreground">Updated just now</div>
              </div>
              <Badge variant="secondary">72%</Badge>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[72%] rounded-full bg-foreground/65" />
            </div>
          </ChatPanelSection>
          <ChatPanelSection>
            <div className="text-xs font-medium text-muted-foreground">Success criteria</div>
            <ChatPanelList>
              <ChatPanelListItem className="flex items-center gap-2">
                <CheckCircleIcon className="size-4 text-emerald-600" />
                Reusable panel hosts cover every audited content type
              </ChatPanelListItem>
              <ChatPanelListItem className="flex items-center gap-2">
                <StatusIcon className="size-4 text-amber-600" />
                Visual comparison remains in progress
              </ChatPanelListItem>
            </ChatPanelList>
          </ChatPanelSection>
        </ChatPanelContent>
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
      "pull-request": (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <PullRequestOpenIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">cypheria #482</span>
              <Badge variant="secondary">Open</Badge>
            </ChatPreviewToolbar>
          }
          statusBar={
            <ChatPreviewStatusBar>
              <CheckCircleIcon className="size-3.5 text-emerald-600" />3 checks passed
              <span className="ml-auto">Ready for review</span>
            </ChatPreviewStatusBar>
          }
        >
          <ChatPullRequestCard
            branch="main ← codex/chat-experience"
            status="Draft"
            title="Align conversation panels and resizing"
          >
            Adds reusable preview hosts, draggable panel splits, and a comprehensive local showcase.
          </ChatPullRequestCard>
          <ChatPanelContent className="h-auto">
            <ChatPanelSection>
              <div className="text-xs font-medium text-muted-foreground">Reviewers</div>
              <div className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <AgentIcon className="size-4" /> UI systems
                <Badge className="ml-auto" variant="outline">
                  Requested
                </Badge>
              </div>
            </ChatPanelSection>
            <ChatPanelSection>
              <div className="text-xs font-medium text-muted-foreground">Conversation</div>
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">Keep the panel registry application-owned</div>
                <p className="mt-1 text-muted-foreground">
                  Resolved after moving persistence callbacks out of the shared package.
                </p>
              </div>
            </ChatPanelSection>
          </ChatPanelContent>
        </ChatPreviewPanel>
      ),
      files: <DemoFilesPanel />,
      file: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <FileCodeIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">shell.tsx</span>
              <Badge variant="outline">TSX</Badge>
            </ChatPreviewToolbar>
          }
          statusBar={
            <ChatPreviewStatusBar>
              <span>UTF-8</span>
              <span>TypeScript React</span>
              <span className="ml-auto">Ln 47, Col 9</span>
            </ChatPreviewStatusBar>
          }
        >
          <ChatPreviewHost kind="text-file" className="font-mono text-xs leading-6">
            <pre className="whitespace-pre-wrap">{`export function ChatWorkspaceShell({\n  rightPanel,\n  bottomPanel,\n  onRightPanelResize,\n}: ChatWorkspaceShellProps) {\n  return (\n    <ChatPanelLayout orientation="vertical">\n      <ResizablePanel id="chat-workspace" />\n    </ChatPanelLayout>\n  )\n}`}</pre>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      image: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <FileImageIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">prompt-wallpaper.webp</span>
              <Badge variant="outline">1536 × 1024</Badge>
            </ChatPreviewToolbar>
          }
          statusBar={
            <ChatPreviewStatusBar>
              <span>WebP image</span>
              <span className="ml-auto">Fit to panel</span>
            </ChatPreviewStatusBar>
          }
        >
          <ChatPreviewHost kind="image" className="flex min-h-full items-center justify-center p-5">
            <img
              alt="Cypheria prompt wallpaper preview"
              className="max-h-full max-w-full rounded-lg border object-contain shadow-sm"
              src={promptWallpaper}
            />
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      browser: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar className="gap-2">
              <WebsiteNetworkIcon className="size-4" />
              <div className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-muted-foreground">
                docs.cypheria.local/chat/reference
              </div>
              <StatusIcon className="size-4 text-emerald-600" />
            </ChatPreviewToolbar>
          }
          statusBar={
            <ChatPreviewStatusBar>
              <StatusIcon className="size-3.5 text-emerald-600" /> Live browser session
              <span className="ml-auto">Click preview to interact</span>
            </ChatPreviewStatusBar>
          }
        >
          <ChatPreviewHost kind="browser" className="p-4">
            <article className="mx-auto max-w-lg rounded-xl border bg-background p-5 shadow-sm">
              <div className="text-xs font-medium text-muted-foreground">
                CYPHERIA DOCUMENTATION
              </div>
              <h2 className="mt-2 text-xl font-semibold">Conversation experience reference</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                A reusable shell keeps the timeline primary while review, sources, browser, and
                terminal surfaces stay independently resizable.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-muted p-3">20 panel tabs</div>
                <div className="rounded-lg bg-muted p-3">126 virtual messages</div>
              </div>
            </article>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      mcp: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <McpIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">Design system MCP App</span>
              <Badge variant="secondary">Connected</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPreviewHost kind="mcp-app" className="space-y-3">
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <CubeIcon className="size-4" />
                </span>
                <div>
                  <div className="font-medium">Component inspector</div>
                  <div className="text-xs text-muted-foreground">
                    Rendered by an isolated app host
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button size="sm" type="button" variant="secondary">
                  Inspect slots
                </Button>
                <Button size="sm" type="button" variant="outline">
                  Export tokens
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 text-xs">
              This app can read the current conversation selection after approval.
            </div>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      automation: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <CalendarIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">Conversation UI watch</span>
              <Badge variant="secondary">Active</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPanelContent>
            <ChatPanelSection>
              <div className="text-xs font-medium text-muted-foreground">Schedule</div>
              <div className="rounded-xl border p-3">
                <div className="font-medium">Every weekday at 09:30</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Asia/Shanghai · next run tomorrow
                </div>
              </div>
            </ChatPanelSection>
            <ChatPanelSection>
              <div className="text-xs font-medium text-muted-foreground">Recent runs</div>
              <ChatPanelList>
                <ChatPanelListItem className="flex items-center gap-2">
                  <CheckCircleIcon className="size-4 text-emerald-600" /> Today, 09:30
                  <span className="ml-auto text-xs text-muted-foreground">42s</span>
                </ChatPanelListItem>
                <ChatPanelListItem className="flex items-center gap-2">
                  <CheckCircleIcon className="size-4 text-emerald-600" /> Yesterday, 09:30
                  <span className="ml-auto text-xs text-muted-foreground">38s</span>
                </ChatPanelListItem>
              </ChatPanelList>
            </ChatPanelSection>
          </ChatPanelContent>
        </ChatPreviewPanel>
      ),
      artifact: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <CubeIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">
                Conversation shell specification
              </span>
              <Button size="xs" type="button" variant="ghost">
                Comments · 2
              </Button>
            </ChatPreviewToolbar>
          }
        >
          <ChatPreviewHost kind="artifact" className="p-4">
            <article className="mx-auto max-w-xl space-y-4 rounded-xl border bg-background p-5 shadow-sm">
              <div>
                <div className="text-xs text-muted-foreground">ARTIFACT · UPDATED JUST NOW</div>
                <h2 className="mt-1 text-lg font-semibold">Panel host contract</h2>
              </div>
              <p className="text-sm leading-6">
                Preview hosts provide toolbar, scroll surface, and status regions while the owning
                application supplies document engines, browser sessions, and persistence.
              </p>
              <div className="rounded-lg border-l-2 border-foreground/50 bg-muted/60 p-3 text-sm">
                <span className="font-medium">Comment:</span> Keep annotations anchored to semantic
                content rather than viewport coordinates.
              </div>
            </article>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      pdf: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <FileDocumentIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">conversation-audit.pdf</span>
              <Badge variant="outline">3 / 12</Badge>
              <Button size="xs" type="button" variant="ghost">
                Annotate
              </Button>
            </ChatPreviewToolbar>
          }
          statusBar={<ChatPreviewStatusBar>100% · Read only</ChatPreviewStatusBar>}
        >
          <ChatPreviewHost kind="pdf" className="flex justify-center p-5">
            <article className="min-h-[520px] w-full max-w-md border bg-white p-8 text-zinc-900 shadow-md">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">UI audit</div>
              <h2 className="mt-4 text-2xl font-semibold">Conversation panels</h2>
              <p className="mt-5 text-sm leading-7 text-zinc-700">
                The right panel uses a tab registry shared with the bottom panel. Every tab retains
                identity when moved, hidden, restored, or resized.
              </p>
              <div className="mt-6 rounded border border-amber-400 bg-amber-50 p-3 text-xs">
                Annotation 1 · Verify the 50% maximum size at compact widths.
              </div>
            </article>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      document: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <DocumentIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">implementation-notes.docx</span>
              <Badge variant="outline">Redlines on</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPreviewHost kind="document" className="flex justify-center p-5">
            <article className="min-h-[520px] w-full max-w-xl border bg-background p-7 shadow-sm">
              <h2 className="text-xl font-semibold">Implementation notes</h2>
              <p className="mt-4 text-sm leading-7">
                The conversation and composer now share a{" "}
                <mark className="bg-emerald-500/15">48rem width token</mark>. The timeline uses{" "}
                <del className="text-destructive">tight turn spacing</del>{" "}
                <ins className="text-emerald-700 no-underline">a calmer eight-unit rhythm</ins>.
              </p>
              <div className="mt-8 rounded-lg border p-3 text-xs text-muted-foreground">
                Document annotation 2 · Confirm long translated titles do not displace actions.
              </div>
            </article>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      notebook: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <NotebookIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">panel-metrics.ipynb</span>
              <Badge variant="secondary">3 cells</Badge>
              <Button disabled size="xs" type="button" variant="ghost">
                Run all
              </Button>
            </ChatPreviewToolbar>
          }
          statusBar={<ChatPreviewStatusBar>Python · Read only preview</ChatPreviewStatusBar>}
        >
          <ChatPreviewHost kind="notebook" className="space-y-3">
            <div className="rounded-lg border bg-background p-3 text-sm">
              <div className="mb-2 text-xs text-muted-foreground">Markdown cell 1</div>
              Compare panel widths at the audited breakpoints.
            </div>
            <div className="rounded-lg border bg-background p-3 font-mono text-xs">
              <div className="mb-2 font-sans text-muted-foreground">Code cell 2 · [1]</div>
              widths = [640, 1024, 1728]
              <br />
              [min(520, width * 0.5) for width in widths]
            </div>
            <div className="rounded-lg border bg-background p-3 font-mono text-xs">
              <div className="mb-2 font-sans text-muted-foreground">Notebook output 1</div>
              [320, 512, 520]
            </div>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      presentation: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <ImagesIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">chat-experience.pptx</span>
              <Badge variant="outline">Slide 4 / 8</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPreviewHost kind="presentation" className="flex items-center justify-center p-5">
            <div className="aspect-video w-full max-w-2xl overflow-hidden rounded-lg border bg-zinc-950 p-7 text-zinc-50 shadow-md">
              <div className="text-xs text-zinc-400">CYPHERIA · CONVERSATION SYSTEM</div>
              <h2 className="mt-3 text-2xl font-semibold">One registry, two placements</h2>
              <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
                <div className="rounded-lg bg-zinc-800 p-4">Right panel</div>
                <CompareIcon className="size-5 text-zinc-500" />
                <div className="rounded-lg bg-zinc-800 p-4">Bottom panel</div>
              </div>
              <div className="mt-6 text-xs text-zinc-400">
                Move · hide · close · restore · resize
              </div>
            </div>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      workbook: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <CompareIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">panel-inventory.xlsx</span>
              <Badge variant="outline">Panel types</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPreviewHost kind="workbook" className="p-3">
            <div className="overflow-hidden rounded-lg border bg-background text-xs">
              <div className="grid grid-cols-[2rem_1.1fr_1fr_0.7fr] bg-muted font-medium">
                <span className="border-r p-2" />
                <span className="border-r p-2">Type</span>
                <span className="border-r p-2">Host</span>
                <span className="p-2">State</span>
              </div>
              {[
                ["1", "Browser", "Web session", "Live"],
                ["2", "Notebook", "Preview", "Read only"],
                ["3", "Terminal", "xterm", "Exited"],
                ["4", "Review", "Diff", "3 files"],
              ].map((row) => (
                <div className="grid grid-cols-[2rem_1.1fr_1fr_0.7fr] border-t" key={row[0]}>
                  {row.map((cell) => (
                    <span className="border-r p-2 last:border-r-0" key={cell}>
                      {cell}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </ChatPreviewHost>
        </ChatPreviewPanel>
      ),
      entity: (
        <ChatPreviewPanel
          toolbar={
            <ChatPreviewToolbar>
              <AgentIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">Chat UI component library</span>
              <Badge variant="secondary">Entity</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPanelContent>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                  <CubeIcon className="size-5" />
                </span>
                <div>
                  <div className="font-medium">@cypheria/ui/components/chat</div>
                  <div className="text-xs text-muted-foreground">Shared presentation package</div>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Exports</dt>
                <dd>Shell, timeline, composer, panel hosts</dd>
                <dt className="text-muted-foreground">Dependencies</dt>
                <dd>React, Base UI, resizable panels</dd>
                <dt className="text-muted-foreground">Runtime</dt>
                <dd>Application-owned</dd>
              </dl>
            </div>
          </ChatPanelContent>
        </ChatPreviewPanel>
      ),
      "side-chat": (
        <ChatSideChatPanel
          toolbar={
            <ChatPreviewToolbar>
              <SparklesIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">Ask about this task</span>
              <Badge variant="outline">Side chat</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPanelContent>
            <ChatUserMessage className="max-w-[90%]">
              Why was the panel registry kept controlled?
            </ChatUserMessage>
            <ChatAssistantMessage className="text-sm leading-6">
              Placement and persistence belong to Desktop, while the UI package only exposes state
              and callbacks. That keeps the same host reusable across runtimes.
            </ChatAssistantMessage>
          </ChatPanelContent>
        </ChatSideChatPanel>
      ),
      "mcp-thread": (
        <ChatMcpThreadPanel
          toolbar={
            <ChatPreviewToolbar>
              <McpIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">MCP thread extension</span>
              <Badge variant="secondary">Connected</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPanelContent>
            <ChatPanelSection>
              <div className="text-xs font-medium text-muted-foreground">Thread context</div>
              <div className="rounded-xl border p-3 text-sm">
                Extension-scoped controls receive the current thread only after an explicit host
                capability grant.
              </div>
            </ChatPanelSection>
          </ChatPanelContent>
        </ChatMcpThreadPanel>
      ),
      "mcp-file": (
        <ChatMcpFilePanel
          toolbar={
            <ChatPreviewToolbar>
              <FileCodeIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">MCP file extension</span>
              <Badge variant="outline">shell.tsx</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPreviewHost kind="mcp-extension-file" className="font-mono text-xs leading-6">
            <pre>{`selection: lines 47–82\ncapabilities: read_selection, propose_patch\nstatus: ready`}</pre>
          </ChatPreviewHost>
        </ChatMcpFilePanel>
      ),
      sandbox: (
        <ChatSandboxPanel
          toolbar={
            <ChatPreviewToolbar>
              <TerminalIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">Ephemeral sandbox</span>
              <Badge variant="secondary">Running</Badge>
            </ChatPreviewToolbar>
          }
          statusBar={<ChatPreviewStatusBar>Isolated · expires in 28 min</ChatPreviewStatusBar>}
        >
          <ChatPreviewHost kind="sandbox" className="space-y-2 font-mono text-xs">
            <div className="rounded-lg border bg-background p-3">/workspace/cypheria</div>
            <div className="rounded-lg border bg-zinc-950 p-3 text-zinc-200">
              $ pnpm test
              <br />✓ sandbox verification passed
            </div>
          </ChatPreviewHost>
        </ChatSandboxPanel>
      ),
      timeline: (
        <ChatSecondaryTimelinePanel
          toolbar={
            <ChatPreviewToolbar>
              <StatusIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate font-medium">Task activity</span>
              <Badge variant="outline">Live</Badge>
            </ChatPreviewToolbar>
          }
        >
          <ChatPanelContent>
            <ChatTimestampSeparator>Just now</ChatTimestampSeparator>
            <ChatTimelineEvent type="worktree-init" title="Worktree initialized" metadata="main" />
            <ChatTimelineEvent
              type="exec"
              title="Checks completed"
              metadata="Exited 0"
              tone="success"
            />
            <ChatTimelineEvent
              type="external-event"
              title="Review requested"
              metadata="UI systems"
            />
          </ChatPanelContent>
        </ChatSecondaryTimelinePanel>
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
            <pre>{`$ pnpm --filter @cypheria/ui test\n✓ 69 tests passed\n\n$ pnpm --filter @cypheria/desktop typecheck\n✓ completed`}</pre>
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
        .filter((id) => enabledPanels.has(id) && placements[id] === placement)
        .map((id) => ({
          closable: true,
          content: panelContent[id],
          icon: panelIcons[id],
          id,
          movable: true,
          title: panelTitles[id],
        })),
    [enabledPanels, panelContent, placements]
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
      .filter((id) => enabledPanels.has(id) && placements[id] !== placement)
      .map((id) => ({
        description: placements[id] ? `Move from ${placements[id]}` : "Open panel",
        icon: panelIcons[id],
        id,
        label: panelTitles[id],
      }))

  const placePanel = (id: string, placement: ChatPanelPlacement) => {
    const panelId = id as DemoPanelId
    setEnabledPanels((current) => new Set(current).add(panelId))
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
    if (!panelIds.some((id) => enabledPanels.has(id) && placements[id] === placement)) {
      placePanel(placement === "right" ? "sources" : "terminal", placement)
    }
    if (placement === "right") setRightVisibility("visible")
    else setBottomVisibility("visible")
  }

  const togglePanel = (placement: ChatPanelPlacement) => {
    const visibility = placement === "right" ? rightVisibility : bottomVisibility
    if (visibility === "visible") {
      if (placement === "right") {
        setRightFullscreen(false)
        setRightVisibility("hidden")
      } else setBottomVisibility("hidden")
      return
    }
    showPanel(placement)
  }

  const panelLauncher = (placement: ChatPanelPlacement) => (
    <ChatPanelLauncher
      items={launchItems(placement)}
      label={placement === "right" ? "Open side panel tab" : "Open bottom panel tab"}
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
        actions={
          isRight ? (
            <ChatPanelToggle
              label={rightFullscreen ? "Exit full screen" : "Enter full screen"}
              panel="right"
              pressed={rightFullscreen}
              tooltip={rightFullscreen ? "Exit full screen" : "Enter full screen"}
              onClick={() => setRightFullscreen((current) => !current)}
            >
              {rightFullscreen ? <CollapseIcon /> : <ExpandIcon />}
            </ChatPanelToggle>
          ) : undefined
        }
        closeTabLabel={(tab) => `Close ${String(tab.title)}`}
        emptyState={
          <ChatPanelEmptyState>
            <span>No open panels</span>
          </ChatPanelEmptyState>
        }
        hideLabel={isRight ? undefined : "Close bottom panel"}
        launcher={panelLauncher(placement)}
        placement={placement}
        tabs={tabs}
        tabsLabel={`${placement} panel tabs`}
        visibility={visibility}
        workspaceHeader={isRight}
        onActiveTabChange={(id) =>
          isRight ? setRightActive(id as DemoPanelId) : setBottomActive(id as DemoPanelId)
        }
        onCloseTab={closePanel}
        onVisibilityChange={isRight ? undefined : setBottomVisibility}
      />
    )
  }

  const toggleTimelineGroup = (group: DemoTimelineGroup, checked: boolean) => {
    setVisibleTimelineGroups((current) => {
      const next = new Set(current)
      if (checked) next.add(group)
      else next.delete(group)
      return next
    })
  }

  const toggleDemoPanel = (panelId: DemoPanelId, checked: boolean) => {
    setEnabledPanels((current) => {
      const next = new Set(current)
      if (checked) next.add(panelId)
      else next.delete(panelId)
      return next
    })
  }

  const toggleComposerExtra = (extra: DemoComposerExtra, checked: boolean) => {
    setVisibleComposerExtras((current) => {
      const next = new Set(current)
      if (checked) next.add(extra)
      else next.delete(extra)
      return next
    })
  }

  const displayController = (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label="Choose visible demo elements"
            className="rounded-full shadow-sm"
            size="icon"
            type="button"
            variant="secondary"
          >
            <SettingsSliderIcon className="size-4" />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="max-h-[min(70vh,42rem)] w-80 gap-0 overflow-hidden p-0"
      >
        <PopoverHeader className="border-b px-3 py-2.5">
          <PopoverTitle>Demo display</PopoverTitle>
          <PopoverDescription>Choose which audited UI families are rendered.</PopoverDescription>
        </PopoverHeader>
        <div className="flex items-center gap-1 border-b px-2 py-2">
          <Button
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => {
              setVisibleTimelineGroups(new Set(timelineGroups.map(({ id }) => id)))
              setEnabledPanels(new Set(panelIds))
              setVisibleComposerExtras(new Set(composerExtras.map(({ id }) => id)))
            }}
          >
            Show all
          </Button>
          <Button
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => {
              setVisibleTimelineGroups(new Set(initialTimelineGroups))
              setEnabledPanels(new Set(initialEnabledPanels))
              setVisibleComposerExtras(new Set(initialComposerExtras))
              setPendingSurface("none")
            }}
          >
            Curated
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {visibleTimelineGroups.size +
              enabledPanels.size +
              visibleComposerExtras.size +
              (pendingSurface === "none" ? 0 : 1)}{" "}
            visible
          </span>
        </div>
        <div className="min-h-0 overflow-y-auto p-2">
          <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Timeline families
          </div>
          <div className="space-y-0.5">
            {timelineGroups.map((group) => (
              <div
                className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
                key={group.id}
              >
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <Switch
                  aria-label={`Show ${group.label}`}
                  checked={visibleTimelineGroups.has(group.id)}
                  size="sm"
                  onCheckedChange={(checked) => toggleTimelineGroup(group.id, checked)}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Composer surface
          </div>
          <Select
            value={pendingSurface}
            onValueChange={(value) => setPendingSurface(value as DemoPendingSurface)}
          >
            <SelectTrigger aria-label="Choose composer surface" className="h-8 w-full text-xs">
              <SelectValue>
                {pendingSurfaceOptions.find(({ id }) => id === pendingSurface)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {pendingSurfaceOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-3 px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Composer-adjacent UI
          </div>
          <div className="space-y-0.5">
            {composerExtras.map((extra) => (
              <div
                className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
                key={extra.id}
              >
                <span className="min-w-0 flex-1 truncate">{extra.label}</span>
                <Switch
                  aria-label={`Show ${extra.label}`}
                  checked={visibleComposerExtras.has(extra.id)}
                  size="sm"
                  onCheckedChange={(checked) => toggleComposerExtra(extra.id, checked)}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Panel tabs
          </div>
          <div className="grid grid-cols-2 gap-0.5">
            {panelIds.map((panelId) => (
              <div
                className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
                key={panelId}
              >
                <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">
                  {panelIcons[panelId]}
                </span>
                <span className="min-w-0 flex-1 truncate">{panelTitles[panelId]}</span>
                <Switch
                  aria-label={`Show ${panelTitles[panelId]} panel`}
                  checked={enabledPanels.has(panelId)}
                  size="sm"
                  onCheckedChange={(checked) => toggleDemoPanel(panelId, checked)}
                />
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )

  const generating = status === "submitted" || status === "streaming"
  const demoUsage = {
    acp: { max: 128_000, source: "Agent reported", used: 46_200 },
    claude: { max: 200_000, source: "Live query", used: 121_400 },
    codex: { max: 272_000, source: "Agent reported", used: 84_300 },
    opencode: { max: 200_000, source: "Derived", used: 73_800 },
    pi: { max: 128_000, source: "Estimated", used: 51_100 },
  }[demoAgent]
  const demoAgentLabel =
    demoAgent === "opencode"
      ? "OpenCode"
      : demoAgent === "acp"
        ? "ACP agent"
        : demoAgent.charAt(0).toUpperCase() + demoAgent.slice(1)
  const demoTokenBreakdown = {
    cacheRead: 18_200,
    cacheWrite: 1_200,
    input: 46_400,
    output: 12_700,
    reasoning: 5_800,
    total: demoUsage.used,
  }

  const renderPendingComposer = () => {
    if (pendingSurface === "approval") {
      return (
        <ChatApprovalRequest
          badge="Waiting"
          description="The active turn is paused until this command is reviewed."
          title="Run command?"
        >
          <ChatPendingInteractionBody>
            <ChatPendingCode>pnpm --filter @cypheria/ui test</ChatPendingCode>
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button
              onClick={() => setPendingSurface("none")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Deny
            </Button>
            <Button
              onClick={() => setPendingSurface("none")}
              size="sm"
              type="button"
              variant="secondary"
            >
              Allow once
            </Button>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Allow for session
            </Button>
          </ChatPendingInteractionFooter>
        </ChatApprovalRequest>
      )
    }

    if (pendingSurface === "permission") {
      return (
        <ChatPermissionRequest
          badge="Permission"
          description="This request is broader than the current workspace policy."
          title="Allow filesystem access?"
        >
          <ChatPendingInteractionBody>
            <ChatPendingQuestion
              description="The agent wants to read a reference implementation outside the workspace."
              legend="Requested scope"
            >
              <ChatPendingOption label="Read one folder" selected />
              <ChatPendingOption label="Allow for this session" />
            </ChatPendingQuestion>
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button
              onClick={() => setPendingSurface("none")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Decline
            </Button>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Continue
            </Button>
          </ChatPendingInteractionFooter>
        </ChatPermissionRequest>
      )
    }

    if (pendingSurface === "question") {
      return (
        <ChatUserInputRequest
          badge="1 question"
          description="Answering resumes the current turn immediately."
          title="Choose a review scope"
        >
          <ChatPendingInteractionBody>
            <ChatPendingQuestion legend="What should the review include?">
              <ChatPendingOption
                description="Focus on files changed in the current task."
                label="Changed files"
                selected={pendingOption === "changed-files"}
                onClick={() => setPendingOption("changed-files")}
              />
              <ChatPendingOption
                description="Include surrounding code and public contracts."
                label="Entire workspace"
                selected={pendingOption === "workspace"}
                onClick={() => setPendingOption("workspace")}
              />
            </ChatPendingQuestion>
            <ChatPendingTextInput aria-label="Other review scope" placeholder="Something else…" />
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Submit answer
            </Button>
          </ChatPendingInteractionFooter>
        </ChatUserInputRequest>
      )
    }

    if (pendingSurface === "elicitation") {
      return (
        <ChatMcpElicitationRequest
          badge="MCP server"
          description="The design source needs one value before the tool call can continue."
          title="Select an export format"
        >
          <ChatPendingInteractionBody>
            <ChatPendingQuestion legend="Format">
              <ChatPendingOption label="React components" selected />
              <ChatPendingOption label="Design tokens" />
              <ChatPendingOption label="Static assets" />
            </ChatPendingQuestion>
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button
              onClick={() => setPendingSurface("none")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Continue
            </Button>
          </ChatPendingInteractionFooter>
        </ChatMcpElicitationRequest>
      )
    }

    if (pendingSurface === "computer-use") {
      return (
        <ChatMcpElicitationRequest
          badge="Elevated risk"
          description="Computer Use requests access to a local app and may capture screenshots while working."
          title="Allow Computer Use to access this app?"
        >
          <ChatPendingInteractionBody>
            <ChatComposerBanner
              title="First-use disclosure"
              description="Choose which apps are accessible. You can stop actions at any time and control screenshot training preferences."
              tone="warning"
            />
            <ChatPendingQuestion legend="Requested app">
              <ChatPendingOption
                label="Browser"
                description="Read and interact with the active browser window."
                selected
              />
            </ChatPendingQuestion>
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button
              onClick={() => setPendingSurface("none")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Decline
            </Button>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Allow once
            </Button>
          </ChatPendingInteractionFooter>
        </ChatMcpElicitationRequest>
      )
    }

    if (pendingSurface === "plan") {
      return (
        <ChatPlanImplementationRequest
          badge="Plan complete"
          description="Start a new execution turn or send feedback to revise the plan."
          title="Implement this plan?"
        >
          <ChatPendingInteractionBody>
            <ChatPendingOption
              description="Switch back to execution mode and begin with step one."
              label="Yes, implement this plan"
              selected
            />
            <ChatPendingTextInput aria-label="Plan feedback" placeholder="Or describe a change…" />
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button
              onClick={() => setPendingSurface("none")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Dismiss
            </Button>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Continue
            </Button>
          </ChatPendingInteractionFooter>
        </ChatPlanImplementationRequest>
      )
    }

    if (pendingSurface === "options") {
      return (
        <ChatOptionPickerRequest
          badge="Multiple choice"
          description="This native picker is selected from an active server request."
          title="Choose the surfaces to compare"
        >
          <ChatPendingInteractionBody>
            <ChatPendingQuestion legend="Surfaces">
              <ChatPendingOption label="Timeline" selected />
              <ChatPendingOption label="Composer" selected />
              <ChatPendingOption label="Panels" />
            </ChatPendingQuestion>
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Apply selection
            </Button>
          </ChatPendingInteractionFooter>
        </ChatOptionPickerRequest>
      )
    }

    if (pendingSurface === "setup") {
      return (
        <ChatSetupStepRequest
          badge="Desktop-owned"
          description="An example of native onboarding UI that is not a generic timeline event."
          title="Choose a starting role"
        >
          <ChatPendingInteractionBody>
            <ChatPendingQuestion legend="Role">
              <ChatPendingOption label="Build a feature" selected />
              <ChatPendingOption label="Review code" />
              <ChatPendingOption label="Investigate an issue" />
            </ChatPendingQuestion>
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <Button onClick={() => setPendingSurface("none")} size="sm" type="button">
              Continue setup
            </Button>
          </ChatPendingInteractionFooter>
        </ChatSetupStepRequest>
      )
    }

    return null
  }

  const renderShowcase = (showcase: DemoMessage["showcase"]) => {
    if (showcase === "audit") {
      return (
        <>
          <ChatReasoning defaultOpen={false}>
            <ChatReasoningTrigger label="Thought for 12 seconds" />
            <ChatReasoningContent>
              Compare the live composition with bundle-confirmed dimensions, then separate reusable
              presentation from application-owned state and transport.
            </ChatReasoningContent>
          </ChatReasoning>
          <ChatActivityList>
            <ChatActivityItem
              description="Header, timeline, composer, right panel, and bottom panel evidence"
              icon={<SearchIcon />}
              metadata="14 files"
              state="completed"
              stateLabel="Completed"
              title="Inspected the Codex conversation surface"
            />
            <ChatActivityItem
              description="Verified the 44px header and aligned 48rem timeline and composer measure"
              metadata="Desktop 26.915.31945"
              state="completed"
              stateLabel="Completed"
              title="Compared live layout and unpacked bundles"
            />
            <ChatActivityItem
              description="Kept protocol mapping, IPC, virtualization, and persistence outside @cypheria/ui"
              icon={<CheckCircleIcon />}
              state="completed"
              stateLabel="Completed"
              title="Defined package ownership boundaries"
            />
          </ChatActivityList>
          <ChatTool defaultOpen={false} state="completed">
            <ChatToolTrigger
              metadata="read_files"
              state="completed"
              stateLabel="Completed"
              title="Read component inventory"
            />
            <ChatToolContent>
              <ChatToolSection label="Parameters">
                <ChatToolCode>{`{\n  "path": "packages/ui/src/components/chat"\n}`}</ChatToolCode>
              </ChatToolSection>
              <ChatToolSection label="Result">
                Found shell, timeline, composer, panel, review, source, subagent, and terminal
                primitives.
              </ChatToolSection>
            </ChatToolContent>
          </ChatTool>
        </>
      )
    }

    if (showcase === "implementation") {
      return (
        <>
          <ChatTurnNotice icon={<CheckCircleIcon />} title="Plan updated" tone="info">
            Shell and panel contracts are complete. Rich timeline items and the development showcase
            are being composed next.
          </ChatTurnNotice>
          <ChatActivityList>
            <ChatActivityItem
              description="Added stable slots for activity, commands, notices, and file changes"
              icon={<ToolsIcon />}
              metadata="@cypheria/ui"
              state="completed"
              stateLabel="Completed"
              title="Built reusable timeline content"
            />
            <ChatActivityItem
              description="Wired panels, local streaming, composer controls, and turn navigation"
              metadata="Desktop"
              state="completed"
              stateLabel="Completed"
              title="Composed the development-only route"
            />
          </ChatActivityList>
          <ChatCommandBlock
            command="pnpm --filter @cypheria/ui typecheck"
            duration="2.8s"
            output="TypeScript completed without errors"
            state="completed"
            stateLabel="Exited 0"
            title="Typecheck shared chat components"
          />
          <ChatFileChanges title="Implemented conversation UI" summary="4 files · +286 -4">
            <ChatFileChange
              additions={270}
              path="packages/ui/src/components/chat/turn-content.tsx"
              statusLabel="Added"
            />
            <ChatFileChange
              additions={9}
              deletions={2}
              path="packages/ui/src/components/chat/timeline.tsx"
              statusLabel="Modified"
            />
            <ChatFileChange
              additions={5}
              deletions={2}
              path="packages/ui/src/components/chat/composer.tsx"
              statusLabel="Modified"
            />
            <ChatFileChange
              additions={2}
              path="packages/ui/src/components/chat/index.ts"
              statusLabel="Modified"
            />
          </ChatFileChanges>
          <ChatTurnNotice
            actions={
              approvalDecision === "pending" ? (
                <>
                  <Button
                    onClick={() => setApprovalDecision("rejected")}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Keep asking
                  </Button>
                  <Button
                    onClick={() => setApprovalDecision("approved")}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Allow once
                  </Button>
                </>
              ) : undefined
            }
            icon={<CertificateIcon />}
            title={
              approvalDecision === "pending"
                ? "Approval requested"
                : approvalDecision === "approved"
                  ? "Approved once"
                  : "Approval remains required"
            }
            tone={
              approvalDecision === "pending"
                ? "warning"
                : approvalDecision === "approved"
                  ? "success"
                  : "neutral"
            }
          >
            The demo keeps this decision local. Production execution still passes through Cypheria
            policy and audit services.
          </ChatTurnNotice>
        </>
      )
    }

    if (showcase === "validation") {
      return (
        <>
          <ChatReasoning defaultOpen>
            <ChatReasoningTrigger label="Thought for 7 seconds" />
            <ChatReasoningContent>
              Run narrow component checks first, recover from dependency state if needed, then run
              the cross-workspace gate.
            </ChatReasoningContent>
          </ChatReasoning>
          <ChatCommandBlock
            command="pnpm --filter @cypheria/ui test"
            duration="0.4s"
            output="ERR_PNPM_LINKING_FAILED  transient node_modules link race"
            state="error"
            stateLabel="Failed"
            title="Run UI tests"
          />
          <ChatTurnNotice
            actions={
              <Button
                disabled={retrySucceeded}
                onClick={() => setRetrySucceeded(true)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ArrowRotateCcwIcon className="size-3.5" />
                {retrySucceeded ? "Retried" : "Retry"}
              </Button>
            }
            icon={retrySucceeded ? <CheckCircleIcon /> : <ErrorIcon />}
            title={retrySucceeded ? "Dependency state recovered" : "A retry is available"}
            tone={retrySucceeded ? "success" : "error"}
          >
            {retrySucceeded
              ? "The stable install completed and the same test command passed."
              : "The command did not modify source files. Retry after the package links settle."}
          </ChatTurnNotice>
          <ChatCommandBlock
            command="pnpm check"
            duration="25.7s"
            output={
              "13 tasks passed\n69 UI tests passed\n5 Desktop demo tests passed\n58 docs checked"
            }
            state="completed"
            stateLabel="Exited 0"
            title="Run the repository gate"
          />
          <ChatActivityList>
            <ChatActivityItem
              description="Keyboard navigation, inert hidden panels, accessible names, and live state"
              metadata="74 assertions"
              state="completed"
              stateLabel="Completed"
              title="Verified interaction and accessibility contracts"
            />
            <ChatActivityItem
              description="English source and Chinese companion retain matching heading topology"
              metadata="58 files"
              state="completed"
              stateLabel="Completed"
              title="Checked documentation"
            />
          </ChatActivityList>
        </>
      )
    }

    if (showcase === "catalog") {
      return (
        <div className="space-y-6" data-demo-timeline-catalog>
          {visibleTimelineGroups.has("grouping") ? (
            <section className="space-y-3" data-demo-group="grouping">
              <ChatTimestampSeparator>
                Completed and live turns · projected render groups
              </ChatTimestampSeparator>
              <p className="text-xs text-muted-foreground">
                The same Desktop splitter routes projected items into user, commentary, tool, plan,
                final-answer, and post-answer surfaces. The live commentary starts a tool group.
              </p>
              {demoRenderRows.map((row) => (
                <div data-demo-render-kind={row.kind} key={row.id}>
                  {row.kind === "tools" || row.kind === "subagents" ? (
                    <ChatTurnGroup
                      current={row.toolGroupStart}
                      kind={row.kind}
                      label={row.kind === "tools" ? "Tool activity" : "Subagent activity"}
                    >
                      {row.items.map(({ item }) => (
                        <ChatTimelineEvent
                          key={item.itemId}
                          type={item.type === "command" ? "exec" : "dynamic-tool-call"}
                          title={
                            item.type === "command"
                              ? item.command
                              : item.type === "tool"
                                ? item.name
                                : item.itemId
                          }
                          metadata="Completed"
                        />
                      ))}
                    </ChatTurnGroup>
                  ) : row.kind === "user" ? (
                    <ChatUserMessage>
                      {row.items[0]?.item.type === "message" ? row.items[0].item.text : ""}
                    </ChatUserMessage>
                  ) : row.kind === "commentary" || row.kind === "assistant" ? (
                    <ChatAssistantMessage>
                      <span className="mb-1 block text-xs text-muted-foreground">
                        {row.kind === "commentary" ? "Commentary" : "Final answer"}
                      </span>
                      {row.items[0]?.item.type === "message" ? row.items[0].item.text : ""}
                    </ChatAssistantMessage>
                  ) : row.kind === "plan" ? (
                    <ChatPlanCard>
                      <ChatTodoList>
                        <ChatTodoItem state="completed" stateLabel="Completed">
                          Group activity by turn
                        </ChatTodoItem>
                        <ChatTodoItem state="running" stateLabel="In progress">
                          Render the final answer separately
                        </ChatTodoItem>
                      </ChatTodoList>
                    </ChatPlanCard>
                  ) : (
                    <ChatTimelineEvent
                      type="model-rerouted"
                      title={
                        row.items[0]?.item.type === "status"
                          ? row.items[0].item.message
                          : "Turn notice"
                      }
                    />
                  )}
                </div>
              ))}
            </section>
          ) : null}
          {visibleTimelineGroups.has("reasoning") ? (
            <section className="space-y-2" data-demo-group="reasoning">
              <ChatTimestampSeparator>Reasoning and response</ChatTimestampSeparator>
              <ChatThinkingPlaceholder>
                Thinking through the component boundary…
              </ChatThinkingPlaceholder>
              <ChatTimelineEvent
                type="user-message"
                title="User message"
                description="A prompt with text, attachments, and an editable action row."
              />
              <ChatTimelineEvent
                type="reasoning"
                title="Reasoning"
                description="Collapsible intermediate analysis with elapsed time."
                state="running"
              />
              <ChatTimelineEvent
                type="worked-for"
                title="Worked for 18 seconds"
                metadata="12 activities"
              />
              <ChatTimelineEvent
                type="assistant-message"
                title="Assistant response"
                description="Streaming rich content followed by response actions."
                tone="success"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("planning") ? (
            <section className="space-y-2" data-demo-group="planning">
              <ChatTimestampSeparator>Plans and todos</ChatTimestampSeparator>
              <ChatPlanCard>
                <div className="border-b px-3 py-2 text-sm font-medium">Implementation plan</div>
                <ChatTodoList>
                  <ChatTodoItem state="completed" stateLabel="Done">
                    Inventory the surface
                  </ChatTodoItem>
                  <ChatTodoItem state="running" stateLabel="In progress">
                    Build reusable event views
                  </ChatTodoItem>
                  <ChatTodoItem state="waiting" stateLabel="Queued">
                    Map canonical events
                  </ChatTodoItem>
                </ChatTodoList>
              </ChatPlanCard>
              <ChatTimelineEvent type="proposed-plan" title="Proposed plan" metadata="3 steps" />
              <ChatTimelineEvent
                type="todo-list"
                title="Todo list updated"
                metadata="2 of 3 complete"
              />
              <ChatTimelineEvent
                type="plan-implementation"
                title="Implementing the approved plan"
                state="running"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("tools") ? (
            <section className="space-y-2" data-demo-group="tools">
              <ChatTimestampSeparator>Tools and execution</ChatTimestampSeparator>
              <ChatActivitySummary>
                <ChatActivitySummaryPart active icon={<TerminalIcon />}>
                  2 commands
                </ChatActivitySummaryPart>
                <ChatActivitySummaryPart icon={<FileIcon />}>4 files</ChatActivitySummaryPart>
                <ChatActivitySummaryPart icon={<GlobeIcon />}>1 search</ChatActivitySummaryPart>
              </ChatActivitySummary>
              <ChatTimelineEvent
                type="dynamic-tool-call"
                title="Called a dynamic tool"
                metadata="Completed"
              />
              <ChatTimelineEvent
                type="exec"
                title="Ran pnpm check"
                metadata="Exited 0"
                tone="success"
              />
              <ChatTimelineEvent
                type="mcp-tool-call"
                title="Called design-system MCP"
                metadata="Connected"
              />
              <ChatTimelineEvent type="patch" title="Applied patch" metadata="4 files" />
              <ChatTimelineEvent type="turn-diff" title="Turn diff available" metadata="+286 −4" />
              <ChatTimelineEvent type="web-search" title="Searched the web" metadata="6 results" />
              <ChatTimelineEvent
                type="image-view"
                title="Viewed screenshot"
                metadata="1728 × 1117"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("approvals") ? (
            <section className="space-y-2" data-demo-group="approvals">
              <ChatTimestampSeparator>Approvals and prompts</ChatTimestampSeparator>
              <ChatApprovalCard
                state="pending"
                stateLabel="Waiting"
                title="Permission required"
                actions={
                  <Button size="xs" type="button" variant="secondary">
                    Allow once
                  </Button>
                }
              >
                A command wants to access a path outside the current workspace.
              </ChatApprovalCard>
              <ChatUserInputCard
                title="Choose a review scope"
                description="The task can continue after one selection."
                actions={
                  <Button size="xs" type="button" variant="outline">
                    Changed files
                  </Button>
                }
              />
              <ChatTimelineEvent
                type="permission-request"
                title="Permission request"
                metadata="Pending"
                tone="warning"
              />
              <ChatTimelineEvent
                type="automatic-approval-review"
                title="Automatic approval reviewed"
                metadata="Allowed"
                tone="success"
              />
              <ChatTimelineEvent
                type="mcp-server-elicitation"
                title="MCP server requested input"
                metadata="1 field"
              />
              <ChatTimelineEvent type="userInput" title="User input requested" metadata="Open" />
              <ChatTimelineEvent
                type="user-input-response"
                title="User input received"
                metadata="Changed files"
                tone="success"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("agents") ? (
            <section className="space-y-2" data-demo-group="agents">
              <ChatTimestampSeparator>Agents and handoffs</ChatTimestampSeparator>
              <ChatAgentCard
                state="running"
                stateLabel="Running"
                metadata="gpt-5.6"
                title="UI audit agent"
              >
                Comparing panel states and timeline density.
              </ChatAgentCard>
              <ChatThreadHandoff
                actionLabel="Open"
                destination="Isolated worktree"
                onOpen={() => undefined}
                state="completed"
                stateLabel="Ready"
                title="Task handed off"
              />
              <ChatTimelineEvent
                type="subagent-activity"
                title="Subagent activity"
                metadata="2 agents"
                state="running"
              />
              <ChatTimelineEvent
                type="multi-agent-action"
                title="Coordinated agent action"
                metadata="Review complete"
              />
              <ChatTimelineEvent
                type="remote-task-created"
                title="Remote task created"
                metadata="Ready"
                tone="success"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("resources") ? (
            <section className="space-y-2" data-demo-group="resources">
              <ChatTimestampSeparator>Resources and media</ChatTimestampSeparator>
              <ChatGeneratedImageGrid>
                <ChatGeneratedImage alt="Generated Cypheria wallpaper" src={promptWallpaper} />
                <ChatGeneratedImage alt="Generating alternate view" pending />
              </ChatGeneratedImageGrid>
              <ChatResourceGroup title="Created resources">
                <ChatResourceCard
                  kind="file"
                  title="conversation-reference.md"
                  metadata="Markdown"
                />
                <ChatResourceCard kind="website" title="Preview website" metadata="Local" />
                <ChatResourceCard kind="appgen-app" title="Interactive prototype" metadata="App" />
                <ChatResourceCard
                  kind="artifact-session"
                  title="Design session"
                  metadata="Artifact"
                />
              </ChatResourceGroup>
              <ChatTimelineEvent
                type="generated-image"
                title="Generated two images"
                metadata="Complete"
                tone="success"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("system") ? (
            <section className="space-y-2" data-demo-group="system">
              <ChatTimestampSeparator>System transitions</ChatTimestampSeparator>
              <ChatTimelineEvent
                type="context-compaction"
                title="Context compacted"
                metadata="62% retained"
              />
              <ChatTimelineEvent
                type="worktree-init"
                title="Worktree initialized"
                metadata="codex/chat-ui"
              />
              <ChatTimelineEvent
                type="automation-update"
                title="Automation updated"
                metadata="Weekdays"
              />
              <ChatTimelineEvent type="model-changed" title="Model changed" metadata="gpt-5.6" />
              <ChatTimelineEvent
                type="model-rerouted"
                title="Model rerouted"
                metadata="Capacity"
                tone="warning"
              />
              <ChatTimelineEvent
                type="personality-changed"
                title="Personality changed"
                metadata="Concise"
              />
              <ChatTimelineEvent
                type="forked-from-conversation"
                title="Forked from conversation"
                metadata="Turn 44"
              />
              <ChatTimelineEvent
                type="external-event"
                title="External event received"
                metadata="Pull request"
              />
              <ChatTimelineEvent
                type="strict-review-notice"
                title="Strict review enabled"
                metadata="Security"
              />
              <ChatTimelineEvent
                type="auto-review-interruption-warning"
                title="Automatic review paused"
                description="New edits arrived while the review was running."
                tone="warning"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("errors") ? (
            <section className="space-y-2" data-demo-group="errors">
              <ChatTimestampSeparator>Errors and recovery</ChatTimestampSeparator>
              <ChatTimelineEvent
                type="system-error"
                title="Environment setup failed"
                description="The task remains recoverable and can be retried."
                tone="error"
                state="error"
              />
              <ChatTimelineEvent
                type="stream-error"
                title="Response stream interrupted"
                metadata="Retry available"
                tone="error"
                state="error"
              />
            </section>
          ) : null}
          {visibleTimelineGroups.has("voice") ? (
            <section className="space-y-2" data-demo-group="voice">
              <ChatTimestampSeparator>Voice and steering</ChatTimestampSeparator>
              <ChatTranscriptLine>
                “Keep the right panel open and move Terminal to the bottom.”
              </ChatTranscriptLine>
              <ChatTimelineEvent
                type="realtime-transcript"
                title="Realtime transcript"
                metadata="Live"
                state="running"
              />
              <ChatTimelineEvent
                type="steered"
                title="Response steered"
                description="The active turn incorporated a follow-up instruction."
                tone="info"
              />
            </section>
          ) : null}
        </div>
      )
    }

    return null
  }

  return (
    <ChatWorkspaceShell
      allowRightPanelFullscreen
      bottomPanel={renderPanel("bottom")}
      bottomPanelResizeLabel="Resize bottom panel"
      bottomPanelSize={bottomPanelSize.current}
      bottomPanelVisibility={bottomVisibility}
      onBottomPanelResize={(size) => {
        bottomPanelSize.current = size
      }}
      onBottomPanelVisibilityChange={setBottomVisibility}
      onRightPanelResize={(size) => {
        rightPanelSize.current = size
      }}
      onRightPanelFullscreenChange={setRightFullscreen}
      fixedHeaderActions={
        <>
          <ChatPanelToggle
            label="Toggle bottom panel"
            panel="bottom"
            pressed={bottomVisibility === "visible"}
            tooltip="Toggle bottom panel"
            onClick={() => togglePanel("bottom")}
          >
            <DockIcon />
          </ChatPanelToggle>
          <ChatPanelToggle
            label="Toggle side panel"
            panel="right"
            pressed={wideViewport && rightVisibility === "visible"}
            tooltip="Toggle side panel"
            onClick={() => togglePanel("right")}
          >
            <SidebarRightIcon />
          </ChatPanelToggle>
        </>
      }
      header={
        <ChatHeader
          className="desktop-titlebar overflow-hidden"
          reserveFixedActions={!(wideViewport && rightVisibility === "visible")}
        >
          <ChatHeaderBreadcrumb>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <FolderOpenIcon className="size-3.5" />
            </span>
            <ChatHeaderTitle>Chat UI component audit</ChatHeaderTitle>
          </ChatHeaderBreadcrumb>
          <span className="hidden shrink truncate text-xs text-muted-foreground sm:inline">
            cypheria
          </span>
          <ChatHeaderStatus className="hidden lg:flex" state={generating ? "running" : "completed"}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {generating ? "Generating" : "Demo ready"}
          </ChatHeaderStatus>
          <ChatHeaderActions>
            <Badge className="hidden font-normal xl:inline-flex" variant="secondary">
              {messages.length} messages
            </Badge>
            <Button aria-label="Share demo" size="icon-sm" type="button" variant="ghost">
              <ShareChatIcon className="size-4" />
            </Button>
            <ChatPanelToggle
              label="Toggle pinned summary"
              panel="summary"
              pressed={summaryVisible}
              tooltip="Pinned summary"
              onClick={() => setSummaryVisible((current) => !current)}
            >
              <SparklesIcon className="size-4" />
            </ChatPanelToggle>
            <Button aria-label="More demo actions" size="icon-sm" type="button" variant="ghost">
              <MoreCircleMenuDotsIcon className="size-4" />
            </Button>
          </ChatHeaderActions>
        </ChatHeader>
      }
      rightPanel={wideViewport ? renderPanel("right") : undefined}
      rightPanelResizeLabel="Resize right panel"
      rightPanelSize={rightPanelSize.current}
      rightPanelFullscreen={rightFullscreen}
      rightPanelVisibility={wideViewport ? rightVisibility : "closed"}
    >
      <ChatMainColumn>
        {summaryVisible ? (
          <ChatPinnedSummary>
            <div className="flex min-w-0 items-center gap-2">
              <CompareIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                4 shared chat files changed while auditing the Codex conversation experience.
              </span>
              <Badge variant="secondary">Local demo</Badge>
            </div>
          </ChatPinnedSummary>
        ) : null}
        <div className="absolute top-3 right-3 z-30" data-demo-display-controller>
          {displayController}
        </div>
        {visibleComposerExtras.has("notification") ? (
          <div className="absolute top-14 right-3 z-30 w-80 max-w-[calc(100%-1.5rem)]">
            <ChatDesktopNotificationPreview
              actions={
                <Button size="xs" type="button" variant="secondary">
                  Open task
                </Button>
              }
              appName="Cypheria"
              body="The conversation UI audit is ready for review."
              kind="turn-complete"
              timestamp="now"
              title="Turn complete"
            />
          </div>
        ) : null}
        <ChatTurnNavigator label="Conversation turns">
          {navigatorTargets.map((target, markerIndex) => (
            <ChatTurnMarker
              active={markerIndex === navigatorTargets.length - 1}
              key={target.id}
              label={`Go to user turn ${target.index + 1}`}
              onClick={() => scrollToMessage(target.index)}
            />
          ))}
        </ChatTurnNavigator>
        <ChatTimeline
          ref={timelineRef}
          onScroll={(event) => {
            const timeline = event.currentTarget
            setShowScrollToLatest(
              timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight > 48
            )
          }}
        >
          <ChatTimelineContent className="block">
            <div
              className="relative w-full"
              data-chat-demo-virtualizer="true"
              data-total-count={messages.length}
              style={{ height: virtualizer.getTotalSize() }}
            >
              <ChatTimelineState
                className="absolute inset-x-0 top-0 h-9 py-0 text-xs"
                state="loading-history"
              >
                Long conversation · {messages.length} messages · virtualized
              </ChatTimelineState>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index]
                if (!message) return null
                return (
                  <div
                    className="absolute top-0 left-0 w-full pb-8"
                    data-demo-message={message.id}
                    data-index={virtualRow.index}
                    key={virtualRow.key}
                    ref={virtualizer.measureElement}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <ChatTimelineItem kind={message.role} state="completed">
                      {message.role === "user" ? (
                        <ChatUserMessage>
                          <div>{message.text}</div>
                          {message.attachments?.length ? (
                            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                              {message.attachments.map((attachment) => (
                                <Badge className="max-w-full gap-1 font-normal" key={attachment}>
                                  <FileIcon />
                                  <span className="truncate">{attachment}</span>
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </ChatUserMessage>
                      ) : (
                        <ChatAssistantMessage>
                          {renderShowcase(message.showcase)}
                          <ChatMessageContent>{message.text}</ChatMessageContent>
                        </ChatAssistantMessage>
                      )}
                      <ChatMessageActions>
                        <Button
                          aria-label="Copy message"
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <CopyIcon className="size-3.5" />
                        </Button>
                        {message.role === "user" ? (
                          <Button
                            aria-label="Edit message"
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <EditPencilIcon className="size-3.5" />
                          </Button>
                        ) : (
                          <Button
                            aria-label="Retry message"
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <ArrowRotateCcwIcon className="size-3.5" />
                          </Button>
                        )}
                      </ChatMessageActions>
                    </ChatTimelineItem>
                  </div>
                )
              })}
            </div>
            {status === "submitted" ? (
              <ChatTimelineItem kind="activity" state="waiting">
                <ChatTurnActivity state="waiting" icon={<SparklesIcon className="size-4" />}>
                  Preparing a response…
                </ChatTurnActivity>
              </ChatTimelineItem>
            ) : null}
            {status === "streaming" ? (
              <ChatTimelineItem kind="activity" state="running">
                <ChatTurnActivity state="running" icon={<SparklesIcon className="size-4" />}>
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
            onClick={() => scrollToLatest()}
          />
        ) : null}
        <ChatComposerDock visible={composerVisible}>
          <div className="flex w-full max-w-(--chat-composer-max-width) flex-col items-center gap-2">
            {visibleComposerExtras.has("fixed-summary") ? (
              <ChatFixedTurnSummary>
                <ChatFixedTurnSummaryItem kind="goal" label="Align Codex conversation UI" />
                <ChatFixedTurnSummaryItem kind="todo" label="Plan" progress={67} value="2/3" />
                <ChatFixedTurnSummaryItem kind="diff" label="4 files" value="+286 −4" />
              </ChatFixedTurnSummary>
            ) : null}
            {visibleComposerExtras.has("queue") ||
            visibleComposerExtras.has("goal") ||
            visibleComposerExtras.has("subagents") ||
            visibleComposerExtras.has("warning") ||
            visibleComposerExtras.has("status") ? (
              <ChatComposerTopTray>
                {visibleComposerExtras.has("warning") ? (
                  <div className="grid gap-1.5">
                    <ChatComposerBanner
                      actions={
                        <Button size="xs" type="button" variant="ghost">
                          Review limits
                        </Button>
                      }
                      description="The next tool call will ask before accessing paths outside this workspace."
                      title="Approval policy is active"
                      tone="warning"
                    />
                    <div className="flex items-center justify-between px-2.5">
                      <span className="text-xs text-muted-foreground">Context usage preview</span>
                      <ChatContextUsage
                        agent={demoAgent}
                        agentLabel={demoAgentLabel}
                        categories={
                          demoAgent === "claude"
                            ? [
                                { kind: "used", label: "Messages", tokens: 78_200 },
                                { kind: "used", label: "System prompt", tokens: 21_400 },
                                { kind: "buffer", label: "Compaction buffer", tokens: 20_000 },
                              ]
                            : undefined
                        }
                        costLabel={
                          demoAgent === "pi" || demoAgent === "acp"
                            ? "$0.4281 USD · session"
                            : undefined
                        }
                        icon={
                          <HarnessIcon
                            agentId={demoAgent === "acp" ? "gemini" : demoAgent}
                            name={demoAgentLabel}
                          />
                        }
                        maxTokens={demoUsage.max}
                        model={model}
                        sessionTokens={demoAgent === "pi" ? demoTokenBreakdown : null}
                        sourceLabel={demoUsage.source}
                        tokens={
                          demoAgent === "claude" || demoAgent === "acp" ? null : demoTokenBreakdown
                        }
                        usedTokens={demoUsage.used}
                      />
                    </div>
                  </div>
                ) : null}
                {visibleComposerExtras.has("queue") ? (
                  <ChatComposerPanel
                    description="These messages have not entered the transcript yet."
                    icon={<ClockIcon />}
                    title="Queued follow-ups"
                  >
                    <ChatQueuedInputList>
                      <ChatQueuedInputItem position="1" state="queued" stateLabel="Queued">
                        Keep the side panel open while validating the diff.
                      </ChatQueuedInputItem>
                      <ChatQueuedInputItem position="2" state="paused" stateLabel="Paused">
                        Summarize the remaining production integration work.
                      </ChatQueuedInputItem>
                    </ChatQueuedInputList>
                  </ChatComposerPanel>
                ) : null}
                {visibleComposerExtras.has("goal") ? (
                  <ChatComposerPanel
                    actions={
                      <Button size="xs" type="button" variant="ghost">
                        Edit
                      </Button>
                    }
                    description="Match the audited hierarchy while keeping transport and persistence application-owned."
                    icon={<PinIcon />}
                    title="Thread goal"
                  />
                ) : null}
                {visibleComposerExtras.has("subagents") ? (
                  <ChatComposerPanel
                    actions={
                      <Button size="xs" type="button" variant="ghost">
                        Open
                      </Button>
                    }
                    description="UI audit is running · accessibility review completed"
                    icon={<AgentIcon />}
                    title="2 background agents"
                  />
                ) : null}
                {visibleComposerExtras.has("status") ? (
                  <ChatComposerStatusMessage state={generating ? "running" : "completed"}>
                    {generating
                      ? "Updating the active response…"
                      : "Ready for a new message or a pending-request preview."}
                  </ChatComposerStatusMessage>
                ) : null}
              </ChatComposerTopTray>
            ) : null}
            <ChatComposerFrame className="max-w-none">
              {pendingSurface !== "none" ? (
                renderPendingComposer()
              ) : (
                <ChatComposerForm ref={composerFormRef} onSubmit={submitMessage}>
                  <input
                    ref={attachmentInputRef}
                    accept="image/*,.md,.txt"
                    aria-label="Attach photos or files"
                    className="sr-only"
                    multiple
                    tabIndex={-1}
                    type="file"
                    onChange={(event) => {
                      setPendingAttachments((current) => [
                        ...current,
                        ...Array.from(event.currentTarget.files ?? []).map((file) => ({
                          id: crypto.randomUUID(),
                          kind: file.type.startsWith("image/")
                            ? ("image" as const)
                            : ("file" as const),
                          name: file.name,
                          detail: file.type || "Local file",
                          previewUrl: previewForFile(file),
                        })),
                      ])
                      event.currentTarget.value = ""
                    }}
                  />
                  {pendingAttachments.length || visibleComposerExtras.has("attachments") ? (
                    <ChatComposerHeader>
                      <ChatComposerAttachmentList
                        aria-label="Composer attachments"
                        errorLabel="Upload failed"
                        items={[
                          ...pendingAttachments,
                          ...(visibleComposerExtras.has("attachments") ? sampleAttachments : []),
                        ].sort((a, b) => {
                          const aIndex = attachmentOrder.indexOf(a.id)
                          const bIndex = attachmentOrder.indexOf(b.id)
                          return (
                            (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) -
                            (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex)
                          )
                        })}
                        onRemove={(id) => {
                          const item = pendingAttachments.find((item) => item.id === id)
                          if (item) releasePreview(item)
                          setPendingAttachments((current) =>
                            current.filter((item) => item.id !== id)
                          )
                          setSampleAttachments((current) =>
                            current.filter((item) => item.id !== id)
                          )
                        }}
                        onReorder={setAttachmentOrder}
                        removeLabel={(item) => `Remove ${item.name}`}
                        uploadingLabel="Uploading…"
                      />
                    </ChatComposerHeader>
                  ) : null}
                  <ChatComposerBody>
                    <ChatComposerEditor
                      key={composerEpoch}
                      aria-label="Message Chat Demo"
                      disabled={status === "submitted"}
                      onChange={(text) => setDraft(text)}
                      onCommand={(id) => {
                        if (id === "attach") attachmentInputRef.current?.click()
                        if (id === "clear") setDraft("")
                      }}
                      onPasteFiles={(files) =>
                        setPendingAttachments((current) => [
                          ...current,
                          ...files.map((file) => ({
                            id: crypto.randomUUID(),
                            kind: file.type.startsWith("image/")
                              ? ("image" as const)
                              : ("file" as const),
                            name: file.name,
                            detail: file.type || "Pasted file",
                            previewUrl: previewForFile(file),
                          })),
                        ])
                      }
                      onPasteLongText={(text) =>
                        setPendingAttachments((current) => [
                          ...current,
                          {
                            id: crypto.randomUUID(),
                            kind: "pasted-text",
                            name: "Pasted text",
                            detail: `${text.length.toLocaleString()} characters`,
                          },
                        ])
                      }
                      onSubmit={() => composerFormRef.current?.requestSubmit()}
                      placeholder="Ask Cypheria to build, explain, or review…"
                      suggestions={demoSuggestions}
                      value={draft}
                    />
                  </ChatComposerBody>
                  <ChatComposerFooter>
                    <ChatComposerUtilityBar>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <ChatComposerControl
                              label="Add context"
                              size="icon-sm"
                              tooltip="Add context"
                            >
                              <PlusComposerIcon className="size-4" />
                            </ChatComposerControl>
                          }
                        />
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => attachmentInputRef.current?.click()}>
                            <FileIcon />
                            Add photos or files
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <ChatComposerControl
                        className={autoApprove ? "text-amber-600" : undefined}
                        label="Toggle approval mode"
                        onClick={() => setAutoApprove((current) => !current)}
                        tooltip="Approval mode"
                      >
                        <CertificateIcon className="size-3.5" />
                        {autoApprove ? "Full access" : "Ask to approve"}
                      </ChatComposerControl>
                      <span className="ml-auto" />
                      <ChatModelSelector
                        agent={demoAgent}
                        agentLabel={demoAgentLabel}
                        agentOptions={[
                          { label: "Codex", value: "codex" },
                          { label: "Claude", value: "claude" },
                          { label: "Pi", value: "pi" },
                          { label: "OpenCode", value: "opencode" },
                          { label: "ACP agent", value: "acp" },
                        ].map((option) => ({
                          ...option,
                          icon: (
                            <HarnessIcon
                              agentId={
                                option.value === "acp"
                                  ? "gemini"
                                  : (option.value as "codex" | "claude" | "pi" | "opencode")
                              }
                              name={option.label}
                            />
                          ),
                        }))}
                        labels={{
                          agent: "Agent",
                          model: "Model",
                          reasoning: "Reasoning effort",
                          speed: "Speed",
                        }}
                        model={model}
                        modelOptions={[
                          { description: "OpenAI", label: "GPT-5.6 Sol", value: "gpt-5.6" },
                          { description: "OpenAI", label: "GPT-6 Astra", value: "gpt-6" },
                        ]}
                        onAgentChange={(value) => setDemoAgent(value as typeof demoAgent)}
                        onModelChange={setModel}
                        onReasoningChange={setReasoning}
                        onSpeedChange={setSpeed}
                        reasoning={reasoning}
                        reasoningOptions={[
                          { label: "Medium", value: "medium" },
                          { label: "High", value: "high" },
                          { label: "XHigh", value: "xhigh" },
                        ]}
                        speed={speed}
                        speedOptions={[
                          { description: "Default speed", label: "Standard", value: "standard" },
                          { description: "Faster, increased usage", label: "Fast", value: "fast" },
                        ]}
                      />
                      <ChatContextUsage
                        agent={demoAgent}
                        agentLabel={demoAgentLabel}
                        categories={
                          demoAgent === "claude"
                            ? [
                                { kind: "used", label: "Messages", tokens: 78_200 },
                                { kind: "used", label: "System prompt", tokens: 21_400 },
                                { kind: "buffer", label: "Compaction buffer", tokens: 20_000 },
                              ]
                            : undefined
                        }
                        costLabel={
                          demoAgent === "pi" || demoAgent === "acp"
                            ? "$0.4281 USD · session"
                            : undefined
                        }
                        icon={
                          <HarnessIcon
                            agentId={demoAgent === "acp" ? "gemini" : demoAgent}
                            name={demoAgentLabel}
                          />
                        }
                        maxTokens={demoUsage.max}
                        model={model}
                        sessionTokens={demoAgent === "pi" ? demoTokenBreakdown : null}
                        sourceLabel={demoUsage.source}
                        tokens={
                          demoAgent === "claude" || demoAgent === "acp" ? null : demoTokenBreakdown
                        }
                        usedTokens={demoUsage.used}
                      />
                    </ChatComposerUtilityBar>
                    <ChatComposerControl
                      label="Hide composer"
                      size="icon-sm"
                      tooltip="Hide composer"
                      onClick={() => setComposerVisible(false)}
                    >
                      <CloseBoldIcon className="size-4" />
                    </ChatComposerControl>
                    <ChatComposerSubmit
                      disabled={!draft.trim() && !generating}
                      status={status}
                      stopLabel="Stop generating"
                      submitLabel="Send message"
                      onStop={stopGeneration}
                    />
                  </ChatComposerFooter>
                </ChatComposerForm>
              )}
            </ChatComposerFrame>
          </div>
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
