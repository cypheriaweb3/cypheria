import type { CypheriaAgentProviderSettings } from "./provider.js"

export type NativeProviderSettings = Omit<CypheriaAgentProviderSettings, "agentId">
