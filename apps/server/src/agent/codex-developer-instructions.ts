import type { GitSettings } from "@cypheria/protocol"

/**
 * The `developerInstructions` of a Codex Thread.
 *
 * The text is the one the official Codex desktop sends, word for word, so that Codex behaves in
 * Cypheria as it does there. The only differences are the deep-link scheme (`cypheria://`) and that
 * a sentence appears only when Cypheria can honor it: every section and every sentence that
 * promises a client capability, or names an app tool, is gated by `CodexInstructionCapabilities`.
 * Tool names, directive names, and all other wording stay unchanged, because Codex models are
 * tuned on them.
 */

/** Names of the Cypheria app tools a Thread can call, identical to the official desktop's. */
export const CODEX_APP_TOOL_NAMES = [
  "automation_update",
  "create_thread",
  "fork_thread",
  "list_threads",
  "list_archived_threads",
  "read_thread",
  "wait_threads",
  "send_message_to_thread",
  "handoff_thread",
  "set_thread_pinned",
  "set_thread_archived",
  "set_thread_title",
  "list_projects",
  "create_sidebar_section",
  "rename_sidebar_section",
  "delete_sidebar_section",
  "move_thread_to_sidebar_section",
  "move_project_to_sidebar_section",
  "reorder_sidebar_projects",
  "reorder_sidebar_sections",
  "create_worktree",
  "archive_worktree",
  "restore_worktree",
  "list_artifacts",
] as const
export type CodexAppToolName = (typeof CODEX_APP_TOOL_NAMES)[number]

/** What Cypheria can honor for a Thread. Everything defaults to off. */
export type CodexInstructionCapabilities = {
  /** `::code-comment` directives render as review comments. */
  readonly codeComments: boolean
  /** Absolute workspace paths in Markdown links open from the Server (read-only files panel). */
  readonly fileLinks: boolean
  /** Markdown images render images, audio, and video that live on the Server host. */
  readonly media: boolean
  /** `cypheria://review` links open the pull request review. */
  readonly prDiffLinks: boolean
  /** `:codex-followup` list items render as follow-up suggestions. */
  readonly artifactFollowUps: boolean
  /** `::created-thread` directives render as a link to the new Thread. */
  readonly createdThreadDirective: boolean
  /** App tools mounted for the Thread. A section appears only with the tools it names. */
  readonly tools: ReadonlySet<string>
}

/**
 * What the first-party clients render today. Desktop renders every one of these; a client that
 * renders no conversation yet (CLI, Expo) commits to showing the same Markdown as plain text, which
 * the directive and link syntax is designed to survive.
 *
 * - `fileLinks`, `media`: `thread.paths.resolve` and `thread.files.read` back links and inline media.
 * - `codeComments`, `artifactFollowUps`: Desktop renders the directives.
 * - `prDiffLinks` stays off until a `cypheria://review` link can open the exact pull request.
 * - `createdThreadDirective` follows the `create_thread` app tool.
 */
export const CYPHERIA_RENDERING_CAPABILITIES: Omit<CodexInstructionCapabilities, "tools"> = {
  artifactFollowUps: true,
  codeComments: true,
  createdThreadDirective: false,
  fileLinks: true,
  media: true,
  prDiffLinks: false,
}

export const NO_CODEX_INSTRUCTION_CAPABILITIES: CodexInstructionCapabilities = {
  artifactFollowUps: false,
  codeComments: false,
  createdThreadDirective: false,
  fileLinks: false,
  media: false,
  prDiffLinks: false,
  tools: new Set(),
}

const DESKTOP_CONTEXT_HEADER = [
  "# Codex desktop context",
  "- You are running inside the Codex (desktop) app, which allows some additional features not available in the CLI alone:",
]

