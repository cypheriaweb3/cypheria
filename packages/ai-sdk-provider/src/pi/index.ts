import { createCypheriaAgentProvider } from "../provider.js"
import type { NativeProviderSettings } from "../types.js"

export type PiProviderSettings = NativeProviderSettings

export const createPi = (settings: PiProviderSettings) =>
  createCypheriaAgentProvider({ ...settings, agentId: "pi" })
