import type { AgentId } from "@cypheria/protocol"

export type NativeAgentManifestEntry = {
  cliPackage: string
  cliVersion: string
  description: string
  icon: string | null
  launcher: "executable" | "node"
  name: string
  repository: string
  runtimeScope: "thread" | "shared"
  website: string
}

export const NATIVE_AGENT_MANIFEST = {
  claude: {
    cliPackage: "@anthropic-ai/claude-code",
    cliVersion: "2.1.278",
    description:
      "Claude Code is an agentic coding tool that reads codebases, edits files, runs commands, and integrates with development tools.",
    icon: null,
    launcher: "executable",
    name: "Claude Code",
    repository: "https://github.com/anthropics/claude-code",
    runtimeScope: "thread",
    website: "https://code.claude.com/docs/en/overview",
  },
  codex: {
    cliPackage: "@openai/codex",
    cliVersion: "0.155.1",
    description: "Codex is a coding agent from OpenAI that runs locally on your computer.",
    icon: null,
    launcher: "node",
    name: "Codex",
    repository: "https://github.com/openai/codex",
    runtimeScope: "shared",
    website: "https://developers.openai.com/codex/",
  },
  opencode: {
    cliPackage: "@opencode/cli",
    cliVersion: "2.0.11",
    description:
      "OpenCode is an open source agent that helps you write code in your terminal, IDE, or desktop.",
    icon: null,
    launcher: "executable",
    name: "OpenCode",
    repository: "https://github.com/anomalyco/opencode",
    runtimeScope: "shared",
    website: "https://opencode.ai/v2/docs/",
  },
  pi: {
    cliPackage: "@earendil-works/pi-coding-agent",
    cliVersion: "0.86.1",
    description: "Pi is a minimal agent harness that adapts to your workflows.",
    icon: null,
    launcher: "node",
    name: "Pi",
    repository: "https://github.com/earendil-works/pi",
    runtimeScope: "thread",
    website: "https://pi.dev",
  },
} as const satisfies Record<
  AgentId & ("claude" | "codex" | "opencode" | "pi"),
  NativeAgentManifestEntry
>
