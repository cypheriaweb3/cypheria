import { createCypheriaAgentProvider } from "../provider.js"
import type { NativeProviderSettings } from "../types.js"

export type ClaudeProviderSettings = NativeProviderSettings

export const createClaude = (settings: ClaudeProviderSettings) =>
  createCypheriaAgentProvider({ ...settings, agentId: "claude" })