/** `[line, capability that makes the sentence true]`, in the official order. */
const FILES_AND_MEDIA: ReadonlyArray<readonly [string, keyof CodexInstructionCapabilities | null]> =
  [
    [
      "- In the app, the model can display images, videos, and audio using standard Markdown image syntax: ![alt](url)",
      "media",
    ],
    [
      "- When an app or connector generates or edits media, prefer native media already displayed inline or a local output file already returned by the tool. For remote images, prefer Markdown image embeds when permitted by the app's URL-safety policy.",
      "media",
    ],
    [
      "- For media that cannot be displayed directly, including remote video and audio, use the app's preview or display tool when available. Provide a Markdown link to a usable result URL only as a last resort if no preview or display tool can show the result.",
      "media",
    ],
    ["- Do not download remote media to work around display restrictions.", "media"],
    [
      "- When sending or referencing a local image, video, or audio file, always use an absolute filesystem path in the Markdown image tag (e.g., ![alt](/absolute/path.png)); relative paths and plain text will not render the media.",
      "media",
    ],
    [
      "- When a user asks to play an audio file, render it using Markdown image syntax with an absolute path (e.g., ![audio](/absolute/path.mp3)).",
      "media",
    ],
    [
      "- When referencing code or workspace files in responses, always use full absolute file paths instead of relative paths.",
      "fileLinks",
    ],
    [
      "- If a user asks about an image, or asks you to create an image, it is often a good idea to show the image to them in your response.",
      "media",
    ],
    ["- Return web URLs as Markdown links (e.g., [label](https://example.com)).", null],
  ]

const PULL_REQUEST_DIFF_LINKS = [
  "### Pull request diff links",
  "When referencing code from a GitHub PR, you can link directly to its diff in the app using:",
  "[label](cypheria://review?pr=PR_URL&path=FILE_PATH&line=LINE&side=right)",
  "URL-encode PR_URL and the repository-relative FILE_PATH. Use a verified one-based LINE from the current PR diff. Use side=left for the original code or side=right for the updated code. Enterprise links must use the hostname of this task's configured Git remote. Use ordinary file links for workspace code.",
]

const AUTOMATIONS_INTRO =
  "- This app supports recurring automations, reminders, monitors, follow-ups, and thread wakeups. When the user asks to create, view, update, delete, or ask about automations, search for the `automation_update` tool first, then follow its schema instead of writing raw automation directives by hand."
const AUTOMATIONS_HEARTBEAT =
  '- For heartbeat monitors, preserve the user\'s notification intent in the saved prompt. Unless the user explicitly asks for periodic status updates, instruct the heartbeat to stay quiet while the monitored state is unchanged or non-actionable and to notify only on a meaningful change, completion, failure, or required user action. Do not add instructions such as "leave a brief status update" on every run.'
const AUTOMATIONS_ARCHIVE =
  "- When an automation should archive a Codex thread on completion, use `set_thread_archived` instead of emitting raw archive directives."

const THREAD_TOOLS_ORDER: readonly CodexAppToolName[] = [
  "create_thread",
  "fork_thread",
  "list_threads",
  "list_archived_threads",
  "read_thread",
  "wait_threads",
  "send_message_to_thread",
  "handoff_thread",
  "set_thread_pinned",
  "set_thread_archived",
  "set_thread_title",
]

const SIDEBAR_TOOLS_ORDER: readonly CodexAppToolName[] = [
  "create_sidebar_section",
  "rename_sidebar_section",
  "delete_sidebar_section",
  "move_thread_to_sidebar_section",
  "move_project_to_sidebar_section",
  "reorder_sidebar_projects",
  "reorder_sidebar_sections",
]

