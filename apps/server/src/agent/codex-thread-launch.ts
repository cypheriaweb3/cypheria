import type { ThreadConfig } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

import type { CodexPermissionFields } from "./codex-permissions.js"

/**
 * `thread/start`, `thread/resume`, and `thread/fork` parameters, composed the way the official
 * Codex desktop composes them. These are pure functions of explicit inputs.
 */

export const CODEX_REQUEST_PERMISSIONS_TOOL = "features.request_permissions_tool"

export type CodexLaunchInput = {
  readonly config: ThreadConfig
  readonly cwd: string | null
  readonly developerInstructions?: string
  readonly permissions: CodexPermissionFields
  readonly workspaceRoots?: readonly string[]
  /** Extra `config` overrides, such as the managed shell environment of a worktree. */
  readonly worktreeConfig?: Record<string, unknown>
}

/**
 * The `config` overrides of a Thread. They are overrides only: Codex still loads the user's
 * `config.toml`. Cypheria sends nothing about features, tools, or MCP here, because those come from
 * Codex's own configuration and the managed plugins.
 */
export const codexThreadConfig = (input: CodexLaunchInput): Record<string, unknown> => ({
  ...(input.worktreeConfig ?? {}),
  ...(input.config.thinking ? { model_reasoning_effort: input.config.thinking } : {}),
  [CODEX_REQUEST_PERMISSIONS_TOOL]: true,
})

const sharedFields = (input: CodexLaunchInput) => ({
  ...(input.config.model ? { model: input.config.model } : {}),
  ...(input.config.speed ? { serviceTier: input.config.speed } : {}),
  ...input.permissions,
  ...(input.cwd ? { cwd: input.cwd } : {}),
  ...(input.workspaceRoots ? { runtimeWorkspaceRoots: [...input.workspaceRoots] } : {}),
  config: codexThreadConfig(input),
})

/** A new, durable Thread whose history the Server pages with `thread/turns/list`. */
export const codexThreadStartParams = (
  input: CodexLaunchInput & { readonly dynamicTools: readonly v2.DynamicToolSpec[] }
): Omit<v2.ThreadStartParams, "config"> & { config: Record<string, unknown> } => ({
  ...sharedFields(input),
  ...(input.developerInstructions ? { developerInstructions: input.developerInstructions } : {}),
  dynamicTools: [...input.dynamicTools],
  historyMode: "paginated",
  threadSource: "user",
})

export const codexThreadResumeParams = (
  input: CodexLaunchInput & { readonly threadId: string }
): Omit<v2.ThreadResumeParams, "config"> & { config: Record<string, unknown> } => ({
  ...sharedFields(input),
  ...(input.developerInstructions ? { developerInstructions: input.developerInstructions } : {}),
  excludeTurns: true,
  threadId: input.threadId,
})

/**
 * A fork inherits the instructions recorded in the source history, so it states none of its own.
 * The source `threadId` is added by the caller.
 */
export const codexThreadForkParams = (
  input: CodexLaunchInput
): Omit<v2.ThreadForkParams, "config" | "threadId"> & { config: Record<string, unknown> } => ({
  ...sharedFields(input),
  excludeTurns: true,
  threadSource: "user",
})
