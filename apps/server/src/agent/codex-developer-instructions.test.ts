import { readFileSync } from "node:fs"
import { DEFAULT_GIT_SETTINGS, type GitSettings } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import {
  buildCodexDeveloperInstructions,
  CODEX_APP_TOOL_NAMES,
  type CodexInstructionCapabilities,
  CYPHERIA_RENDERING_CAPABILITIES,
  codexGitSection,
  codexProjectlessSection,
  NO_CODEX_INSTRUCTION_CAPABILITIES,
} from "./codex-developer-instructions.js"

/** Text the official Codex desktop (ChatGPT 26.928.31416) produces, evaluated from its bundle. */
const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}.txt`, import.meta.url), "utf8").replaceAll(
    "codex://review",
    "cypheria://review"
  )

const git: GitSettings = {
  ...DEFAULT_GIT_SETTINGS,
  branchPrefix: "codex/",
  commitInstructions: "Use Conventional Commits.",
  prInstructions: "Link the issue in the description.",
}

const noGitSettings: GitSettings = {
  ...DEFAULT_GIT_SETTINGS,
  branchPrefix: "",
  commitInstructions: "",
  prInstructions: "",
}

const everything: CodexInstructionCapabilities = {
  artifactFollowUps: true,
  codeComments: true,
  createdThreadDirective: true,
  fileLinks: true,
  media: true,
  prDiffLinks: true,
  tools: new Set(CODEX_APP_TOOL_NAMES),
}

const withTools = (...names: string[]): CodexInstructionCapabilities => ({
  ...everything,
  tools: new Set(names),
})

describe("buildCodexDeveloperInstructions", () => {
  it("matches the official text byte for byte with every capability", () => {
    expect(
      buildCodexDeveloperInstructions({ capabilities: everything, git, isGitWorkspace: true })
    ).toBe(fixture("chatgpt-app-context-full"))
  })

  it("matches the official text without worktree and sidebar tools", () => {
    expect(
      buildCodexDeveloperInstructions({
        capabilities: withTools(
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
          "set_thread_title"
        ),
        git,
        isGitWorkspace: true,
      })
    ).toBe(fixture("chatgpt-app-context-threads"))
  })

  it("matches the official text outside a Git repository", () => {
    expect(
      buildCodexDeveloperInstructions({ capabilities: everything, git, isGitWorkspace: false })
    ).not.toContain("### Git")
  })

  it("promises nothing a client cannot do when no capability is on", () => {
    const text = buildCodexDeveloperInstructions({
      capabilities: NO_CODEX_INSTRUCTION_CAPABILITIES,
      git: noGitSettings,
      isGitWorkspace: true,
    })
    expect(text).toBe(
      [
        "<app-context>",
        "# Codex desktop context",
        "- You are running inside the Codex (desktop) app, which allows some additional features not available in the CLI alone:",
        "",
        "### Images/Visuals/Files",
        "- Return web URLs as Markdown links (e.g., [label](https://example.com)).",
        "</app-context>",
      ].join("\n")
    )
  })

  it("states what the first-party clients render and no app tool", () => {
    const text = buildCodexDeveloperInstructions({
      capabilities: { ...CYPHERIA_RENDERING_CAPABILITIES, tools: new Set() },
      git: noGitSettings,
      isGitWorkspace: false,
    })
    expect(text).toContain("![alt](url)")
    expect(text).toContain("always use full absolute file paths")
    expect(text).toContain("### Inline Code Comments")
    expect(text).toContain("### Inline Artifact Follow-Ups")
    expect(text).not.toContain("### Pull request diff links")
    expect(text).not.toContain("### Thread Coordination")
    expect(text).not.toContain("::created-thread")
  })

  it("adds one sentence per capability, in the official order", () => {
    const text = buildCodexDeveloperInstructions({
      capabilities: { ...NO_CODEX_INSTRUCTION_CAPABILITIES, fileLinks: true },
      git: DEFAULT_GIT_SETTINGS,
      isGitWorkspace: false,
    })
    expect(text).toContain(
      "- When referencing code or workspace files in responses, always use full absolute file paths instead of relative paths.\n- Return web URLs as Markdown links"
    )
    expect(text).not.toContain("![alt](url)")
    expect(text).not.toContain("### Inline Code Comments")
    expect(text).not.toContain("cypheria://review")
  })

  it("lists only the thread tools that exist", () => {
    const text = buildCodexDeveloperInstructions({
      capabilities: withTools("read_thread", "list_threads", "create_thread"),
      git: DEFAULT_GIT_SETTINGS,
      isGitWorkspace: false,
    })
    expect(text).toContain(
      "search for the relevant thread tool first: `create_thread`, `list_threads`, or `read_thread`."
    )
    expect(text).not.toContain("wait_threads")
    expect(text).not.toContain("### Automations")
    expect(text).not.toContain("### Worktrees")
  })

  it("drops the pin tool from the thread list when sidebar tools pin instead", () => {
    const text = buildCodexDeveloperInstructions({
      capabilities: withTools("read_thread", "set_thread_pinned", "create_sidebar_section"),
      git: DEFAULT_GIT_SETTINGS,
      isGitWorkspace: false,
    })
    expect(text).not.toContain("`set_thread_pinned`")
    expect(text).toContain("### Sidebar Organization")
  })

  it("places the projectless section after the app context", () => {
    const text = buildCodexDeveloperInstructions({
      capabilities: NO_CODEX_INSTRUCTION_CAPABILITIES,
      git: DEFAULT_GIT_SETTINGS,
      isGitWorkspace: false,
      projectless: { cwd: "/w/2026-10-01/x", outputsDirectory: "/w/2026-10-01/x/outputs" },
    })
    expect(text.indexOf("</app-context>")).toBeLessThan(text.indexOf("### Projectless Chat"))
    expect(text.endsWith("unless the user explicitly asks.")).toBe(true)
  })
})

describe("codexProjectlessSection", () => {
  const reword = (text: string) => text.replaceAll("Documents/Codex", "Documents/Cypheria")

  it("matches the official text with split outputs", () => {
    expect(
      codexProjectlessSection({
        cwd: "/work/2026-10-01/fix-the-login-bug",
        outputsDirectory: "/work/2026-10-01/fix-the-login-bug/outputs",
      })
    ).toBe(reword(fixture("chatgpt-projectless")))
  })

  it("matches the official text when outputs are the working directory", () => {
    expect(
      codexProjectlessSection({
        cwd: "/work/2026-10-01/fix-the-login-bug",
        outputsDirectory: "/work/2026-10-01/fix-the-login-bug",
      })
    ).toBe(reword(fixture("chatgpt-projectless-unsplit")))
  })
})

describe("codexGitSection", () => {
  it("is empty without settings and trims each field", () => {
    expect(codexGitSection(noGitSettings)).toBe("")
    expect(codexGitSection({ ...git, commitInstructions: "  Be brief.  " })).toContain(
      "- Commit instructions: Be brief.\n"
    )
  })
})
