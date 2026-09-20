import { randomUUID } from "node:crypto"
import {
  type AgentId,
  type HarnessAuthFlow,
  type HarnessCatalogSnapshot,
  type HarnessClientMessage,
  type HarnessServerMessage,
  type HarnessSettingDefinition,
  type HarnessSettingSection,
  isNativeAgentId,
  type ServerMessage,
} from "@cypheria/protocol"

import type { AgentManager } from "./agent/agent-manager.js"
import type { CodexHarnessService } from "./codex-harness-service.js"
import { HarnessCatalogManager } from "./harness-catalog-manager.js"
import type { ServerConfigStore } from "./server-config-store.js"
import type { TerminalService } from "./terminal-service.js"

type Send = (message: ServerMessage) => void

type PiAuthFlow = {
  controller: AbortController
  events: HarnessAuthFlow[]
  prompt?: { reject: (error: Error) => void; resolve: (value: string) => void }
  waiters: Array<(event: HarnessAuthFlow) => void>
}

const option = (value: string, label = value, description: string | null = null) => ({
  description,
  label,
  value,
})

const select = (
  id: string,
  label: string,
  value: string | null,
  options: ReturnType<typeof option>[],
  description: string | null = null
): HarnessSettingDefinition => ({
  defaultValue: null,
  description,
  id,
  label,
  options,
  type: "select",
  value,
})

const boolean = (
  id: string,
  label: string,
  value: boolean,
  description: string | null = null
): HarnessSettingDefinition => ({
  defaultValue: false,
  description,
  id,
  label,
  type: "boolean",
  value,
})

const number = (
  id: string,
  label: string,
  value: number | null,
  options: { defaultValue?: number | null; max?: number; min?: number; step?: number } = {},
  description: string | null = null
): HarnessSettingDefinition => ({
  defaultValue: options.defaultValue ?? null,
  description,
  id,
  label,
  max: options.max ?? null,
  min: options.min ?? null,
  step: options.step ?? null,
  type: "number",
  value,
})

const section = (
  id: string,
  label: string,
  order: number,
  settings: HarnessSettingDefinition[],
  description: string | null = null
): HarnessSettingSection => ({ description, id, label, order, settings })

const genericSections = (
  agentId: AgentId,
  values: Record<string, string | boolean | number | null>
): HarnessSettingSection[] => {
  if (agentId === "claude") {
    return [
      section("model-defaults", "Model defaults", 30, [
        select("model", "Default model", String(values.model ?? ""), []),
      ]),
      section("permissions", "Permissions", 40, [
        select("permissionMode", "Permission mode", String(values.permissionMode ?? "default"), [
          option("default", "Default"),
          option("acceptEdits", "Accept edits"),
          option("plan", "Plan"),
          option("dontAsk", "Don't ask"),
          option("bypassPermissions", "Bypass permissions"),
        ]),
      ]),
      section("thinking", "Thinking", 50, [
        select("thinkingMode", "Thinking mode", String(values.thinkingMode ?? "adaptive"), [
          option("adaptive", "Adaptive"),
          option("enabled", "Enabled"),
          option("disabled", "Disabled"),
        ]),
        select("effort", "Effort", String(values.effort ?? "high"), [
          option("low", "Low"),
          option("medium", "Medium"),
          option("high", "High"),
          option("max", "Max"),
        ]),
        number(
          "maxThinkingTokens",
          "Thinking budget",
          typeof values.maxThinkingTokens === "number" ? values.maxThinkingTokens : null,
          { min: 1024, step: 1024 }
        ),
      ]),
    ]
  }
  if (agentId === "opencode") {
    return [
      section("model-defaults", "Model defaults", 30, [
        select("model", "Default model", String(values.model ?? ""), []),
        select("variant", "Variant", String(values.variant ?? ""), []),
      ]),
      section("agent-defaults", "Agent defaults", 40, [
        select("agent", "Default agent", String(values.agent ?? ""), []),
        select("mode", "Default mode", String(values.mode ?? ""), []),
      ]),
    ]
  }
  if (agentId === "pi") {
    return [
      section("model-defaults", "Model defaults", 30, [
        select("provider", "Default provider", String(values.provider ?? ""), []),
        select("model", "Default model", String(values.model ?? ""), []),
      ]),
      section("thinking", "Thinking", 40, [
        select("thinkingLevel", "Thinking level", String(values.thinkingLevel ?? "medium"), [
          option("off", "Off"),
          option("minimal", "Minimal"),
          option("low", "Low"),
          option("medium", "Medium"),
          option("high", "High"),
          option("xhigh", "Extra high"),
        ]),
      ]),
    ]
  }
  return [section("general", "General", 30, [])]
}

export class HarnessService {
  readonly catalog: HarnessCatalogManager
  readonly #agents: AgentManager
  readonly #codex: CodexHarnessService
  readonly #config: ServerConfigStore
  readonly #terminals: TerminalService
  readonly #acpAuthMethods = new Map<
    AgentId,
    Array<{
      args: string[]
      description: string | null
      env: Record<string, string>
      id: string
      input: "none" | "terminal"
      label: string
    }>
  >()
  readonly #acpLogoutSupported = new Map<AgentId, boolean>()
  readonly #acpConnected = new Set<AgentId>()
  readonly #piAuthFlows = new Map<string, PiAuthFlow>()
  readonly #terminalAuthFlows = new Map<
    string,
    { agentId: AgentId; sessionId: string; terminalId: string }
  >()

