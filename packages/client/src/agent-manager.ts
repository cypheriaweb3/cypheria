import type {
  AgentId,
  AgentCatalogEntry,
  AgentOperation,
  AgentRegistrySyncState,
  AgentView,
  ToolchainId,
  ToolchainView,
} from "@cypheria/protocol"
import { gt, valid } from "semver"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

/** Returns whether an installed agent has a newer valid semantic version available. */
export const isAgentUpdateAvailable = (
  agent: Pick<AgentView, "availableVersion" | "installed" | "version">
): boolean => {
  if (!agent.installed || agent.availableVersion === null) return false
  if (valid(agent.version) === null || valid(agent.availableVersion) === null) return false
  return gt(agent.availableVersion, agent.version)
}

type ResultPayload<T> =
  | { ok: true; value: T }
  | { error: { code: string; message: string }; ok: false }

const unwrap = <T>(payload: unknown): T => {
  const result = payload as ResultPayload<T>
  if (result.ok) return result.value
  const error = new Error(result.error.message)
  error.name = result.error.code
  throw error
}

export interface AgentManagementActions {
  add(agentId: AgentId, options?: RequestOptions): Promise<AgentView>
  checkToolchainUpdates(options?: RequestOptions): Promise<ToolchainView[]>
  get(agentId: AgentId, options?: RequestOptions): Promise<AgentView>
  getOperation(operationId: string, options?: RequestOptions): Promise<AgentOperation>
  install(agentId: AgentId, options?: RequestOptions): Promise<AgentOperation>
  list(options?: RequestOptions): Promise<{
    agents: AgentView[]
    availableAgents: AgentCatalogEntry[]
    registry: AgentRegistrySyncState
  }>
  listOperations(options?: RequestOptions): Promise<AgentOperation[]>
  listToolchains(options?: RequestOptions): Promise<ToolchainView[]>
  refreshRegistry(options?: RequestOptions): Promise<AgentRegistrySyncState>
  enable(agentId: AgentId, options?: RequestOptions): Promise<AgentView>
  disable(agentId: AgentId, options?: RequestOptions): Promise<AgentView>
  start(agentId: AgentId, options?: RequestOptions): Promise<AgentView>
  stop(agentId: AgentId, force?: boolean, options?: RequestOptions): Promise<AgentView>
  uninstall(agentId: AgentId, options?: RequestOptions): Promise<AgentOperation>
  update(agentId: AgentId, options?: RequestOptions): Promise<AgentOperation>
  updateToolchain(toolchain: ToolchainId, options?: RequestOptions): Promise<AgentOperation>
}

export const createAgentManagementActions = (client: ServerClient): AgentManagementActions => ({
  add: async (agentId, options) =>
    unwrap<AgentView>(
      (await client.requestAgentManagement("agent.add.request", { agentId }, options)).payload
    ),
  checkToolchainUpdates: async (options) =>
    unwrap<{ toolchains: ToolchainView[] }>(
      (
        await client.requestAgentManagement(
          "agent.toolchain.check_updates.request",
          undefined,
          options
        )
      ).payload
    ).toolchains,
  get: async (agentId, options) =>
    unwrap<AgentView>(
      (await client.requestAgentManagement("agent.get.request", { agentId }, options)).payload
    ),
  getOperation: async (operationId, options) =>
    unwrap<AgentOperation>(
      (await client.requestAgentManagement("agent.operation.get.request", { operationId }, options))
        .payload
    ),
  install: async (agentId, options) =>
    unwrap<AgentOperation>(
      (await client.requestAgentManagement("agent.install.request", { agentId }, options)).payload
    ),
  list: async (options) =>
    unwrap<{
      agents: AgentView[]
      availableAgents: AgentCatalogEntry[]
      registry: AgentRegistrySyncState
    }>(
      (await client.requestAgentManagement("agent.list.request", undefined, options)).payload
    ),
  listOperations: async (options) =>
    unwrap<{ operations: AgentOperation[] }>(
      (await client.requestAgentManagement("agent.operation.list.request", undefined, options))
        .payload
    ).operations,
  listToolchains: async (options) =>
    unwrap<{ toolchains: ToolchainView[] }>(
      (await client.requestAgentManagement("agent.toolchain.list.request", undefined, options))
        .payload
    ).toolchains,
  refreshRegistry: async (options) =>
    unwrap<AgentRegistrySyncState>(
      (await client.requestAgentManagement("agent.registry.refresh.request", undefined, options))
        .payload
    ),
  enable: async (agentId, options) =>
    unwrap<AgentView>(
      (await client.requestAgentManagement("agent.enable.request", { agentId }, options)).payload
    ),
  disable: async (agentId, options) =>
    unwrap<AgentView>(
      (await client.requestAgentManagement("agent.disable.request", { agentId }, options)).payload
    ),
  start: async (agentId, options) =>
    unwrap<AgentView>(
      (await client.requestAgentManagement("agent.start.request", { agentId }, options)).payload
    ),
  stop: async (agentId, force = false, options) =>
    unwrap<AgentView>(
      (await client.requestAgentManagement("agent.stop.request", { agentId, force }, options))
        .payload
    ),
  uninstall: async (agentId, options) =>
    unwrap<AgentOperation>(
      (await client.requestAgentManagement("agent.uninstall.request", { agentId }, options)).payload
    ),
  update: async (agentId, options) =>
    unwrap<AgentOperation>(
      (await client.requestAgentManagement("agent.update.request", { agentId }, options)).payload
    ),
  updateToolchain: async (toolchain, options) =>
    unwrap<AgentOperation>(
      (
        await client.requestAgentManagement(
          "agent.toolchain.update.request",
          { toolchain },
          options
        )
      ).payload
    ),
})
