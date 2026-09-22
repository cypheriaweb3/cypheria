import {
  ACP_AGENT_REGISTRY,
  type AgentRegistryEntry,
  isRegistryAgentId,
  type RegistryAgentId,
} from "@cypheria/protocol"

type AvailableRegistryEntry = AgentRegistryEntry & { id: RegistryAgentId }

/**
 * Exposes the reviewed ACP registry bundled with this Cypheria release.
 *
 * This service deliberately has no filesystem cache, URL, timer, or fetch
 * dependency. Agent availability and update decisions cannot change without a
 * new Cypheria build containing a newly reviewed registry snapshot.
 */
export class AgentRegistryService {
  get entries(): readonly AvailableRegistryEntry[] {
    return ACP_AGENT_REGISTRY.agents.filter((entry): entry is AvailableRegistryEntry =>
      isRegistryAgentId(entry.id)
    )
  }

  get(id: string): AvailableRegistryEntry | undefined {
    if (!isRegistryAgentId(id)) return undefined
    return this.entries.find((agent) => agent.id === id)
  }
}
