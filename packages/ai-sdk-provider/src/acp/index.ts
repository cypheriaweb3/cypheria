import type { RegistryAgentId } from "@cypheria/protocol"
import type { CypheriaAgentProviderSettings } from "../provider.js"
import { createCypheriaAgentProvider } from "../provider.js"

export type AcpProviderSettings = Omit<CypheriaAgentProviderSettings, "agentId"> & {
  readonly agentId: RegistryAgentId
}

export const createAcp = (settings: AcpProviderSettings) => createCypheriaAgentProvider(settings)