/** "`a`, `b`, or `c`", the way the official text lists tools. */
const toolList = (names: readonly string[]): string => {
  const quoted = names.map((name) => `\`${name}\``)
  if (quoted.length <= 1) return quoted.join("")
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted.at(-1)}`
}

const INLINE_CODE_COMMENTS = [
  "### Inline Code Comments",
  "- Use the ::code-comment{...} directive when you need to attach feedback directly to specific code lines.",
  "- Emit one directive per inline comment; emit none when there are no actionable inline comments.",
  "- Required attributes: title (short label), body (one-paragraph explanation), file (path to the file).",
  "- Optional attributes: start, end (1-based line numbers), priority (0-3).",
  "- file should be an absolute path or include the workspace folder segment so it can be resolved relative to the workspace.",
  "- Keep line ranges tight; end defaults to start.",
  '- Example: ::code-comment{title="[P2] Off-by-one" body="Loop iterates past the end when length is 0." file="/path/to/foo.ts" start=10 end=11 priority=2}',
]

const INLINE_ARTIFACT_FOLLOW_UPS = [
  "### Inline Artifact Follow-Ups",
  '- Format each artifact follow-up as an unescaped Markdown list item, `- :codex-followup[visible phrase]{prompt="Complete user request"}`; avoid closing brackets in the visible phrase and escape double quotes in the prompt.',
]

const join = (...parts: ReadonlyArray<string | null | undefined | false>): string =>
  parts
    .map((part) => (part ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join("\n\n")

const desktopContext = (capabilities: CodexInstructionCapabilities): string => {
  const lines = FILES_AND_MEDIA.filter(([, capability]) =>
    capability === null ? true : capabilities[capability] === true
  ).map(([line]) => line)
  return [...DESKTOP_CONTEXT_HEADER, "", "### Images/Visuals/Files", ...lines].join("\n")
}

const automations = (tools: ReadonlySet<string>): string | null => {
  if (!tools.has("automation_update")) return null
  return [
    "### Automations",
    AUTOMATIONS_INTRO,
    AUTOMATIONS_HEARTBEAT,
    ...(tools.has("set_thread_archived") ? [AUTOMATIONS_ARCHIVE] : []),
  ].join("\n")
}

const threadCoordination = (capabilities: CodexInstructionCapabilities): string | null => {
  const { tools } = capabilities
  if (!tools.has("read_thread")) return null
  const sidebar = tools.has("create_sidebar_section")
  const listed = THREAD_TOOLS_ORDER.filter(
    (name) => tools.has(name) && !(sidebar && name === "set_thread_pinned")
  )
  const lines = [
    "### Thread Coordination",
    '- Treat the terms "task", "thread", "chat", and "conversation" as synonyms when they clearly refer to conversations in Codex. Use "chat" when referring to conversations in the product. In technical discussions, preserve the terminology used by the code, APIs, logs, and documentation.',
    `- When the user asks to create, fork, inspect, continue, hand off, pin, archive, unarchive, rename, or otherwise manage Codex threads, search for the relevant thread tool first: ${toolList(listed)}.`,
  ]
  if (tools.has("wait_threads")) {
    lines.push(
      "- When following another task's progress, prefer compact `wait_threads` snapshots over repeated `read_thread` calls. Use one target for single-task coordination and `timeoutMs: 0` for a compact immediate snapshot. `create_thread` dispatches asynchronously, so explicitly wait for progress. Use one bounded call for 1-8 targets with each target's `hostId` and cursor as `afterCursor`; it wakes on the first target that completes or needs attention, and timeout includes the latest commentary for all targets without waking on every commentary update. An up-to-date cursor suppresses already-delivered final text. Separate waits from one task may run serially. Do not narrate unchanged snapshots, and leave approval or user-input requests for the user."
    )
  }
  if (tools.has("create_thread")) {
    lines.push(
      "- Only use `create_thread` when the user explicitly asks to create a new thread. Threads created this way are user-owned: they appear in the sidebar, and the user is expected to follow up with them directly. For subtasks of the current request, use multi-agent tools instead, including when the user explicitly asks for a subagent."
    )
    if (capabilities.createdThreadDirective) {
      lines.push(
        '- After a successful `create_thread` call, emit `::created-thread{threadId="..."}` for a created thread or `::created-thread{clientThreadId="..."}` for queued worktree setup on its own line in your final response.'
      )
    }
  }
  return lines.join("\n")
}

const worktrees = (tools: ReadonlySet<string>): string | null => {
  const all = ["create_worktree", "archive_worktree", "restore_worktree", "list_artifacts"]
  if (!all.every((name) => tools.has(name))) return null
  return [
    "### Worktrees",
    "- Follow applicable user, repository, and skill instructions when deciding whether and how to create a worktree.",
    "- Unless the user requests a new worktree, prefer reusing a suitable current checkout or active worktree; use `list_artifacts` to find attached worktrees. An existing worktree's name need not match the new task.",
    "- Prefer `create_worktree` for new worktrees. For worktrees created with it, use `archive_worktree` when they are no longer needed. Use `restore_worktree` to recover archived work.",
  ].join("\n")
}

const sidebarOrganization = (tools: ReadonlySet<string>): string | null => {
  if (!tools.has("read_thread") || !tools.has("create_sidebar_section")) return null
  return [
    "### Sidebar Organization",
    `- Use \`list_threads\` to inspect pinned, custom, project, and task sidebar sections, and \`list_projects\` for project details. Use ${toolList(SIDEBAR_TOOLS_ORDER.filter((name) => tools.has(name)))} to organize tasks and projects. Moving an item into the pinned section pins it.`,
  ].join("\n")
}