  constructor(
    agents: AgentManager,
    codex: CodexHarnessService,
    config: ServerConfigStore,
    terminals: TerminalService
  ) {
    this.#agents = agents
    this.#codex = codex
    this.#config = config
    this.#terminals = terminals
    this.catalog = new HarnessCatalogManager((agentId, signal) => this.#discover(agentId, signal))
  }

  stop(): void {
    for (const flow of this.#piAuthFlows.values()) flow.controller.abort()
    this.#piAuthFlows.clear()
    for (const flow of this.#terminalAuthFlows.values()) {
      this.#terminals.close(flow.terminalId, flow.sessionId)
    }
    this.#terminalAuthFlows.clear()
    this.catalog.stop()
  }

  invalidate(agentId?: AgentId): void {
    this.catalog.invalidate(agentId)
  }

  async validatedDefaults(
    agentId: AgentId
  ): Promise<Record<string, string | boolean | number | null>> {
    if (agentId === "codex") return {}
    const saved = this.#config.getSnapshot().config.agents.defaults[agentId] ?? {}
    const snapshot = await this.catalog.get(agentId)
    const definitions = new Map(
      snapshot.settingSections.flatMap((entry) =>
        entry.settings.map((setting) => [setting.id, setting])
      )
    )
    return Object.fromEntries(
      Object.entries(saved).filter(([id, value]) => {
        const definition = definitions.get(id)
        if (!definition || value === null) return false
        if (definition.type === "boolean") return typeof value === "boolean"
        if (definition.type === "number") return typeof value === "number"
        return (
          typeof value === "string" && definition.options.some((option) => option.value === value)
        )
      })
    )
  }

  async handle(message: HarnessClientMessage, sessionId: string, send: Send): Promise<boolean> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as HarnessServerMessage)
    }
    try {
      switch (message.type) {
        case "harness.get.request":
          respond(await this.#view(message.payload.agentId))
          break
        case "harness.auth.start.request":
          respond(
            await this.#startAuth(
              message.payload.agentId,
              message.payload.methodId,
              message.payload.secret,
              sessionId,
              send
            )
          )
          break
        case "harness.auth.cancel.request":
          respond(
            await this.#cancelAuth(message.payload.agentId, message.payload.flowId, sessionId)
          )
          break
        case "harness.auth.respond.request":
          respond(
            await this.#respondAuth(
              message.payload.agentId,
              message.payload.flowId,
              message.payload.response
            )
          )
          break
        case "harness.auth.logout.request":
          await this.#logout(message.payload.agentId)
          respond({ succeeded: true })
          break
        case "harness.models.list.request":
        case "harness.settings.get.request":
          respond(await this.catalog.get(message.payload.agentId, message.payload.refresh ?? false))
          break
        case "harness.settings.update.request":
          respond(await this.#updateSettings(message.payload.agentId, message.payload.values))
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: { code: failure.name || "HARNESS_ERROR", message: failure.message },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as HarnessServerMessage)
    }
    return true
  }

  async #view(agentId: AgentId) {
    await this.#agents.get(agentId, "harness-settings")
    if (agentId === "codex") {
      const account = await this.#codex.account(false)
      return {
        agentId,
        authMethods: [
          { description: null, id: "apiKey", input: "secret" as const, label: "API key" },
          { description: null, id: "chatgpt", input: "none" as const, label: "ChatGPT" },
          {
            description: null,
            id: "chatgptDeviceCode",
            input: "none" as const,
            label: "ChatGPT device code",
          },
        ],
        connected: account.type !== null,
        detail: account.email ?? account.type,
        logoutSupported: account.type !== null,
      }
    }
    if (agentId === "claude") {
      const catalog = await this.#agents.getClaudeCatalog()
      return {
        agentId,
        authMethods: [
          {
            description: "Sign in with a Claude subscription.",
            id: "subscription",
            input: "terminal" as const,
            label: "Claude account with subscription",
          },
          {
            description: "Sign in with your Console account.",
            id: "console",
            input: "terminal" as const,
            label: "Anthropic Console account",
          },
        ],
        connected: Boolean(catalog.account.email || catalog.account.organization),
        detail:
          catalog.account.email ??
          catalog.account.organization ??
          catalog.account.apiProvider ??
          null,
        logoutSupported: true,
      }
    }
    if (agentId === "pi") {
      const catalog = await this.#agents.getPiCatalog()
      const connected = new Set(catalog.credentials.map((credential) => credential.providerId))
      return {
        agentId,
        authMethods: catalog.providers.flatMap((provider) => [
          ...(provider.auth.oauth
            ? [
                {
                  description: null,
                  id: `pi:${provider.id}:oauth`,
                  input: "none" as const,
                  label: `${provider.name} — ${provider.auth.oauth}`,
                },
              ]
            : []),
          ...(provider.auth.apiKey
            ? [
                {
                  description: null,
                  id: `pi:${provider.id}:api_key`,
                  input: "secret" as const,
                  label: `${provider.name} — ${provider.auth.apiKey}`,
                },
              ]
            : []),
        ]),
        connected: connected.size > 0,
        detail:
          connected.size > 0
            ? catalog.providers
                .filter((provider) => connected.has(provider.id))
                .map((provider) => provider.name)
                .join(", ")
            : null,
        logoutSupported: true,
      }
    }
    if (agentId === "opencode") {
      const authResult = await this.#agents.callOpenCode("integration.list")
      if (!authResult.ok) throw new Error(`OpenCode auth discovery failed (${authResult.status})`)
      const integrations = ((authResult.data as { data?: unknown[] })?.data ?? []) as Array<{
        connections: Array<{ id?: string; type: "credential" | "env" }>
        id: string
        methods: Array<{
          id?: string
          label?: string
          type: "command" | "env" | "key" | "oauth"
        }>
        name: string
      }>
      const connected = integrations.filter((integration) => integration.connections.length > 0)
      return {
        agentId,
        authMethods: integrations.flatMap((integration) =>
          integration.methods.flatMap((method) =>
            method.type === "key" || (method.type === "oauth" && method.id)
              ? [
                  {
                    description: null,
                    id: `integration:${encodeURIComponent(integration.id)}:${method.type}:${encodeURIComponent(method.id ?? "key")}`,
                    input: method.type === "key" ? ("secret" as const) : ("none" as const),
                    label: `${integration.name} — ${method.label ?? (method.type === "key" ? "API key" : "OAuth")}`,
                  },
                ]
              : []
          )
        ),
        connected: connected.length > 0,
        detail: connected.map((integration) => integration.name).join(", ") || null,
        logoutSupported: true,
      }
    }
    if (!isNativeAgentId(agentId)) {
      await this.catalog.get(agentId)
      return {
        agentId,
        authMethods: (this.#acpAuthMethods.get(agentId) ?? []).map(
          ({ description, id, input, label }) => ({ description, id, input, label })
        ),
        connected: this.#acpConnected.has(agentId),
        detail: null,
        logoutSupported: this.#acpLogoutSupported.get(agentId) ?? false,
      }
    }
    return {
      agentId,
      authMethods: [
        { description: null, id: "agent", input: "none" as const, label: "Agent authentication" },
        {
          description: null,
          id: "terminal",
          input: "terminal" as const,
          label: "Terminal authentication",
        },
      ],
      connected: false,
      detail: null,
      logoutSupported: true,
    }
  }

  async #startAuth(
    agentId: AgentId,
    methodId: string,
    secret: string | undefined,
    sessionId: string,
    send: Send
  ) {
    if (!isNativeAgentId(agentId)) {
      await this.catalog.get(agentId)
      const method = this.#acpAuthMethods.get(agentId)?.find((item) => item.id === methodId)
      if (!method) throw new Error("Authentication method is no longer available")
      if (method.input === "terminal") {
        return this.#startTerminalAuth(agentId, methodId, method.args, method.env, sessionId, send)
      }
      await this.#agents.authenticateAcp(agentId, methodId, new AbortController().signal)
      this.#acpConnected.add(agentId)
      this.catalog.invalidate(agentId)
      return { state: "completed" as const }
    }
    if (agentId === "pi") {
      const match = /^pi:([^:]+):(api_key|oauth)$/u.exec(methodId)
      if (!match?.[1] || !match[2]) {
        throw new Error(`Invalid Pi authentication method: ${methodId}`)
      }
      if (match[2] === "api_key") {
        if (!secret) throw new Error("An API key is required")
        await this.#agents.setPiApiKey(match[1], secret)
        this.catalog.invalidate(agentId)
        return { state: "completed" as const }
      }
      return this.#startPiOAuth(match[1])
    }
    if (agentId === "opencode") {
      const match = /^integration:([^:]+):(key|oauth):([^:]+)$/u.exec(methodId)
      if (!match) throw new Error(`Invalid OpenCode authentication method: ${methodId}`)
      const [, encodedIntegrationId, type, encodedMethodId] = match
      if (!encodedIntegrationId || !type || !encodedMethodId) {
        throw new Error(`Invalid OpenCode authentication method: ${methodId}`)
      }
      const integrationId = decodeURIComponent(encodedIntegrationId)
      const method = decodeURIComponent(encodedMethodId)
      if (type === "key") {
        if (!secret) throw new Error("An API key is required")
        const result = await this.#agents.callOpenCode("integration.connect.key", {
          body: { integrationID: integrationId, key: secret },
        })
        if (!result.ok) throw new Error(`OpenCode authentication failed (${result.status})`)
        this.catalog.invalidate(agentId)
        return { state: "completed" as const }
      }
      const result = await this.#agents.callOpenCode("integration.oauth.connect", {
        body: { integrationID: integrationId, methodID: method },
      })
      if (!result.ok) throw new Error(`OpenCode OAuth failed (${result.status})`)
      const authorization = (result.data as { data?: unknown })?.data as {
        attemptID: string
        instructions?: string
        mode?: "auto" | "code"
        url?: string
      } | null
      if (!authorization) return { state: "completed" as const }
      return {
        externalUrl: authorization.url ?? null,
        flowId: `opencode:${encodeURIComponent(integrationId)}:${encodeURIComponent(authorization.attemptID)}`,
        input: authorization.mode === "code" ? ("text" as const) : ("none" as const),
        message: authorization.instructions ?? "Complete provider sign in.",
        state: "pending" as const,
      }
    }
    if (agentId !== "codex") {
      if (agentId === "claude" && (methodId === "subscription" || methodId === "console")) {
        return this.#startTerminalAuth(
          agentId,
          methodId,
          ["auth", "login", methodId === "console" ? "--console" : "--claudeai"],
          {},
          sessionId,
          send
        )
      }
      throw new Error(`${agentId} authentication requires its installed provider flow`)
    }
    if (methodId !== "apiKey" && methodId !== "chatgpt" && methodId !== "chatgptDeviceCode") {
      throw new Error(`Unsupported Codex authentication method: ${methodId}`)
    }
    if (methodId === "apiKey" && !secret) throw new Error("An API key is required")
    const result = await this.#codex.login(
      methodId === "apiKey" ? { apiKey: secret, type: methodId } : { type: methodId }
    )
    this.catalog.invalidate(agentId)
    if (result.type === "apiKey") return { state: "completed" as const }
    if (result.type === "chatgpt") {
      return {
        externalUrl: result.authUrl,
        flowId: result.loginId,
        input: "none" as const,
        message: "Complete sign in in your browser.",
        state: "pending" as const,
      }
    }
    if (result.type === "chatgptDeviceCode") {
      return {
        externalUrl: result.verificationUrl,
        flowId: result.loginId,
        input: "none" as const,
        message: `Enter code ${result.userCode}`,
        state: "pending" as const,
      }
    }
    return { state: "completed" as const }
  }

  async #cancelAuth(agentId: AgentId, flowId: string, sessionId: string) {
    const terminal = this.#terminalAuthFlows.get(flowId)
    if (terminal?.agentId === agentId && terminal.sessionId === sessionId) {
      this.#terminals.close(terminal.terminalId, sessionId)
      this.#terminalAuthFlows.delete(flowId)
      return { cancelled: true }
    }
    if (agentId === "pi") {
      const flow = this.#piAuthFlows.get(flowId)
      if (!flow) return { cancelled: false }
      flow.controller.abort()
      flow.prompt?.reject(new Error("Authentication cancelled"))
      this.#piAuthFlows.delete(flowId)
      return { cancelled: true }
    }
    if (agentId === "opencode") {
      const match = /^opencode:([^:]+):([^:]+)$/u.exec(flowId)
      if (!match?.[1] || !match[2]) return { cancelled: false }
      const result = await this.#agents.callOpenCode("integration.oauth.cancel", {
        body: {
          attemptID: decodeURIComponent(match[2]),
          integrationID: decodeURIComponent(match[1]),
        },
      })
      return { cancelled: result.ok }
    }
    if (agentId !== "codex") return { cancelled: false }
    const result = await this.#codex.call<{ status: string }>("account/login/cancel", {
      loginId: flowId,
    })
    return { cancelled: result.status === "canceled" }
  }

  async #respondAuth(agentId: AgentId, flowId: string, response: string) {
    if (agentId === "pi") {
      const flow = this.#piAuthFlows.get(flowId)
      if (!flow?.prompt) throw new Error("Pi is not waiting for a response")
      const prompt = flow.prompt
      flow.prompt = undefined
      prompt.resolve(response)
      return this.#nextPiEvent(flowId, flow)
    }
    if (agentId !== "opencode") throw new Error(`${agentId} does not accept this response`)
    const match = /^opencode:([^:]+):([^:]+)$/u.exec(flowId)
    if (!match?.[1] || !match[2]) throw new Error("Invalid OpenCode OAuth flow")
    const result = await this.#agents.callOpenCode("integration.oauth.complete", {
      body: {
        attemptID: decodeURIComponent(match[2]),
        code: response,
        integrationID: decodeURIComponent(match[1]),
      },
    })
    if (!result.ok) throw new Error(`OpenCode OAuth callback failed (${result.status})`)
    this.catalog.invalidate(agentId)
    return { state: "completed" as const }
  }

  async #logout(agentId: AgentId): Promise<void> {
    if (agentId === "opencode") {
      const result = await this.#agents.callOpenCode("integration.list")
      if (!result.ok) throw new Error(`OpenCode integration discovery failed (${result.status})`)
      const integrations = ((result.data as { data?: unknown[] })?.data ?? []) as Array<{
        connections: Array<{ id?: string; type: "credential" | "env" }>
      }>
      const credentialIds = integrations.flatMap((integration) =>
        integration.connections.flatMap((connection) =>
          connection.type === "credential" && connection.id ? [connection.id] : []
        )
      )
      await Promise.all(
        credentialIds.map(async (credentialID) => {
          const removed = await this.#agents.callOpenCode("credential.remove", {
            body: { credentialID },
          })
          if (!removed.ok) throw new Error(`OpenCode logout failed (${removed.status})`)
        })
      )
    } else if (agentId === "pi") {
      const catalog = await this.#agents.getPiCatalog()
      await Promise.all(
        catalog.credentials.map((credential) => this.#agents.logoutPi(credential.providerId))
      )
    } else if (agentId === "codex") {
      await this.#codex.call("account/logout")
    } else if (agentId === "claude") {
      await this.#agents.logoutClaude()
    } else if (!isNativeAgentId(agentId)) {
      if (!this.#acpLogoutSupported.get(agentId)) {
        throw new Error(`${agentId} does not advertise logout support`)
      }
      await this.#agents.logoutAcp(agentId, new AbortController().signal)
      this.#acpConnected.delete(agentId)
    } else {
      throw new Error(`${agentId} logout is not available yet`)
    }
    this.catalog.invalidate(agentId)
  }

  async #startTerminalAuth(
    agentId: AgentId,
    methodId: string,
    args: string[],
    environment: Record<string, string>,
    sessionId: string,
    send: Send
  ): Promise<HarnessAuthFlow> {
    const spec = await this.#agents.authTerminalSpec(agentId, args, environment)
    const flowId = `terminal:${randomUUID()}`
    const terminal = this.#terminals.openCommand(
      { ...spec, title: `${agentId} authentication` },
      sessionId,
      send,
      (exitCode) => {
        this.#terminalAuthFlows.delete(flowId)
        if (exitCode === 0 && !isNativeAgentId(agentId)) this.#acpConnected.add(agentId)
        this.catalog.invalidate(agentId)
      }
    )
    this.#terminalAuthFlows.set(flowId, { agentId, sessionId, terminalId: terminal.terminalId })
    return {
      externalUrl: null,
      flowId,
      input: "none",
      message: `Complete ${methodId} authentication in the terminal.`,
      state: "pending",
      terminalId: terminal.terminalId,
    }
  }

  async #discover(agentId: AgentId, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason
    const defaults = this.#config.getSnapshot().config.agents.defaults[agentId] ?? {}
    if (agentId === "claude") {
      const catalog = await this.#agents.getClaudeCatalog()
      return {
        models: catalog.models.map((model, index) => ({
          agentId,
          aliases:
            model.resolvedModel && model.resolvedModel !== model.value ? [model.resolvedModel] : [],
          contextWindowMaxTokens: null,
          defaultThinkingOptionId: model.supportsEffort ? "high" : null,
          description: model.description || null,
          id: model.value,
          isDefault: index === 0,
          isSelectable: true,
          label: model.displayName,
          metadata: { adaptiveThinking: model.supportsAdaptiveThinking ?? false },
          providerId: "anthropic",
          providerLabel: "Anthropic",
          thinkingOptions: (model.supportedEffortLevels ?? []).map((id) => ({
            description: null,
            id,
            isDefault: id === "high",
            label: id,
          })),
        })),
        settingSections: genericSections(agentId, defaults).map((entry) => ({
          ...entry,
          settings: entry.settings.map((setting) =>
            setting.id === "model" && setting.type === "select"
              ? {
                  ...setting,
                  options: catalog.models.map((model) => option(model.value, model.displayName)),
                }
              : setting
          ),
        })),
      }
    }
    if (agentId === "pi") {
      const catalog = await this.#agents.getPiCatalog()
      return {
        models: catalog.models.map((model) => ({
          agentId,
          aliases: [],
          contextWindowMaxTokens: model.contextWindow,
          defaultThinkingOptionId: model.reasoning ? "medium" : null,
          description: null,
          id: `${model.provider}/${model.id}`,
          isDefault: false,
          isSelectable: true,
          label: model.name,
          metadata: { api: model.api, input: model.input, maxTokens: model.maxTokens },
          providerId: model.provider,
          providerLabel:
            catalog.providers.find((provider) => provider.id === model.provider)?.name ??
            model.provider,
          thinkingOptions: model.reasoning
            ? (model.thinkingLevels.length
                ? model.thinkingLevels
                : ["minimal", "low", "medium", "high", "xhigh"]
              ).map((id) => ({
                description: null,
                id,
                isDefault: id === "medium",
                label: id,
              }))
            : [],
        })),
        settingSections: genericSections(agentId, defaults).map((entry) => ({
          ...entry,
          settings: entry.settings.map((setting) =>
            setting.id === "provider" && setting.type === "select"
              ? {
                  ...setting,
                  options: catalog.providers.map((provider) => option(provider.id, provider.name)),
                }
              : setting.id === "model" && setting.type === "select"
                ? {
                    ...setting,
                    options: catalog.models.map((model) =>
                      option(`${model.provider}/${model.id}`, model.name)
                    ),
                  }
                : setting
          ),
        })),
      }
    }
    if (agentId === "opencode") {
      const [modelResult, defaultResult, providerResult, agentResult] = await Promise.all([
        this.#agents.callOpenCode("model.list"),
        this.#agents.callOpenCode("model.default"),
        this.#agents.callOpenCode("provider.list"),
        this.#agents.callOpenCode("agent.list"),
      ])
      if (!modelResult.ok)
        throw new Error(`OpenCode model discovery failed (${modelResult.status})`)
      if (!defaultResult.ok)
        throw new Error(`OpenCode default model discovery failed (${defaultResult.status})`)
      if (!providerResult.ok)
        throw new Error(`OpenCode provider discovery failed (${providerResult.status})`)
      if (!agentResult.ok)
        throw new Error(`OpenCode agent discovery failed (${agentResult.status})`)
      const models = ((modelResult.data as { data?: unknown[] })?.data ?? []) as Array<{
        capabilities: { output?: string[] }
        enabled: boolean
        id: string
        limit: { context: number }
        modelID: string
        name: string
        providerID: string
        status: "active" | "alpha" | "beta" | "deprecated"
        variants: Array<{ id: string }>
      }>
      const defaultModel = (defaultResult.data as { data?: { id?: string } | null })?.data
      const providers = ((providerResult.data as { data?: unknown[] })?.data ?? []) as Array<{
        id: string
        name: string
      }>
      const agents = ((agentResult.data as { data?: unknown[] })?.data ?? []) as Array<{
        description?: string
        hidden?: boolean
        id: string
        mode: "all" | "primary" | "subagent"
        name: string
      }>
      const modelOptions = models.map((model) =>
        option(`${model.providerID}/${model.modelID}`, model.name)
      )
      const variantOptions = [
        ...new Set(models.flatMap((model) => model.variants.map((variant) => variant.id))),
      ].map((id) => option(id))
      return {
        models: models.map((model) => {
          const provider = providers.find((candidate) => candidate.id === model.providerID)
          const reasoning = model.capabilities.output?.includes("reasoning") ?? false
          return {
            agentId,
            aliases: [],
            contextWindowMaxTokens: model.limit.context,
            defaultThinkingOptionId: null,
            description: null,
            id: `${model.providerID}/${model.modelID}`,
            isDefault: defaultModel?.id === model.id,
            isSelectable: model.enabled && model.status !== "deprecated",
            label: model.name,
            metadata: { status: model.status },
            providerId: model.providerID,
            providerLabel: provider?.name ?? model.providerID,
            thinkingOptions: reasoning
              ? [
                  {
                    description: null,
                    id: "reasoning",
                    isDefault: true,
                    label: "Reasoning",
                  },
                ]
              : [],
          }
        }),
        settingSections: genericSections(agentId, defaults).map((entry) => ({
          ...entry,
          settings: entry.settings.map((setting) => {
            if (setting.type !== "select") return setting
            if (setting.id === "model") return { ...setting, options: modelOptions }
            if (setting.id === "variant") return { ...setting, options: variantOptions }
            if (setting.id === "agent") {
              return {
                ...setting,
                options: agents
                  .filter((agent) => !agent.hidden)
                  .map((agent) => option(agent.id, agent.name, agent.description ?? null)),
              }
            }
            if (setting.id === "mode") {
              return {
                ...setting,
                options: [option("primary", "Primary"), option("subagent", "Subagent")],
              }
            }
            return setting
          }),
        })),
      }
    }
    if (!isNativeAgentId(agentId)) {
      const probe = await this.#agents.probeAcpCatalog(agentId, signal)
      this.#acpAuthMethods.set(
        agentId,
        probe.authMethods.map((method) => ({
          description: method.description,
          args: method.args,
          env: method.env,
          id: method.id,
          input: method.type === "terminal" ? ("terminal" as const) : ("none" as const),
          label: method.name,
        }))
      )
      this.#acpLogoutSupported.set(agentId, probe.logoutSupported)
      const sectionMap = new Map<string, HarnessSettingSection>()
      const sectionFor = (
        category: string | null
      ): { id: string; label: string; order: number } => {
        if (category === "model" || category === "model_config") {
          return { id: "model-defaults", label: "Model defaults", order: 30 }
        }
        if (category === "mode") return { id: "mode", label: "Mode", order: 40 }
        if (category === "thought_level") return { id: "thinking", label: "Thinking", order: 50 }
        if (!category) return { id: "general", label: "General", order: 90 }
        const id = category
          .replace(/^_+/u, "")
          .replace(/[^a-zA-Z0-9]+/gu, "-")
          .replace(/^-|-$/gu, "")
          .toLocaleLowerCase()
        return {
          id: id || "general",
          label: category.replace(/^_+/u, "").replace(/[_-]+/gu, " "),
          order: 60,
        }
      }
      for (const config of probe.configOptions) {
        const metadata = sectionFor(config.category)
        const target =
          sectionMap.get(metadata.id) ?? section(metadata.id, metadata.label, metadata.order, [])
        const savedValue = defaults[config.id]
        target.settings.push(
          config.type === "boolean"
            ? boolean(
                config.id,
                config.name,
                typeof savedValue === "boolean" ? savedValue : Boolean(config.currentValue),
                config.description
              )
            : select(
                config.id,
                config.name,
                typeof savedValue === "string" ? savedValue : String(config.currentValue),
                config.options.map((item) => option(item.value, item.name, item.description)),
                config.description
              )
        )
        sectionMap.set(metadata.id, target)
      }
      if (probe.modes.length > 0 && !sectionMap.has("mode")) {
        sectionMap.set(
          "mode",
          section("mode", "Mode", 40, [
            select(
              "mode",
              "Default mode",
              String(defaults.mode ?? probe.modes[0]?.id ?? ""),
              probe.modes.map((mode) => option(mode.id, mode.name, mode.description))
            ),
          ])
        )
      }
      const models = probe.configOptions
        .filter(
          (config) =>
            config.type === "select" &&
            (config.category === "model" || config.category === "model_config")
        )
        .flatMap((config) =>
          config.options.map((model) => ({
            agentId,
            aliases: [],
            contextWindowMaxTokens: null,
            defaultThinkingOptionId: null,
            description: model.description,
            id: model.value,
            isDefault: model.value === config.currentValue,
            isSelectable: true,
            label: model.name,
            metadata: { configOptionId: config.id },
            providerId: null,
            providerLabel: null,
            thinkingOptions: [],
          }))
        )
      return {
        models,
        settingSections: [...sectionMap.values()].sort((left, right) => left.order - right.order),
      }
    }
    if (agentId !== "codex") {
      return { models: [], settingSections: genericSections(agentId, defaults) }
    }

    const [models, permissions] = await Promise.all([
      this.#codex.models(false),
      this.#codex.permissionDefaults(),
    ])
    const settings = this.#codex.settings()
    return {
      models: models.map((model) => ({
        agentId,
        aliases: model.id === model.model ? [] : [model.model],
        contextWindowMaxTokens: null,
        defaultThinkingOptionId: model.defaultReasoningEffort,
        description: model.description || null,
        id: model.id,
        isDefault: model.isDefault,
        isSelectable: !model.hidden,
        label: model.displayName,
        metadata: {
          inputModalities: model.inputModalities,
          serviceTiers: model.serviceTiers,
        },
        providerId: settings.provider,
        providerLabel: settings.provider,
        thinkingOptions: model.reasoningEfforts.map((effort) => ({
          description: effort.description || null,
          id: effort.value,
          isDefault: effort.value === model.defaultReasoningEffort,
          label: effort.value,
        })),
      })),
      settingSections: [
        section("model-defaults", "Model defaults", 30, [
          select("provider", "Provider", settings.provider, [
            option("openai", "OpenAI"),
            option("amazon-bedrock", "Amazon Bedrock"),
            option("ollama", "Ollama"),
            option("lmstudio", "LM Studio"),
          ]),
          select(
            "model",
            "Default model",
            settings.model,
            models
              .filter((model) => !model.hidden)
              .map((model) => option(model.id, model.displayName))
          ),
          select("reasoningEffort", "Reasoning effort", settings.reasoningEffort, [
            option("minimal", "Minimal"),
            option("low", "Low"),
            option("medium", "Medium"),
            option("high", "High"),
            option("xhigh", "Extra high"),
          ]),
          select("serviceTier", "Service tier", settings.serviceTier, [
            option("auto", "Auto"),
            option("default", "Default"),
            option("flex", "Flex"),
            option("priority", "Priority"),
          ]),
        ]),
        section("permissions", "Permissions", 40, [
          select(
            "approvalPolicy",
            "Approval policy",
            permissions.approvalPolicy,
            (permissions.allowedApprovalPolicies ?? ["untrusted", "on-request", "never"]).map(
              (id) => option(id)
            )
          ),
          select("approvalsReviewer", "Approval reviewer", permissions.approvalsReviewer, [
            option("user", "User"),
            option("auto_review", "Auto review"),
            option("guardian_subagent", "Guardian subagent"),
          ]),
          select(
            "sandboxMode",
            "Sandbox",
            permissions.sandboxMode,
            (
              permissions.allowedSandboxModes ?? [
                "read-only",
                "workspace-write",
                "danger-full-access",
              ]
            ).map((id) => option(id))
          ),
          boolean("networkAccess", "Network access", permissions.networkAccess),
          boolean(
            "showFullAccessInComposer",
            "Show Full access",
            this.#config.getSnapshot().config.agents.codex.showFullAccessInComposer
          ),
        ]),
        section("responses-web", "Responses & web", 50, [
          select("webSearch", "Web search", permissions.webSearch, [
            option("disabled", "Disabled"),
            option("cached", "Cached"),
            option("indexed", "Indexed"),
            option("live", "Live"),
          ]),
          select("modelVerbosity", "Output detail", permissions.modelVerbosity, [
            option("low", "Low"),
            option("medium", "Medium"),
            option("high", "High"),
          ]),
          select("modelReasoningSummary", "Reasoning summary", permissions.modelReasoningSummary, [
            option("auto", "Auto"),
            option("concise", "Concise"),
            option("detailed", "Detailed"),
            option("none", "None"),
          ]),
        ]),
        section("advanced", "Advanced", 60, []),
      ],
    }
  }

  async #updateSettings(
    agentId: AgentId,
    values: Record<string, string | boolean | number | null>
  ): Promise<HarnessCatalogSnapshot> {
    const snapshot = await this.catalog.get(agentId)
    const definitions = new Map(
      snapshot.settingSections.flatMap((entry) =>
        entry.settings.map((setting) => [setting.id, setting])
      )
    )
    for (const [id, value] of Object.entries(values)) {
      const definition = definitions.get(id)
      if (!definition) throw new Error(`Unknown setting for ${agentId}: ${id}`)
      if (definition.type === "boolean" && typeof value !== "boolean") {
        throw new Error(`${id} must be a boolean`)
      }
      if (definition.type === "number" && typeof value !== "number" && value !== null) {
        throw new Error(`${id} must be a number`)
      }
      if (definition.type === "select") {
        if (typeof value !== "string" && value !== null) throw new Error(`${id} must be a string`)
        if (
          value !== null &&
          definition.options.length > 0 &&
          !definition.options.some((item) => item.value === value)
        ) {
          throw new Error(`${id} is no longer available`)
        }
      }
    }

    if (agentId === "codex") {
      const current = this.#config.getSnapshot().config.agents.codex
      const next = { ...current, ...values }
      await this.#codex.setSettings({
        model: typeof next.model === "string" ? next.model : null,
        provider: next.provider as typeof current.provider,
        reasoningEffort: typeof next.reasoningEffort === "string" ? next.reasoningEffort : null,
        serviceTier: typeof next.serviceTier === "string" ? next.serviceTier : null,
      })
      await this.#codex.setPermissionDefaults({
        approvalPolicy: next.approvalPolicy as typeof current.approvalPolicy,
        approvalsReviewer: next.approvalsReviewer as typeof current.approvalsReviewer,
        modelReasoningSummary: next.modelReasoningSummary as typeof current.modelReasoningSummary,
        modelVerbosity: next.modelVerbosity as typeof current.modelVerbosity,
        networkAccess: Boolean(next.networkAccess),
        sandboxMode: next.sandboxMode as typeof current.sandboxMode,
        webSearch: next.webSearch as typeof current.webSearch,
      })
      if (typeof next.showFullAccessInComposer === "boolean") {
        await this.#codex.setShowFullAccess(next.showFullAccessInComposer)
      }
    } else {
      const current = this.#config.getSnapshot().config.agents.defaults[agentId] ?? {}
      await this.#config.patch({ agents: { defaults: { [agentId]: { ...current, ...values } } } })
    }
    this.catalog.invalidate(agentId)
    return this.catalog.get(agentId, true)
  }

  async #startPiOAuth(providerId: string): Promise<HarnessAuthFlow> {
    const flowId = `pi:${randomUUID()}`
    const flow: PiAuthFlow = {
      controller: new AbortController(),
      events: [],
      waiters: [],
    }
    this.#piAuthFlows.set(flowId, flow)
    void this.#agents
      .loginPi(providerId, "oauth", {
        notify: (event) => {
          if (event.type === "auth_url") {
            this.#emitPiEvent(flow, {
              externalUrl: event.url,
              flowId,
              input: "none",
              message: event.instructions ?? "Complete sign in in your browser.",
              state: "pending",
            })
          } else if (event.type === "device_code") {
            this.#emitPiEvent(flow, {
              externalUrl: event.verificationUri,
              flowId,
              input: "none",
              message: `Enter code ${event.userCode}`,
              state: "pending",
            })
          } else if (event.type === "info" || event.type === "progress") {
            this.#emitPiEvent(flow, {
              externalUrl: event.type === "info" ? (event.links?.[0]?.url ?? null) : null,
              flowId,
              input: "none",
              message: event.message,
              state: "pending",
            })
          }
        },
        prompt: (prompt) =>
          new Promise<string>((resolve, reject) => {
            flow.prompt = { reject, resolve }
            this.#emitPiEvent(flow, {
              externalUrl: null,
              flowId,
              input: prompt.type === "secret" ? "secret" : "text",
              message: prompt.message,
              state: "pending",
            })
          }),
        signal: flow.controller.signal,
      })
      .then(() => {
        this.catalog.invalidate("pi")
        this.#emitPiEvent(flow, { state: "completed" })
      })
      .catch((error) => {
        if (!flow.controller.signal.aborted) {
          this.#emitPiEvent(flow, {
            message: error instanceof Error ? error.message : String(error),
            state: "failed",
          })
        }
      })
    return this.#nextPiEvent(flowId, flow)
  }

  #emitPiEvent(flow: PiAuthFlow, event: HarnessAuthFlow): void {
    const waiter = flow.waiters.shift()
    if (waiter) waiter(event)
    else flow.events.push(event)
  }

  async #nextPiEvent(flowId: string, flow: PiAuthFlow): Promise<HarnessAuthFlow> {
    const event = flow.events.shift()
    const next =
      event ?? (await new Promise<HarnessAuthFlow>((resolve) => flow.waiters.push(resolve)))
    if (next.state === "completed" || next.state === "failed") this.#piAuthFlows.delete(flowId)
    return next
  }
}
