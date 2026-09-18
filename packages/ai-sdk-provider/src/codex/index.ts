import { createCypheriaAgentProvider } from "../provider.js"
import type { NativeProviderSettings } from "../types.js"

export type CodexProviderSettings = NativeProviderSettings

export const createCodex = (settings: CodexProviderSettings) =>
  createCypheriaAgentProvider({ ...settings, agentId: "codex" })
