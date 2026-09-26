import { randomUUID } from "node:crypto"
import {
  type AgentId,
  type HarnessAuthField,
  type HarnessAuthFlow,
  type HarnessAuthTestResult,
  type HarnessCatalogSnapshot,
  type HarnessClientMessage,
  type HarnessServerMessage,
  type HarnessSettingDefinition,
  type HarnessSettingSection,
  type HarnessView,
  isNativeAgentId,
  type ServerMessage,
} from "@cypheria/protocol"

import type { AgentManager } from "./agent/agent-manager.js"
import type { CodexHarnessService } from "./codex-harness-service.js"
import { HarnessCatalogManager } from "./harness-catalog-manager.js"
import type { TerminalService } from "./terminal-service.js"

type Send = (message: ServerMessage) => void

type PiAuthFlow = {
  agentId: AgentId
  controller: AbortController
  events: HarnessAuthFlow[]
  providerId: string
  sessionId: string
  prompt?: { reject: (error: Error) => void; resolve: (value: string) => void }
  waiters: Array<(event: HarnessAuthFlow) => void>
}

type AuthValues = Record<string, string | number | boolean | string[]>

type OpenCodeFormField = {
  default?: string | number | boolean | string[]
  description?: string
  hidden?: boolean
  key: string
  maximum?: number | string
  maxItems?: number
  minimum?: number | string
  minItems?: number
  options?: Array<{ description?: string; label: string; value: string }>
  placeholder?: string
  required?: boolean
  title?: string
  type: "boolean" | "external" | "integer" | "multiselect" | "number" | "string"
  url?: string
  when?: Array<{
    key: string
    op: "eq" | "neq"
    value: string | number | boolean
  }>
}

const apiKeyField = (): HarnessAuthField => ({
  defaultValue: null,
  description: null,
  hidden: false,
  id: "key",
  label: "API key",
  max: null,
  min: null,
  options: [],
  placeholder: null,
  required: true,
  type: "secret",
  url: null,
  when: [],
})

const openCodeAuthField = (field: OpenCodeFormField, keyMethod: boolean): HarnessAuthField => {
  const looksSecret =
    keyMethod &&
    /(?:api[-_ ]?key|token|secret|password|credential)/iu.test(`${field.key} ${field.title ?? ""}`)
  const defaultValue = (() => {
    if (field.type === "string" && typeof field.default === "string") return field.default
    if (
      (field.type === "number" || field.type === "integer") &&
      typeof field.default === "number" &&
      Number.isFinite(field.default)
    ) {
      return field.default
    }
    if (field.type === "boolean" && typeof field.default === "boolean") return field.default
    if (field.type === "multiselect" && Array.isArray(field.default)) return field.default
    return null
  })()
  return {
    defaultValue,
    description: field.description ?? null,
    hidden: field.hidden ?? false,
    id: field.key,
    label: field.title ?? field.key,
    max:
      typeof (field.type === "multiselect" ? field.maxItems : field.maximum) === "number"
        ? ((field.type === "multiselect" ? field.maxItems : field.maximum) as number)
        : null,
    min:
      typeof (field.type === "multiselect" ? field.minItems : field.minimum) === "number"
        ? ((field.type === "multiselect" ? field.minItems : field.minimum) as number)
        : null,
    options: (field.options ?? []).map((item) => ({
      description: item.description ?? null,
      label: item.label,
      value: item.value,
    })),
    placeholder: field.placeholder ?? null,
    required: field.required ?? false,
    type: field.type === "string" ? (looksSecret ? "secret" : "text") : field.type,
    url: field.type === "external" ? (field.url ?? null) : null,
    when: (field.when ?? []).map((condition) => ({
      fieldId: condition.key,
      operator: condition.op === "eq" ? ("equals" as const) : ("not-equals" as const),
      value: condition.value,
    })),
  }
}

const authFieldVisible = (field: HarnessAuthField, values: AuthValues): boolean =>
  !field.hidden &&
  field.when.every((condition) => {
    const matches = values[condition.fieldId] === condition.value
    return condition.operator === "equals" ? matches : !matches
  })