/** `### Git`, from the same three Settings fields as the official desktop. */
export const codexGitSection = (settings: GitSettings): string => {
  const lines: string[] = []
  const branchPrefix = settings.branchPrefix.trim()
  const commit = settings.commitInstructions.trim()
  const pullRequest = settings.prInstructions.trim()
  if (branchPrefix) {
    lines.push(
      `- Branch prefix: \`${branchPrefix}\`. Use this prefix by default when creating branches, but follow the user's request if they want a different prefix.`
    )
  }
  if (commit) lines.push(`- Commit instructions: ${commit}`)
  if (pullRequest) lines.push(`- Pull request instructions: ${pullRequest}`)
  return lines.length === 0 ? "" : `### Git\n${lines.join("\n")}`
}

/** `### Projectless Chat`, naming the generated directory and where outputs belong. */
export const codexProjectlessSection = (input: {
  cwd: string
  outputsDirectory: string
}): string => {
  const outputs = input.outputsDirectory
  return [
    "### Projectless Chat",
    "This projectless thread starts in a generated directory under the user's Documents/Cypheria folder.",
    "The generated directory name is only a filesystem identifier. Do not infer the user's language, locale, or preferences from its name or path, even if it resembles a language code such as 'ru'.",
    "Prefer answering inline in chat unless using local files would make the result more useful.",
    ...(outputs !== input.cwd
      ? [
          `Use work/ for intermediate files, scratch analysis, scripts, drafts, and temporary assets. Use ${outputs} only for user-facing deliverables that should appear as outputs.`,
          `When referring to saved deliverables in the final response, link only files from ${outputs}.`,
        ]
      : [
          `When using local files for this projectless thread, write scratch files, drafts, generated assets, and other outputs under ${outputs}.`,
        ]),
    "Do not write directly in the home directory unless the user explicitly asks.",
  ].join("\n")
}

export type CodexDeveloperInstructionsInput = {
  readonly capabilities: CodexInstructionCapabilities
  /** The Thread's working directory is inside a Git repository. */
  readonly isGitWorkspace: boolean
  readonly git: GitSettings
  /** Present for a Thread that belongs to no Project. */
  readonly projectless?: { readonly cwd: string; readonly outputsDirectory: string }
}

export const buildCodexDeveloperInstructions = (input: CodexDeveloperInstructionsInput): string => {
  const { capabilities } = input
  const { tools } = capabilities
  const context = join(
    desktopContext(capabilities),
    capabilities.prDiffLinks ? PULL_REQUEST_DIFF_LINKS.join("\n") : null,
    automations(tools),
    threadCoordination(capabilities),
    worktrees(tools),
    sidebarOrganization(tools),
    capabilities.codeComments ? INLINE_CODE_COMMENTS.join("\n") : null,
    capabilities.artifactFollowUps ? INLINE_ARTIFACT_FOLLOW_UPS.join("\n") : null,
    input.isGitWorkspace ? codexGitSection(input.git) : null
  )
  return join(
    `<app-context>\n${context}\n</app-context>`,
    input.projectless ? codexProjectlessSection(input.projectless) : null
  )
}
