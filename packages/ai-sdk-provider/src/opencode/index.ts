import { createCypheriaAgentProvider } from "../provider.js"
import type { NativeProviderSettings } from "../types.js"

export type OpenCodeProviderSettings = NativeProviderSettings

export const createOpenCode = (settings: OpenCodeProviderSettings) =>
  createCypheriaAgentProvider({ ...settings, agentId: "opencode" })
