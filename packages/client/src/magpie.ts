import type {
  AgentId,
  MagpieAgentView,
  MagpieClientMessage,
  MagpieConfigPatch,
  MagpieGroupView,
  MagpieProviderView,
  MagpieServerMessage,
  MagpieServiceView,
  MagpieUsagePeriod,
  MagpieUsageSummary,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type ResultPayload<T> =
  | { ok: true; value: T }
  | { error: { code: string; message: string }; ok: false }

const unwrap = <T>(message: MagpieServerMessage): T => {
  const payload = message.payload as ResultPayload<T>
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

/** The magpie gateway the Server runs over Cypheria's Agents. */
export interface MagpieActions {
  getStatus(options?: RequestOptions): Promise<MagpieServiceView>
  install(options?: RequestOptions): Promise<MagpieServiceView>
  /** Turning it on installs and starts magpie; off stops it. */
  setConfig(patch: MagpieConfigPatch, options?: RequestOptions): Promise<MagpieServiceView>
  restart(options?: RequestOptions): Promise<MagpieServiceView>
  listAgents(options?: RequestOptions): Promise<MagpieAgentView[]>
  setAgentField(
    agentId: AgentId,
    field: string,
    value: string,
    options?: RequestOptions
  ): Promise<MagpieAgentView[]>
  reapplyAgent(agentId: AgentId, options?: RequestOptions): Promise<MagpieAgentView[]>
  listProviders(options?: RequestOptions): Promise<MagpieProviderView[]>
  listGroups(options?: RequestOptions): Promise<MagpieGroupView[]>
  getUsage(period: MagpieUsagePeriod, options?: RequestOptions): Promise<MagpieUsageSummary>
}

export const createMagpieActions = (client: ServerClient): MagpieActions => {
  const request = async <T>(
    type: MagpieClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestMagpie(type, payload, options))

  return {
    getStatus: (options) => request("magpie.status.get.request", {}, options),
    getUsage: (period, options) => request("magpie.usage.get.request", { period }, options),
    install: (options) => request("magpie.install.request", {}, options),
    listAgents: async (options) =>
      (await request<{ agents: MagpieAgentView[] }>("magpie.agents.list.request", {}, options))
        .agents,
    listGroups: async (options) =>
      (await request<{ groups: MagpieGroupView[] }>("magpie.groups.list.request", {}, options))
        .groups,
    listProviders: async (options) =>
      (
        await request<{ providers: MagpieProviderView[] }>(
          "magpie.providers.list.request",
          {},
          options
        )
      ).providers,
    reapplyAgent: async (agentId, options) =>
      (
        await request<{ agents: MagpieAgentView[] }>(
          "magpie.agent.reapply.request",
          { agentId },
          options
        )
      ).agents,
    restart: (options) => request("magpie.restart.request", {}, options),
    setAgentField: async (agentId, field, value, options) =>
      (
        await request<{ agents: MagpieAgentView[] }>(
          "magpie.agent.set.request",
          { agentId, field, value },
          options
        )
      ).agents,
    setConfig: (patch, options) => request("magpie.config.set.request", { patch }, options),
  }
}