const validateAuthValues = (
  fields: HarnessAuthField[],
  supplied: AuthValues | undefined
): AuthValues => {
  const values: AuthValues = {}
  const allowed = new Set(fields.map((field) => field.id))
  for (const [id, value] of Object.entries(supplied ?? {})) {
    if (!allowed.has(id)) throw new Error(`Unknown authentication field: ${id}`)
    values[id] = value
  }
  for (const field of fields) {
    if (values[field.id] === undefined && field.defaultValue !== null) {
      values[field.id] = field.defaultValue
    }
  }
  for (const field of fields) {
    if (!authFieldVisible(field, values) || field.type === "external") continue
    const value = values[field.id]
    if (
      field.required &&
      (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
    ) {
      throw new Error(`${field.label} is required`)
    }
    if (value === undefined) continue
    if (field.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`${field.label} must be a boolean`)
    }
    if (
      (field.type === "number" || field.type === "integer") &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(`${field.label} must be a number`)
    }
    if (field.type === "integer" && typeof value === "number" && !Number.isInteger(value)) {
      throw new Error(`${field.label} must be an integer`)
    }
    if (field.type === "multiselect" && !Array.isArray(value)) {
      throw new Error(`${field.label} must be a list`)
    }
    if ((field.type === "text" || field.type === "secret") && typeof value !== "string") {
      throw new Error(`${field.label} must be text`)
    }
    if (typeof value === "number" && field.min !== null && value < field.min) {
      throw new Error(`${field.label} must be at least ${field.min}`)
    }
    if (typeof value === "number" && field.max !== null && value > field.max) {
      throw new Error(`${field.label} must be at most ${field.max}`)
    }
    if (Array.isArray(value) && field.min !== null && value.length < field.min) {
      throw new Error(`${field.label} requires at least ${field.min} selections`)
    }
    if (Array.isArray(value) && field.max !== null && value.length > field.max) {
      throw new Error(`${field.label} allows at most ${field.max} selections`)
    }
    if (
      typeof value === "string" &&
      field.options.length > 0 &&
      !field.options.some((option) => option.value === value)
    ) {
      throw new Error(`${field.label} has an invalid option`)
    }
    if (
      Array.isArray(value) &&
      value.some((item) => !field.options.some((option) => option.value === item))
    ) {
      throw new Error(`${field.label} has an invalid option`)
    }
  }
  return values
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

const section = (
  id: string,
  label: string,
  order: number,
  settings: HarnessSettingDefinition[],
  description: string | null = null
): HarnessSettingSection => ({ description, id, label, order, settings })

export class HarnessService {
  readonly catalog: HarnessCatalogManager
  readonly #agents: AgentManager
  readonly #codex: CodexHarnessService
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
  readonly #codexAuthFlows = new Map<string, AbortController>()
  readonly #piAuthFlows = new Map<string, PiAuthFlow>()
  readonly #authReservations = new Map<string, string>()
  readonly #flowReservations = new Map<string, string>()
  readonly #flowSessions = new Map<string, { agentId: AgentId; sessionId: string }>()
  readonly #terminalAuthFlows = new Map<
    string,
    { agentId: AgentId; providerId: string; sessionId: string; terminalId: string }
  >()

  constructor(agents: AgentManager, codex: CodexHarnessService, terminals: TerminalService) {
    this.#agents = agents
    this.#codex = codex
    this.#terminals = terminals
    this.catalog = new HarnessCatalogManager((agentId, signal) => this.#discover(agentId, signal))
  }

  stop(): void {
    for (const controller of this.#codexAuthFlows.values()) controller.abort()
    this.#codexAuthFlows.clear()
    for (const flow of this.#piAuthFlows.values()) flow.controller.abort()
    this.#piAuthFlows.clear()
    for (const flow of this.#terminalAuthFlows.values()) {
      this.#terminals.close(flow.terminalId, flow.sessionId)
    }
    this.#terminalAuthFlows.clear()
    for (const [flowId, owner] of this.#flowSessions) {
      void this.#cancelAuth(owner.agentId, flowId, owner.sessionId).catch(() => undefined)
    }
    this.#authReservations.clear()
    this.#flowReservations.clear()
    this.#flowSessions.clear()
    this.catalog.stop()
  }

  closeSession(sessionId: string): void {
    for (const [flowId, owner] of this.#flowSessions) {
      if (owner.sessionId !== sessionId) continue
      const pi = this.#piAuthFlows.get(flowId)
      if (pi) {
        pi.controller.abort()
        pi.prompt?.reject(new Error("Authentication cancelled"))
        this.#piAuthFlows.delete(flowId)
      }
      if (!pi) void this.#cancelAuth(owner.agentId, flowId, sessionId).catch(() => undefined)
      this.#releaseFlow(flowId)
    }
    for (const [flowId, flow] of this.#terminalAuthFlows) {
      if (flow.sessionId !== sessionId) continue
      this.#terminals.close(flow.terminalId, sessionId)
      this.#terminalAuthFlows.delete(flowId)
      this.#releaseFlow(flowId)
    }
  }

  invalidate(agentId?: AgentId): void {
    this.catalog.invalidate(agentId)
    if (agentId) {
      this.#acpAuthMethods.delete(agentId)
      this.#acpConnected.delete(agentId)
      this.#acpLogoutSupported.delete(agentId)
      return
    }
    this.#acpAuthMethods.clear()
    this.#acpConnected.clear()
    this.#acpLogoutSupported.clear()
  }

  #connectionKey(agentId: AgentId, providerId: string): string {
    return `${agentId}\u0000${providerId}`
  }

  #isAuthBusy(agentId: AgentId, providerId: string): boolean {
    return this.#authReservations.has(this.#connectionKey(agentId, providerId))
  }

  #reserveAuth(agentId: AgentId, providerId: string): string {
    const key = this.#connectionKey(agentId, providerId)
    if (this.#authReservations.has(key)) {
      throw new Error("Authentication is already in progress for this provider")
    }
    const reservation = randomUUID()
    this.#authReservations.set(key, reservation)
    return key
  }

  #trackFlow(flowId: string, key: string, agentId: AgentId, sessionId: string): void {
    this.#authReservations.set(key, flowId)
    this.#flowReservations.set(flowId, key)
    this.#flowSessions.set(flowId, { agentId, sessionId })
  }

  #releaseFlow(flowId: string): void {
    const key = this.#flowReservations.get(flowId)
    if (!key) return
    if (this.#authReservations.get(key) === flowId) this.#authReservations.delete(key)
    this.#flowReservations.delete(flowId)
    this.#flowSessions.delete(flowId)
  }

  #releaseProvider(agentId: AgentId, providerId: string): void {
    const key = this.#connectionKey(agentId, providerId)
    const flowId = this.#authReservations.get(key)
    this.#authReservations.delete(key)
    if (flowId) {
      this.#flowReservations.delete(flowId)
      this.#flowSessions.delete(flowId)
    }
  }

  async validatedDefaults(
    agentId: AgentId
  ): Promise<Record<string, string | boolean | number | null>> {
    if (agentId === "codex") return {}
    return {}
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
              message.payload.providerId,
              message.payload.methodId,
              message.payload.values,
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
        case "harness.auth.poll.request":
          respond(await this.#pollAuth(message.payload.agentId, message.payload.flowId, sessionId))
          break
        case "harness.auth.logout.request":
          await this.#logout(message.payload.agentId, message.payload.connectionId)
          respond({ succeeded: true })
          break
        case "harness.auth.test.request":
          respond(await this.#testAuth(message.payload.agentId, message.payload.connectionId))
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

  #connectionId(agentId: AgentId, providerId: string): string {
    return `${agentId}:${encodeURIComponent(providerId)}`
  }

  async #view(agentId: AgentId): Promise<HarnessView> {
    const agent = await this.#agents.get(agentId, "harness-settings")
    if (agentId === "codex") {
      const account = await this.#codex.account(false)
      const providerId = "openai"
      const authMethods = [
        {
          description: "Use an OpenAI API key.",
          fields: [apiKeyField()],
          id: "apiKey",
          label: "API key",
        },
        {
          description: "Sign in with your ChatGPT account.",
          fields: [],
          id: "chatgpt",
          label: "ChatGPT",
        },
        {
          description: "Sign in on another device with a one-time code.",
          fields: [],
          id: "chatgptDeviceCode",
          label: "ChatGPT device code",
        },
      ]
      if (account.type !== null) this.#releaseProvider(agentId, providerId)
      return {
        agentId,
        connections:
          account.type === null
            ? []
            : [
                {
                  detail: account.email ?? account.planType ?? account.type,
                  disconnectSupported: true,
                  id: this.#connectionId(agentId, providerId),
                  methodId: account.type,
                  methodLabel: account.type === "apiKey" ? "API key" : "ChatGPT",
                  providerId,
                  providerLabel: "OpenAI",
                  source: "managed",
                  testSupported: true,
                },
              ],
        mode: "single",
        providers: [
          {
            authMethods,
            busy: this.#isAuthBusy(agentId, providerId),
            description: "Authenticate Codex with OpenAI.",
            id: providerId,
            label: "OpenAI",
          },
        ],
      }
    }
    if (agentId === "claude") {
      const catalog = await this.#agents.getClaudeCatalog()
      const providerId = "anthropic"
      const connected = Boolean(catalog.account.email || catalog.account.organization)
      if (connected) this.#releaseProvider(agentId, providerId)
      return {
        agentId,
        connections: connected
          ? [
              {
                detail:
                  catalog.account.email ??
                  catalog.account.organization ??
                  catalog.account.apiProvider ??
                  null,
                disconnectSupported: true,
                id: this.#connectionId(agentId, providerId),
                methodId: null,
                methodLabel: catalog.account.apiProvider ?? null,
                providerId,
                providerLabel: "Anthropic",
                source: "managed",
                testSupported: true,
              },
            ]
          : [],
        mode: "single",
        providers: [
          {
            authMethods: [
              {
                description: "Sign in with a Claude subscription.",
                fields: [],
                id: "subscription",
                label: "Claude account with subscription",
              },
              {
                description: "Sign in with your Console account.",
                fields: [],
                id: "console",
                label: "Anthropic Console account",
              },
            ],
            busy: this.#isAuthBusy(agentId, providerId),
            description: "Authenticate with a Claude subscription or Anthropic Console account.",
            id: providerId,
            label: "Anthropic",
          },
        ],
      }
    }
    if (agentId === "pi") {
      const catalog = await this.#agents.getPiCatalog()
      const credentials = new Map(
        catalog.credentials.map((credential) => [credential.providerId, credential])
      )
      for (const providerId of credentials.keys()) this.#releaseProvider(agentId, providerId)
      return {
        agentId,
        connections: catalog.providers.flatMap((provider) => {
          const credential = credentials.get(provider.id)
          return credential
            ? [
                {
                  detail: credential.type === "api_key" ? "API key" : "Account",
                  disconnectSupported: true,
                  id: this.#connectionId(agentId, provider.id),
                  methodId: credential.type,
                  methodLabel: credential.type === "api_key" ? "API key" : "Account",
                  providerId: provider.id,
                  providerLabel: provider.name,
                  source: "managed" as const,
                  testSupported: true,
                },
              ]
            : []
        }),
        mode: "multiple",
        providers: catalog.providers.map((provider) => ({
          authMethods: [
            ...(provider.auth.oauth
              ? provider.id === "openai-codex"
                ? [
                    {
                      description: "Sign in through a browser callback on this device.",
                      fields: [],
                      id: "oauth:browser",
                      label: "Browser login",
                    },
                    {
                      description: "Use a device code when a browser callback is unavailable.",
                      fields: [],
                      id: "oauth:device_code",
                      label: "Device code login",
                    },
                  ]
                : [
                    {
                      description: null,
                      fields: [],
                      id: "oauth",
                      label: provider.auth.oauth,
                    },
                  ]
              : []),
            ...(provider.auth.apiKey
              ? [
                  {
                    description: null,
                    fields: [],
                    id: "api_key",
                    label: provider.auth.apiKey,
                  },
                ]
              : []),
          ],
          busy: this.#isAuthBusy(agentId, provider.id),
          description: `Configure ${provider.name} credentials for Pi.`,
          id: provider.id,
          label: provider.name,
        })),
      }
    }
    if (agentId === "opencode") {
      const authResult = await this.#agents.callOpenCode("integration.list")
      if (!authResult.ok) throw new Error(`OpenCode auth discovery failed (${authResult.status})`)
      const integrations = ((authResult.data as { data?: unknown[] })?.data ?? []) as Array<{
        connections: Array<{
          id?: string
          label?: string
          name?: string
          type: "credential" | "env"
        }>
        id: string
        methods: Array<{
          form?: OpenCodeFormField[]
          id?: string
          label?: string
          type: "command" | "env" | "key" | "oauth"
        }>
        name: string
      }>
      const connected = integrations.filter((integration) => integration.connections.length > 0)
      for (const integration of connected) this.#releaseProvider(agentId, integration.id)
      return {
        agentId,
        connections: connected.map((integration) => {
          const hasEnvironment = integration.connections.some(
            (connection) => connection.type === "env"
          )
          const hasManaged = integration.connections.some(
            (connection) => connection.type === "credential"
          )
          const connectionDetails = integration.connections.flatMap((connection) => {
            const label = connection.label ?? connection.name
            return label ? [label] : []
          })
          return {
            detail:
              connectionDetails.length > 0
                ? connectionDetails.join(", ")
                : hasEnvironment
                  ? hasManaged
                    ? "Managed credential and environment"
                    : "Environment credential"
                  : "Managed credential",
            disconnectSupported: hasManaged && !hasEnvironment,
            id: this.#connectionId(agentId, integration.id),
            methodId: null,
            methodLabel: null,
            providerId: integration.id,
            providerLabel: integration.name,
            source: hasEnvironment ? (hasManaged ? "mixed" : "environment") : "managed",
            testSupported: true,
          }
        }),
        mode: "multiple",
        providers: integrations.map((integration) => ({
          authMethods: integration.methods.flatMap((method) =>
            method.type === "key" ||
            method.type === "command" ||
            (method.type === "oauth" && method.id)
              ? [
                  {
                    description: null,
                    fields: [
                      ...(method.type === "key" &&
                      !method.form?.some((field) => field.key === "key")
                        ? [apiKeyField()]
                        : []),
                      ...(method.form ?? []).map((field) =>
                        openCodeAuthField(field, method.type === "key")
                      ),
                    ],
                    id: `${method.type}:${encodeURIComponent(method.id ?? "key")}`,
                    label:
                      method.label ??
                      (method.type === "key"
                        ? "API key"
                        : method.type === "command"
                          ? "Command"
                          : "OAuth"),
                  },
                ]
              : []
          ),
          busy: this.#isAuthBusy(agentId, integration.id),
          description: `Configure ${integration.name} credentials for OpenCode.`,
          id: integration.id,
          label: integration.name,
        })),
      }
    }
    if (!isNativeAgentId(agentId)) {
      const discovery = await this.#agents.probeAcpCatalog(agentId, new AbortController().signal)
      this.#rememberAcpAuth(agentId, discovery)
      if (discovery.status === "ready") this.#acpConnected.add(agentId)
      else this.#acpConnected.delete(agentId)
      const providerId = agentId
      if (discovery.status === "ready") this.#releaseProvider(agentId, providerId)
      return {
        agentId,
        connections:
          discovery.status === "ready"
            ? [
                {
                  detail: `ACP v${discovery.protocolVersion}`,
                  disconnectSupported: discovery.logoutSupported,
                  id: this.#connectionId(agentId, providerId),
                  methodId: null,
                  methodLabel: null,
                  providerId,
                  providerLabel:
                    discovery.authMethods.length === 0
                      ? "No authentication required"
                      : "Agent account",
                  source: "agent",
                  testSupported: true,
                },
              ]
            : [],
        mode: "single",
        providers: [
          {
            authMethods: discovery.authMethods.map(({ description, id, name }) => ({
              description,
              fields: [],
              id,
              label: name,
            })),
            busy: this.#isAuthBusy(agentId, providerId),
            description:
              discovery.authMethods.length === 0
                ? discovery.status === "ready"
                  ? `${agent.name} is ready without an authentication step.`
                  : `${agent.name} requires authentication but did not advertise a method.`
                : "Authenticate with this agent harness.",
            id: providerId,
            label: "Agent account",
          },
        ],
      }
    }
    return {
      agentId,
      connections: [],
      mode: "single",
      providers: [],
    }
  }

  #rememberAcpAuth(
    agentId: AgentId,
    discovery: {
      authMethods: Array<{
        args: string[]
        description: string | null
        env: Record<string, string>
        id: string
        name: string
        type: "agent" | "terminal"
      }>
      logoutSupported: boolean
    }
  ): void {
    this.#acpAuthMethods.set(
      agentId,
      discovery.authMethods.map((method) => ({
        description: method.description,
        args: method.args,
        env: method.env,
        id: method.id,
        input: method.type === "terminal" ? ("terminal" as const) : ("none" as const),
        label: method.name,
      }))
    )
    this.#acpLogoutSupported.set(agentId, discovery.logoutSupported)
  }

  async #startAuth(
    agentId: AgentId,
    providerId: string,
    methodId: string,
    suppliedValues: AuthValues | undefined,
    sessionId: string,
    send: Send
  ) {
    const view = await this.#view(agentId)
    const provider = view.providers.find((candidate) => candidate.id === providerId)
    if (!provider) throw new Error("Authentication provider is no longer available")
    const method = provider.authMethods.find((candidate) => candidate.id === methodId)
    if (!method) {
      throw new Error("Authentication method does not belong to the selected provider")
    }
    if (view.connections.some((connection) => connection.providerId === providerId)) {
      throw new Error("This provider is already configured; disconnect it before changing methods")
    }
    const key = this.#reserveAuth(agentId, providerId)
    try {
      const values = validateAuthValues(method.fields, suppliedValues)
      const flow = await this.#startAuthFlow(agentId, providerId, methodId, values, sessionId, send)
      if (flow.state === "pending" && flow.flowId) {
        this.#trackFlow(flow.flowId, key, agentId, sessionId)
      } else {
        this.#releaseProvider(agentId, providerId)
      }
      return flow
    } catch (error) {
      this.#releaseProvider(agentId, providerId)
      throw error
    }
  }

  async #startAuthFlow(
    agentId: AgentId,
    providerId: string,
    methodId: string,
    values: AuthValues,
    sessionId: string,
    send: Send
  ): Promise<HarnessAuthFlow> {
    if (!isNativeAgentId(agentId)) {
      if (providerId !== agentId) throw new Error("Invalid ACP authentication provider")
      let method = this.#acpAuthMethods.get(agentId)?.find((item) => item.id === methodId)
      if (!method) {
        const discovery = await this.#agents.discoverAcpAuth(agentId, new AbortController().signal)
        this.#rememberAcpAuth(agentId, discovery)
        method = this.#acpAuthMethods.get(agentId)?.find((item) => item.id === methodId)
      }
      if (!method) throw new Error("Authentication method is no longer available")
      if (method.input === "terminal") {
        return this.#startTerminalAuth(
          agentId,
          providerId,
          methodId,
          method.args,
          method.env,
          sessionId,
          send
        )
      }
      await this.#agents.authenticateAcp(agentId, methodId, new AbortController().signal)
      this.#acpConnected.add(agentId)
      this.catalog.invalidate(agentId)
      return { state: "completed" as const }
    }
    if (agentId === "pi") {
      if (
        methodId !== "api_key" &&
        methodId !== "oauth" &&
        methodId !== "oauth:browser" &&
        methodId !== "oauth:device_code"
      ) {
        throw new Error(`Invalid Pi authentication method: ${methodId}`)
      }
      return this.#startPiAuth(
        providerId,
        methodId === "api_key" ? "api_key" : "oauth",
        sessionId,
        methodId === "oauth:browser"
          ? ["browser"]
          : methodId === "oauth:device_code"
            ? ["device_code"]
            : []
      )
    }
    if (agentId === "opencode") {
      const match = /^(command|key|oauth):([^:]+)$/u.exec(methodId)
      if (!match) throw new Error(`Invalid OpenCode authentication method: ${methodId}`)
      const [, type, encodedMethodId] = match
      if (!type || !encodedMethodId) {
        throw new Error(`Invalid OpenCode authentication method: ${methodId}`)
      }
      const method = decodeURIComponent(encodedMethodId)
      if (type === "key") {
        const key = values.key
        if (typeof key !== "string" || !key) throw new Error("An API key is required")
        const result = await this.#agents.callOpenCode("integration.connect.key", {
          body: { answer: values, integrationID: providerId, key },
        })
        if (!result.ok) throw new Error(`OpenCode authentication failed (${result.status})`)
        try {
          await this.#agents.verifyOpenCodeConnection(providerId)
        } catch (error) {
          await this.#removeOpenCodeCredentials(providerId).catch(() => undefined)
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`API key validation failed: ${message}`, { cause: error })
        }
        this.catalog.invalidate(agentId)
        return { state: "completed" as const }
      }
      if (type === "command") {
        const result = await this.#agents.callOpenCode("integration.command.connect", {
          body: { integrationID: providerId, methodID: method },
        })
        if (!result.ok) throw new Error(`OpenCode command authentication failed (${result.status})`)
        const attempt = (result.data as { data?: unknown })?.data as { attemptID: string } | null
        if (!attempt) throw new Error("OpenCode did not start command authentication")
        return {
          deviceCode: null,
          externalUrl: null,
          flowId: `opencode:command:${encodeURIComponent(providerId)}:${encodeURIComponent(attempt.attemptID)}`,
          input: "none" as const,
          inputOptions: [],
          message: "Complete authentication in the provider command.",
          placeholder: null,
          state: "pending" as const,
          terminalId: null,
        }
      }
      const result = await this.#agents.callOpenCode("integration.oauth.connect", {
        body: { answer: values, integrationID: providerId, methodID: method },
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
        deviceCode: null,
        externalUrl: authorization.url ?? null,
        flowId: `opencode:oauth:${encodeURIComponent(providerId)}:${encodeURIComponent(authorization.attemptID)}`,
        input: authorization.mode === "code" ? ("text" as const) : ("none" as const),
        inputOptions: [],
        message: authorization.instructions ?? "Complete provider sign in.",
        placeholder: authorization.mode === "code" ? "Authorization code" : null,
        state: "pending" as const,
        terminalId: null,
      }
    }
    if (agentId !== "codex") {
      if (agentId === "claude" && (methodId === "subscription" || methodId === "console")) {
        return this.#startTerminalAuth(
          agentId,
          providerId,
          methodId,
          ["auth", "login", methodId === "console" ? "--console" : "--claudeai"],
          {},
          sessionId,
          send
        )
      }
      throw new Error(`${agentId} authentication requires its installed provider flow`)
    }
    if (providerId !== "openai") throw new Error("Invalid Codex authentication provider")
    if (methodId !== "apiKey" && methodId !== "chatgpt" && methodId !== "chatgptDeviceCode") {
      throw new Error(`Unsupported Codex authentication method: ${methodId}`)
    }
    const apiKey = values.key
    if (methodId === "apiKey" && (typeof apiKey !== "string" || !apiKey)) {
      throw new Error("An API key is required")
    }
    const result = await this.#codex.login(
      methodId === "apiKey" ? { apiKey: apiKey as string, type: methodId } : { type: methodId }
    )
    this.catalog.invalidate(agentId)
    if (result.type === "apiKey") return { state: "completed" as const }
    if (result.type === "chatgpt") {
      this.#codexAuthFlows.set(result.loginId, new AbortController())
      return {
        deviceCode: null,
        externalUrl: result.authUrl,
        flowId: result.loginId,
        input: "none" as const,
        inputOptions: [],
        message: "Complete sign in in your browser.",
        placeholder: null,
        state: "pending" as const,
        terminalId: null,
      }
    }
    if (result.type === "chatgptDeviceCode") {
      this.#codexAuthFlows.set(result.loginId, new AbortController())
      return {
        deviceCode: {
          expiresInSeconds: null,
          intervalSeconds: null,
          userCode: result.userCode,
          verificationUri: result.verificationUrl,
        },
        externalUrl: result.verificationUrl,
        flowId: result.loginId,
        input: "none" as const,
        inputOptions: [],
        message: "Enter this code on the authentication page.",
        placeholder: null,
        state: "pending" as const,
        terminalId: null,
      }
    }
    return { state: "completed" as const }
  }

  async #cancelAuth(agentId: AgentId, flowId: string, sessionId: string) {
    const owner = this.#flowSessions.get(flowId)
    if (owner && (owner.agentId !== agentId || owner.sessionId !== sessionId)) {
      return { cancelled: false }
    }
    const terminal = this.#terminalAuthFlows.get(flowId)
    if (terminal?.agentId === agentId && terminal.sessionId === sessionId) {
      this.#terminals.close(terminal.terminalId, sessionId)
      this.#terminalAuthFlows.delete(flowId)
      this.#releaseFlow(flowId)
      return { cancelled: true }
    }
    if (agentId === "pi") {
      const flow = this.#piAuthFlows.get(flowId)
      if (!flow) return { cancelled: false }
      flow.controller.abort()
      flow.prompt?.reject(new Error("Authentication cancelled"))
      this.#piAuthFlows.delete(flowId)
      this.#releaseFlow(flowId)
      return { cancelled: true }
    }
    if (agentId === "opencode") {
      const match = /^opencode:(command|oauth):([^:]+):([^:]+)$/u.exec(flowId)
      if (!match?.[1] || !match[2] || !match[3]) return { cancelled: false }
      const result = await this.#agents.callOpenCode(
        match[1] === "command" ? "integration.command.cancel" : "integration.oauth.cancel",
        {
          body: {
            attemptID: decodeURIComponent(match[3]),
            integrationID: decodeURIComponent(match[2]),
          },
        }
      )
      if (result.ok) this.#releaseFlow(flowId)
      return { cancelled: result.ok }
    }
    if (agentId !== "codex") return { cancelled: false }
    this.#codexAuthFlows.get(flowId)?.abort()
    this.#codexAuthFlows.delete(flowId)
    const result = await this.#codex.call<{ status: string }>("account/login/cancel", {
      loginId: flowId,
    })
    const cancelled = result.status === "canceled"
    if (cancelled) this.#releaseFlow(flowId)
    return { cancelled }
  }

  async #respondAuth(agentId: AgentId, flowId: string, response: string) {
    if (agentId === "pi") {
      const flow = this.#piAuthFlows.get(flowId)
      if (!flow?.prompt) throw new Error("Pi is not waiting for a response")
      const prompt = flow.prompt
      flow.prompt = undefined
      prompt.resolve(response)
      const next = await this.#nextPiEvent(flowId, flow)
      if (next.state !== "pending") this.#releaseFlow(flowId)
      return next
    }
    if (agentId !== "opencode") throw new Error(`${agentId} does not accept this response`)
    const match = /^opencode:oauth:([^:]+):([^:]+)$/u.exec(flowId)
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
    this.#releaseFlow(flowId)
    return { state: "completed" as const }
  }

  async #pollAuth(agentId: AgentId, flowId: string, sessionId: string): Promise<HarnessAuthFlow> {
    const owner = this.#flowSessions.get(flowId)
    if (!owner || owner.agentId !== agentId || owner.sessionId !== sessionId) {
      throw new Error("Authentication flow was not found")
    }
    if (agentId === "pi") {
      const flow = this.#piAuthFlows.get(flowId)
      if (!flow) throw new Error("Authentication flow was not found")
      return this.#nextPiEvent(flowId, flow)
    }
    if (agentId === "opencode") {
      const match = /^opencode:(command|oauth):([^:]+):([^:]+)$/u.exec(flowId)
      if (!match?.[1] || !match[2] || !match[3]) throw new Error("Invalid OpenCode auth flow")
      const kind = match[1]
      const integrationID = decodeURIComponent(match[2])
      const attemptID = decodeURIComponent(match[3])
      const result = await this.#agents.callOpenCode(
        kind === "command" ? "integration.command.status" : "integration.oauth.status",
        { body: { attemptID, integrationID } }
      )
      if (!result.ok) throw new Error(`OpenCode authentication status failed (${result.status})`)
      const status = (result.data as { data?: { message?: string; status?: string } })?.data
      if (status?.status === "complete") {
        this.catalog.invalidate(agentId)
        this.#releaseFlow(flowId)
        return { state: "completed" }
      }
      if (status?.status === "failed" || status?.status === "expired") {
        this.#releaseFlow(flowId)
        return {
          message:
            status.message ??
            (status.status === "expired"
              ? "The authentication attempt expired."
              : "Authentication failed."),
          state: "failed",
        }
      }
      return {
        deviceCode: null,
        externalUrl: null,
        flowId,
        input: "none",
        inputOptions: [],
        message: status?.message ?? "Waiting for authentication to complete.",
        placeholder: null,
        state: "pending",
        terminalId: null,
      }
    }
    if (agentId === "codex") {
      const controller = this.#codexAuthFlows.get(flowId)
      if (!controller) throw new Error("Authentication flow was not found")
      const result = await this.#agents.waitForCodexLogin(flowId, controller.signal)
      this.#codexAuthFlows.delete(flowId)
      this.#releaseFlow(flowId)
      if (!result.success) {
        return { message: result.error ?? "Codex authentication failed.", state: "failed" }
      }
      this.catalog.invalidate(agentId)
      return { state: "completed" }
    }
    throw new Error("This authentication flow does not support polling")
  }

  async #logout(agentId: AgentId, connectionId: string): Promise<void> {
    const view = await this.#view(agentId)
    const connection = view.connections.find((candidate) => candidate.id === connectionId)
    if (!connection) throw new Error("Authentication connection was not found")
    if (!connection.disconnectSupported) {
      throw new Error("This authentication connection is managed outside Cypheria")
    }
    if (agentId === "opencode") {
      await this.#removeOpenCodeCredentials(connection.providerId)
    } else if (agentId === "pi") {
      await this.#agents.logoutPi(connection.providerId)
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

  async #testAuth(agentId: AgentId, connectionId: string): Promise<HarnessAuthTestResult> {
    const startedAt = Date.now()
    const testedAt = new Date().toISOString()
    try {
      const view = await this.#view(agentId)
      const connection = view.connections.find((candidate) => candidate.id === connectionId)
      if (!connection) throw new Error("Authentication connection was not found")
      if (!connection.testSupported) {
        return {
          latencyMs: Date.now() - startedAt,
          message: "Connection test unavailable.",
          status: "unsupported",
          testedAt,
        }
      }
      if (agentId === "codex") {
        const account = await this.#codex.account(true)
        if (!account.type) throw new Error("Codex did not return an authenticated account")
      } else if (agentId === "claude") {
        const catalog = await this.#agents.getClaudeCatalog()
        if (!catalog.account.email && !catalog.account.organization) {
          throw new Error("Claude did not return an authenticated account")
        }
      } else if (agentId === "pi") {
        await this.#agents.verifyPiConnection(connection.providerId)
      } else if (agentId === "opencode") {
        await this.#agents.verifyOpenCodeConnection(connection.providerId)
      } else {
        const probe = await this.#agents.probeAcpCatalog(agentId, new AbortController().signal)
        if (probe.status !== "ready") throw new Error("The agent still requires authentication")
      }
      return {
        latencyMs: Date.now() - startedAt,
        message: "Connection test succeeded.",
        status: "succeeded",
        testedAt,
      }
    } catch {
      return {
        latencyMs: Date.now() - startedAt,
        message: "Connection test failed.",
        status: "failed",
        testedAt,
      }
    }
  }

  async #removeOpenCodeCredentials(providerId: string): Promise<void> {
    const result = await this.#agents.callOpenCode("integration.list")
    if (!result.ok) throw new Error(`OpenCode integration discovery failed (${result.status})`)
    const integrations = ((result.data as { data?: unknown[] })?.data ?? []) as Array<{
      connections: Array<{ id?: string; type: "credential" | "env" }>
      id: string
    }>
    const credentialIds = integrations
      .filter((integration) => integration.id === providerId)
      .flatMap((integration) =>
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
  }

  async #startTerminalAuth(
    agentId: AgentId,
    providerId: string,
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
        this.#releaseFlow(flowId)
      }
    )
    this.#terminalAuthFlows.set(flowId, {
      agentId,
      providerId,
      sessionId,
      terminalId: terminal.terminalId,
    })
    return {
      deviceCode: null,
      externalUrl: null,
      flowId,
      input: "none",
      inputOptions: [],
      message: `Complete ${methodId} authentication in the terminal.`,
      placeholder: null,
      state: "pending",
      terminalId: terminal.terminalId,
    }
  }

  async #discover(agentId: AgentId, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason
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
        settingSections: [],
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
        settingSections: [],
      }
    }
    if (agentId === "opencode") {
      const [modelResult, defaultResult, providerResult] = await Promise.all([
        this.#agents.callOpenCode("model.list"),
        this.#agents.callOpenCode("model.default"),
        this.#agents.callOpenCode("provider.list"),
      ])
      if (!modelResult.ok)
        throw new Error(`OpenCode model discovery failed (${modelResult.status})`)
      if (!defaultResult.ok)
        throw new Error(`OpenCode default model discovery failed (${defaultResult.status})`)
      if (!providerResult.ok)
        throw new Error(`OpenCode provider discovery failed (${providerResult.status})`)
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
        settingSections: [],
      }
    }
    if (!isNativeAgentId(agentId)) {
      const probe = await this.#agents.probeAcpCatalog(agentId, signal)
      this.#rememberAcpAuth(agentId, probe)
      if (probe.status === "authentication-required") {
        this.#acpConnected.delete(agentId)
        return { models: [], settingSections: [], status: probe.status }
      }
      this.#acpConnected.add(agentId)
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
        settingSections: [],
      }
    }
    if (agentId !== "codex") {
      return { models: [], settingSections: [] }
    }

    const [models, permissions, settings] = await Promise.all([
      this.#codex.models(false),
      this.#codex.permissionDefaults(),
      this.#codex.agentSettings(),
    ])
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
        section("settings", "Settings", 30, [
          select(
            "approvalPolicy",
            "Approval policy",
            permissions.approvalPolicy,
            (permissions.allowedApprovalPolicies ?? ["on-request", "never"])
              .filter((id) => id === "on-request" || id === "never")
              .map((id) => option(id))
          ),
          select(
            "approvalsReviewer",
            "Approval reviewer",
            permissions.approvalsReviewer,
            [option("user", "User"), option("auto_review", "Auto review")].filter(
              (entry) =>
                permissions.allowedApprovalsReviewers?.includes(
                  entry.value as "user" | "auto_review"
                ) ?? true
            )
          ),
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
          select(
            "webSearch",
            "Web search",
            permissions.webSearch,
            [
              option("disabled", "Disabled"),
              option("cached", "Cached"),
              option("indexed", "Indexed"),
              option("live", "Live"),
            ].filter(
              (entry) =>
                permissions.allowedWebSearchModes?.includes(
                  entry.value as "disabled" | "cached" | "indexed" | "live"
                ) ?? true
            )
          ),
          select(
            "model",
            "Model",
            settings.model,
            models
              .filter((model) => !model.hidden)
              .map((model) => option(model.id, model.displayName))
          ),
          select("reasoningEffort", "Reasoning effort", settings.reasoningEffort, [
            option("low", "Light"),
            option("medium", "Medium"),
            option("high", "High"),
            option("xhigh", "Extra High"),
            option("max", "Max"),
            option("ultra", "Ultra"),
          ]),
          select("serviceTier", "Speed", settings.serviceTier, [
            option("default", "Standard"),
            option("priority", "Fast"),
          ]),
          select("personality", "Communication style", settings.personality, [
            option("friendly", "Friendly"),
            option("pragmatic", "Pragmatic"),
            option("none", "None"),
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
          boolean("pluginsEnabled", "Plugins", settings.pluginsEnabled),
        ]),
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
      await this.#codex.updateNativeSettings(values)
    } else {
      throw new Error(`${agentId} does not support updating native settings`)
    }
    this.catalog.invalidate(agentId)
    return this.catalog.get(agentId, true)
  }

  async #startPiAuth(
    providerId: string,
    type: "api_key" | "oauth",
    sessionId: string,
    presetSelectResponses: string[] = []
  ): Promise<HarnessAuthFlow> {
    const flowId = `pi:${randomUUID()}`
    const flow: PiAuthFlow = {
      agentId: "pi",
      controller: new AbortController(),
      events: [],
      providerId,
      sessionId,
      waiters: [],
    }
    this.#piAuthFlows.set(flowId, flow)
    void this.#agents
      .loginPi(providerId, type, {
        notify: (event) => {
          if (event.type === "auth_url") {
            this.#emitPiEvent(flow, {
              deviceCode: null,
              externalUrl: event.url,
              flowId,
              input: "none",
              inputOptions: [],
              message: event.instructions ?? "Complete sign in in your browser.",
              placeholder: null,
              state: "pending",
              terminalId: null,
            })
          } else if (event.type === "device_code") {
            this.#emitPiEvent(flow, {
              deviceCode: {
                expiresInSeconds: event.expiresInSeconds ?? null,
                intervalSeconds: event.intervalSeconds ?? null,
                userCode: event.userCode,
                verificationUri: event.verificationUri,
              },
              externalUrl: event.verificationUri,
              flowId,
              input: "none",
              inputOptions: [],
              message: "Enter this code on the authentication page.",
              placeholder: null,
              state: "pending",
              terminalId: null,
            })
          } else if (event.type === "info" || event.type === "progress") {
            this.#emitPiEvent(flow, {
              deviceCode: null,
              externalUrl: event.type === "info" ? (event.links?.[0]?.url ?? null) : null,
              flowId,
              input: "none",
              inputOptions: [],
              message: event.message,
              placeholder: null,
              state: "pending",
              terminalId: null,
            })
          }
        },
        prompt: (prompt) => {
          if (prompt.type === "select") {
            const preset = presetSelectResponses.shift()
            if (preset && prompt.options.some((option) => option.id === preset)) {
              return Promise.resolve(preset)
            }
          }
          return new Promise<string>((resolve, reject) => {
            flow.prompt = { reject, resolve }
            this.#emitPiEvent(flow, {
              deviceCode: null,
              externalUrl: null,
              flowId,
              input:
                prompt.type === "select" ? "select" : prompt.type === "secret" ? "secret" : "text",
              inputOptions:
                prompt.type === "select"
                  ? prompt.options.map((option) => ({
                      description: option.description ?? null,
                      label: option.label,
                      value: option.id,
                    }))
                  : [],
              message: prompt.message,
              placeholder:
                prompt.type === "text" || prompt.type === "secret" || prompt.type === "manual_code"
                  ? (prompt.placeholder ?? null)
                  : null,
              state: "pending",
              terminalId: null,
            })
          })
        },
        signal: flow.controller.signal,
      })
      .then(async () => {
        if (type === "api_key") {
          try {
            await this.#agents.verifyPiConnection(providerId)
          } catch (error) {
            await this.#agents.logoutPi(providerId).catch(() => undefined)
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`API key validation failed: ${message}`, { cause: error })
          }
        }
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
    if (next.state === "completed" || next.state === "failed") {
      this.#piAuthFlows.delete(flowId)
      this.#releaseFlow(flowId)
    }
    return next
  }
}
