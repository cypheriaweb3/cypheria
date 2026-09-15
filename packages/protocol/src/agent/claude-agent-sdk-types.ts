/**
 * Type-only access to the pinned Claude Agent SDK surface.
 *
 * Runtime use of the SDK remains a server concern; protocol clients can depend on these types
 * without importing the Claude Code process implementation.
 */
export type * from "@anthropic-ai/claude-agent-sdk"

export type {
  ClaudeForkSessionOptions,
  ClaudeGetSessionInfoOptions,
  ClaudeGetSessionMessagesOptions,
  ClaudeGetSubagentMessagesOptions,
  ClaudeListSessionsOptions,
  ClaudeListSubagentsOptions,
  ClaudeMcpServerConfig,
  ClaudeQueryOptions,
  ClaudeResolveSettingsOptions,
  ClaudeSessionMutationOptions,
  ClaudeWarmQueryOptions,
} from "./claude.ts"
