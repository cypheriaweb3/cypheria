import type {
  CodexModelSettings,
  CodexProviderClientMessage,
  CodexProviderServerMessage,
} from "@cypheria/protocol"

import type { AgentManager } from "./agent/agent-manager.js"
import type { v2 } from "./codex-bridge/index.js"
import type { ServerConfigStore } from "./server-config-store.js"

export class CodexProviderService {
  readonly #agents: AgentManager
  readonly #config: ServerConfigStore

  constructor(agents: AgentManager, config: ServerConfigStore) {
    this.#agents = agents
    this.#config = config
  }

  async handle(
    message: CodexProviderClientMessage,
    send: (message: CodexProviderServerMessage) => void
  ): Promise<boolean> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as CodexProviderServerMessage)
    }
    try {
      switch (message.type) {
        case "provider.codex.account.get.request":
          respond(await this.#account(message.payload.refresh ?? false))
          break
        case "provider.codex.account.login.request":
          respond(await this.#login(message.payload))
          break
        case "provider.codex.account.login.cancel.request": {
          const result = await this.#call<v2.CancelLoginAccountResponse>("account/login/cancel", {
            loginId: message.payload.loginId,
          })
          respond({ cancelled: result.status === "canceled" })
          break
        }
        case "provider.codex.account.logout.request":
          await this.#call("account/logout")
          respond({ succeeded: true })
          break
        case "provider.codex.model.list.request":
          respond({ models: await this.#models(message.payload.includeHidden ?? false) })
          break
        case "provider.codex.model-settings.get.request":
          respond(this.#settings())
          break
        case "provider.codex.model-settings.set.request":
          respond(await this.#setSettings(message.payload))
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: { code: failure.name || "CODEX_PROVIDER_ERROR", message: failure.message },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as CodexProviderServerMessage)
    }
    return true
  }

  async #call<Result>(
    method: Parameters<AgentManager["callCodex"]>[0],
    params?: Record<string, unknown>
  ): Promise<Result> {
    return (await this.#agents.callCodex(method, params)) as Result
  }

  async #account(refresh: boolean) {
    const response = await this.#call<v2.GetAccountResponse>("account/read", {
      refreshToken: refresh,
    })
    return {
      email: response.account?.type === "chatgpt" ? response.account.email : null,
      planType: response.account?.type === "chatgpt" ? String(response.account.planType) : null,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      type: response.account?.type ?? null,
    }
  }

  async #login(input: { apiKey?: string; type: "apiKey" | "chatgpt" }) {
    const params: v2.LoginAccountParams =
      input.type === "chatgpt"
        ? {
            appBrand: "codex",
            codexStreamlinedLogin: true,
            type: "chatgpt",
            useHostedLoginSuccessPage: true,
          }
        : { apiKey: input.apiKey as string, type: "apiKey" }
    const response = await this.#call<v2.LoginAccountResponse>("account/login/start", params)
    if (response.type !== "apiKey" && response.type !== "chatgpt") {
      throw new Error(`Unsupported Codex login response: ${response.type}`)
    }
    return response
  }

  async #models(includeHidden: boolean) {
    const models: v2.Model[] = []
    let cursor: string | null = null
    do {
      const response: v2.ModelListResponse = await this.#call<v2.ModelListResponse>("model/list", {
        cursor,
        includeHidden,
        limit: 100,
      })
      models.push(...response.data)
      cursor = response.nextCursor
    } while (cursor)
    return models.map((model) => ({
      defaultReasoningEffort: model.defaultReasoningEffort,
      defaultServiceTier: model.defaultServiceTier,
      description: model.description,
      displayName: model.displayName,
      hidden: model.hidden,
      id: model.id,
      inputModalities: model.inputModalities.map(String),
      isDefault: model.isDefault,
      model: model.model,
      reasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
        description: effort.description,
        value: effort.reasoningEffort,
      })),
      serviceTiers: model.serviceTiers,
    }))
  }

  #settings(): CodexModelSettings {
    return this.#config.getSnapshot().config.agents.codex
  }

  async #setSettings(settings: CodexModelSettings): Promise<CodexModelSettings> {
    await this.#config.patch({ agents: { codex: settings } })
    await this.#call("config/batchWrite", {
      edits: [
        { keyPath: "model_provider", mergeStrategy: "replace", value: settings.provider },
        { keyPath: "model", mergeStrategy: "replace", value: settings.model },
        {
          keyPath: "model_reasoning_effort",
          mergeStrategy: "replace",
          value: settings.reasoningEffort,
        },
        { keyPath: "service_tier", mergeStrategy: "replace", value: settings.serviceTier },
      ],
      reloadUserConfig: true,
    })
    return this.#settings()
  }
}
