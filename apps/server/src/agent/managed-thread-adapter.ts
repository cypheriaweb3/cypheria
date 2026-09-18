import { randomUUID } from "node:crypto"

import type {
  AgentId,
  RegistryAgentId,
  ThreadCapabilities,
  ThreadInputBlock,
  ThreadTimelineItem,
} from "@cypheria/protocol"

import type {
  ThreadInteractionResponse,
  ThreadProviderAdapter,
  ThreadProviderContext,
  ThreadProviderCreateInput,
  ThreadProviderEvent,
  ThreadProviderHistoryItem,
  ThreadProviderResumeInput,
  ThreadProviderSession,
  ThreadProviderTurnInput,
} from "../thread/provider-adapter.js"
import type { AgentManager, AgentRuntimeServerMessage } from "./agent-manager.js"

type Pending = {
  readonly expectedType: string
  readonly reject: (error: Error) => void
  readonly resolve: (message: AgentRuntimeServerMessage) => void
  readonly timeout: NodeJS.Timeout
}

const capabilities = (agentId: AgentId, acp?: Record<string, unknown>): ThreadCapabilities => {
  const prompt = (acp?.promptCapabilities ?? {}) as Record<string, unknown>
  const session = (acp?.sessionCapabilities ?? {}) as Record<string, unknown>
  return {
    changeCwd: true,
    configure: true,
    fork: agentId === "codex" || agentId === "opencode" || session.fork != null,
    promptContent: [
      "text",
      ...(agentId === "codex" || agentId === "opencode" || prompt.image === true
        ? (["image"] as const)
        : []),
      ...(agentId === "codex" || prompt.audio === true ? (["audio"] as const) : []),
      ...(agentId !== "codex" ? (["resource-link"] as const) : []),
      ...(prompt.embeddedContext === true ? (["embedded-resource"] as const) : []),
    ],
    providerExtensions: false,
  }
}

const payloadOf = (message: AgentRuntimeServerMessage): Record<string, unknown> =>
  "payload" in message && message.payload && typeof message.payload === "object"
    ? (message.payload as Record<string, unknown>)
    : {}

const requestIdOf = (message: AgentRuntimeServerMessage): string | number | null | undefined => {
  if ("requestId" in message) return message.requestId
  return payloadOf(message).requestId as string | number | null | undefined
}

const resultOf = (message: AgentRuntimeServerMessage): Record<string, unknown> => {
  const payload = payloadOf(message)
  if (payload.error) {
    const error = payload.error as { code?: string; message?: string }
    const failure = new Error(error.message ?? "Provider request failed")
    failure.name = error.code ?? "PROVIDER_ERROR"
    throw failure
  }
  return (payload.result as Record<string, unknown> | undefined) ?? payload
}

const stringId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const mapInput = (content: readonly ThreadInputBlock[]): unknown[] =>
  content.map((block) => {
    switch (block.type) {
      case "text":
        return { text: block.text, type: "text", text_elements: [] }
      case "image":
        return { type: "image", url: `data:${block.mimeType};base64,${block.data}` }
      case "audio":
        return { type: "audio", url: `data:${block.mimeType};base64,${block.data}` }
      case "resource-link":
        return { text: block.uri, type: "text", text_elements: [] }
      case "embedded-resource":
        return {
          text: `Embedded resource ${block.uri} (${block.mimeType}):\n${block.data}`,
          type: "text",
          text_elements: [],
        }
    }
    throw new Error("Unsupported thread input block")
  })

const mapAcpInput = (content: readonly ThreadInputBlock[]): unknown[] =>
  content.map((block) => {
    switch (block.type) {
      case "text":
        return { text: block.text, type: "text" }
      case "image":
        return { data: block.data, mimeType: block.mimeType, type: "image" }
      case "audio":
        return { data: block.data, mimeType: block.mimeType, type: "audio" }
      case "resource-link":
        return { name: block.name, type: "resource_link", uri: block.uri }
      case "embedded-resource":
        return {
          resource: {
            blob: block.data,
            mimeType: block.mimeType,
            uri: block.uri,
          },
          type: "resource",
        }
    }
    throw new Error("Unsupported ACP input block")
  })

const mapOpenCodeInput = (content: readonly ThreadInputBlock[]): unknown[] =>
  content.map((block) => {
    if (block.type === "text") return { text: block.text, type: "text" }
    if (block.type === "image" || block.type === "audio") {
      return {
        mime: block.mimeType,
        type: "file",
        url: `data:${block.mimeType};base64,${block.data}`,
      }
    }
    return {
      text: block.type === "resource-link" ? block.uri : `${block.uri}\n${block.data}`,
      type: "text",
    }
  })

const extractThread = (result: Record<string, unknown>): Record<string, unknown> =>
  result.thread && typeof result.thread === "object"
    ? (result.thread as Record<string, unknown>)
    : result

const mapCodexHistory = (thread: Record<string, unknown>): ThreadProviderHistoryItem[] => {
  const history: ThreadProviderHistoryItem[] = []
  for (const turn of Array.isArray(thread.turns) ? thread.turns : []) {
    if (!turn || typeof turn !== "object") continue
    const turnRecord = turn as Record<string, unknown>
    for (const item of Array.isArray(turnRecord.items) ? turnRecord.items : []) {
      const mapped = mapProviderItem(item)
      if (mapped)
        history.push({
          item: mapped,
          providerItemId: mapped.itemId,
          turnId: stringId(turnRecord.id),
        })
    }
  }
  return history
}

const mapProviderItem = (value: unknown): ThreadTimelineItem | undefined => {
  if (!value || typeof value !== "object") return undefined
  const item = value as Record<string, unknown>
  const itemId = stringId(item.id ?? item.itemId ?? item.callID ?? item.callId) ?? randomUUID()
  const type = String(item.type ?? "")
  const text =
    typeof item.text === "string"
      ? item.text
      : typeof item.content === "string"
        ? item.content
        : undefined
  if (type.includes("reasoning") && text !== undefined) {
    return { itemId, operation: "replace", text, type: "reasoning" }
  }
  if ((type.includes("message") || type === "text") && text !== undefined) {
    return {
      itemId,
      operation: "replace",
      role: type.includes("user") || item.role === "user" ? "user" : "assistant",
      text,
      type: "message",
    }
  }
  if (type.includes("tool") || type.includes("command") || type.includes("file")) {
    return {
      error: typeof item.error === "string" ? item.error : null,
      input: item.input ?? item.command ?? null,
      itemId,
      name: String(item.name ?? item.tool ?? (type || "tool")),
      output: item.output ?? null,
      status:
        item.status === "failed" || item.status === "cancelled" || item.status === "completed"
          ? item.status
          : "running",
      type: "tool",
    }
  }
  return undefined
}

/** Bridges existing native/raw runtimes into server-owned Thread semantics. */
export class ManagedThreadAdapter implements ThreadProviderAdapter {
  readonly agentId: AgentId
  readonly #manager: AgentManager
  readonly #pending = new Map<string, Pending>()
  readonly #reverse = new Map<string, AgentRuntimeServerMessage>()
  #acpCapabilities: Record<string, unknown> | undefined
  #onEvent: ((event: ThreadProviderEvent) => void) | undefined
  #providerSessionId: string | null = null

  constructor(manager: AgentManager, agentId: AgentId) {
    this.#manager = manager
    this.agentId = agentId
  }

  async create(input: ThreadProviderCreateInput): Promise<ThreadProviderSession> {
    this.#attach(input.onEvent)
    if (this.agentId === "codex") {
      const response = await this.#request(
        input.threadId,
        input.forkedFromAgentSessionId
          ? {
              cwd: input.cwd,
              excludeTurns: false,
              requestId: randomUUID(),
              threadId: input.forkedFromAgentSessionId,
              type: "agent.codex.thread.fork.request",
            }
          : {
              cwd: input.cwd,
              requestId: randomUUID(),
              type: "agent.codex.thread.start.request",
            }
      )
      const thread = extractThread(resultOf(response))
      const sessionId = stringId(thread.id)
      this.#providerSessionId = sessionId
      return {
        capabilities: capabilities(this.agentId),
        history: mapCodexHistory(thread),
        sessionId,
      }
    }
    if (this.agentId === "opencode") {
      const response = await this.#openCodeCall(
        input.threadId,
        input.forkedFromAgentSessionId
          ? {
              body: {},
              operation: `POST /session/${encodeURIComponent(input.forkedFromAgentSessionId)}/fork`,
              query: input.cwd ? { directory: input.cwd } : undefined,
            }
          : {
              body: {},
              operation: "POST /session",
              query: input.cwd ? { directory: input.cwd } : undefined,
            }
      )
      const session = resultOf(response).data as Record<string, unknown>
      await this.#subscribeOpenCode(input.threadId)
      const sessionId = stringId(session.id)
      this.#providerSessionId = sessionId
      return { capabilities: capabilities(this.agentId), sessionId }
    }
    if (this.agentId === "claude" || this.agentId === "pi") {
      if (input.forkedFromAgentSessionId) {
        throw new Error(`${this.agentId} does not expose a native empty-session fork`)
      }
      this.#providerSessionId = null
      return { capabilities: capabilities(this.agentId), sessionId: null }
    }
    return this.#createAcp(input)
  }

  async resume(input: ThreadProviderResumeInput): Promise<ThreadProviderSession> {
    this.#attach(input.onEvent)
    if (this.agentId === "codex") {
      if (!input.agentSessionId) return this.create({ ...input, forkedFromAgentSessionId: null })
      const response = await this.#request(input.threadId, {
        cwd: input.cwd,
        excludeTurns: false,
        requestId: randomUUID(),
        threadId: input.agentSessionId,
        type: "agent.codex.thread.resume.request",
      })
      const thread = extractThread(resultOf(response))
      const sessionId = stringId(thread.id)
      this.#providerSessionId = sessionId
      return {
        capabilities: capabilities(this.agentId),
        history: mapCodexHistory(thread),
        sessionId,
      }
    }
    if (this.agentId === "opencode") {
      if (!input.agentSessionId) return this.create({ ...input, forkedFromAgentSessionId: null })
      const response = await this.#openCodeCall(input.threadId, {
        operation: `GET /session/${encodeURIComponent(input.agentSessionId)}/message`,
        query: input.cwd ? { directory: input.cwd } : undefined,
      })
      await this.#subscribeOpenCode(input.threadId)
      this.#providerSessionId = input.agentSessionId
      return {
        capabilities: capabilities(this.agentId),
        history: this.#mapOpenCodeHistory(resultOf(response).data),
        sessionId: input.agentSessionId,
      }
    }
    if (this.agentId === "claude" || this.agentId === "pi") {
      this.#providerSessionId = input.agentSessionId
      return { capabilities: capabilities(this.agentId), sessionId: input.agentSessionId }
    }
    return this.#resumeAcp(input)
  }

  async close(context: ThreadProviderContext): Promise<void> {
    if (
      this.agentId !== "codex" &&
      this.agentId !== "opencode" &&
      this.agentId !== "claude" &&
      this.agentId !== "pi" &&
      context.agentSessionId
    ) {
      await this.#request(context.threadId, {
        agent: this.agentId,
        protocolVersion: 1,
        requestId: randomUUID(),
        sessionId: context.agentSessionId,
        type: "agent.acp.session.close.request",
      })
    } else if (this.agentId === "claude" && this.#providerSessionId) {
      await this.#request(context.threadId, {
        queryId: context.threadId,
        requestId: randomUUID(),
        type: "agent.claude.query.close.request",
      })
    }
    await this.#manager.disposeSession(context.threadId)
    this.#onEvent = undefined
  }

  async delete(context: ThreadProviderContext): Promise<void> {
    if (this.agentId === "codex" && context.agentSessionId) {
      await this.#request(context.threadId, {
        requestId: randomUUID(),
        threadId: context.agentSessionId,
        type: "agent.codex.thread.delete.request",
      })
    } else if (this.agentId === "opencode" && context.agentSessionId) {
      await this.#openCodeCall(context.threadId, {
        operation: `DELETE /session/${encodeURIComponent(context.agentSessionId)}`,
        query: context.cwd ? { directory: context.cwd } : undefined,
      })
    } else if (this.agentId !== "claude" && this.agentId !== "pi" && context.agentSessionId) {
      if (!this.#supportsAcp("delete")) throw new Error("ACP agent lacks session.delete capability")
      await this.#request(context.threadId, {
        agent: this.agentId,
        sessionId: context.agentSessionId,
        protocolVersion: 1,
        requestId: randomUUID(),
        type: "agent.acp.session.delete.request",
      })
    }
    if (this.agentId !== "codex" && this.agentId !== "opencode" && this.agentId !== "claude" && this.agentId !== "pi") {
      await this.#manager.disposeSession(context.threadId)
      this.#onEvent = undefined
    } else {
      await this.close(context)
    }
    this.#manager.releaseThreadAdapter(this.agentId, context.threadId)
  }

  async startTurn(input: ThreadProviderTurnInput): Promise<{ turnId: string }> {
    if (this.agentId === "codex") {
      if (!input.agentSessionId) throw new Error("Codex thread is not bound")
      const response = await this.#request(input.threadId, {
        clientUserMessageId: input.clientMessageId,
        input: mapInput(input.content),
        requestId: randomUUID(),
        threadId: input.agentSessionId,
        type: "agent.codex.turn.start.request",
      })
      const turn = resultOf(response).turn as Record<string, unknown>
      return { turnId: stringId(turn?.id) ?? input.clientMessageId }
    }
    if (this.agentId === "opencode") {
      if (!input.agentSessionId) throw new Error("OpenCode thread is not bound")
      await this.#openCodeCall(input.threadId, {
        body: { messageID: input.clientMessageId, parts: mapOpenCodeInput(input.content) },
        operation: `POST /session/${encodeURIComponent(input.agentSessionId)}/prompt_async`,
        query: input.cwd ? { directory: input.cwd } : undefined,
      })
      return { turnId: input.clientMessageId }
    }
    if (this.agentId === "claude") {
      await this.#request(input.threadId, {
        options: {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.agentSessionId ? { resume: input.agentSessionId } : {}),
        },
        prompt: input.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        queryId: input.threadId,
        requestId: randomUUID(),
        type: "agent.claude.query.start.request",
      })
      return { turnId: input.clientMessageId }
    }
    if (this.agentId === "pi") {
      await this.#request(input.threadId, {
        payload: {
          images: input.content
            .filter((block) => block.type === "image")
            .map((block) => ({ data: block.data, mimeType: block.mimeType, type: "image" })),
          message: input.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
        },
        requestId: randomUUID(),
        type: "agent.pi.prompt.request",
      })
      return { turnId: input.clientMessageId }
    }
    if (!input.agentSessionId) throw new Error("ACP thread is not bound")
    await this.#request(input.threadId, {
      agent: this.agentId,
      prompt: mapAcpInput(input.content),
      protocolVersion: 1,
      requestId: randomUUID(),
      type: "agent.acp.session.prompt.request",
    })
    return { turnId: input.clientMessageId }
  }

  async cancelTurn(context: ThreadProviderContext & { turnId?: string }): Promise<void> {
    if (this.agentId === "codex" && context.agentSessionId && context.turnId) {
      await this.#request(context.threadId, {
        requestId: randomUUID(),
        threadId: context.agentSessionId,
        turnId: context.turnId,
        type: "agent.codex.turn.interrupt.request",
      })
    } else if (this.agentId === "opencode" && context.agentSessionId) {
      await this.#openCodeCall(context.threadId, {
        operation: `POST /session/${encodeURIComponent(context.agentSessionId)}/abort`,
        query: context.cwd ? { directory: context.cwd } : undefined,
      })
    } else if (this.agentId === "claude") {
      await this.#request(context.threadId, {
        queryId: context.threadId,
        requestId: randomUUID(),
        type: "agent.claude.query.interrupt.request",
      })
    } else if (this.agentId === "pi") {
      await this.#request(context.threadId, {
        payload: {},
        requestId: randomUUID(),
        type: "agent.pi.abort.request",
      })
    } else if (context.agentSessionId) {
      await this.#manager.handleAcp(
        {
          agent: this.agentId as RegistryAgentId,
          sessionId: context.agentSessionId,
          protocolVersion: 1,
          type: "agent.acp.session.cancel.notification",
        } as never,
        { send: this.#receive, sessionId: context.threadId }
      )
    }
  }

  async updateConfig(
    context: ThreadProviderContext,
    patch: {
      mode?: string | null
      model?: string | null
      providerOptions?: Readonly<Record<string, unknown>>
      thinking?: string | null
    }
  ): Promise<void> {
    if (this.agentId === "pi") {
      if (patch.model) {
        const [provider, modelId] = patch.model.split("/", 2)
        if (!provider || !modelId) throw new Error("Pi model must use provider/model format")
        await this.#request(context.threadId, {
          payload: { modelId, provider },
          requestId: randomUUID(),
          type: "agent.pi.model.set.request",
        })
      }
      if (patch.thinking) {
        await this.#request(context.threadId, {
          payload: { level: patch.thinking },
          requestId: randomUUID(),
          type: "agent.pi.thinking_level.set.request",
        })
      }
      return
    }
    if (this.agentId === "claude") {
      if (patch.model)
        await this.#request(context.threadId, {
          model: patch.model,
          queryId: context.threadId,
          requestId: randomUUID(),
          type: "agent.claude.query.model.set.request",
        })
      return
    }
    if (Object.values(patch).some((value) => value !== undefined)) {
      throw new Error(`${this.agentId} configuration mapping is not available for this option`)
    }
  }

  async respondToInteraction(
    context: ThreadProviderContext,
    interactionId: string,
    response: ThreadInteractionResponse
  ): Promise<void> {
    const reverse = this.#reverse.get(interactionId)
    if (!reverse) throw new Error("Provider interaction is no longer pending")
    this.#reverse.delete(interactionId)
    if (this.agentId === "codex") {
      const request = reverse as unknown as Record<string, unknown>
      await this.#manager.handleCodex(
        {
          payload: {
            decision:
              response.type === "permission" && response.outcome !== "deny"
                ? response.outcome === "allow_always"
                  ? "acceptForSession"
                  : "accept"
                : "decline",
            requestId: request.requestId,
          },
          type: String(request.type).replace(/\.request$/, ".response"),
        } as never,
        { send: this.#receive, sessionId: context.threadId }
      )
      return
    }
    if (this.agentId !== "opencode" && this.agentId !== "claude" && this.agentId !== "pi") {
      const request = reverse as unknown as Record<string, unknown>
      await this.#manager.handleAcp(
        {
          agent: this.agentId,
          payload: {
            requestId: requestIdOf(reverse),
            result:
              response.type === "permission"
                ? {
                    outcome:
                      response.outcome === "deny"
                        ? { outcome: "cancelled" }
                        : { optionId: response.outcome },
                  }
                : { action: "cancel" },
          },
          protocolVersion: 1,
          type: String(request.type).replace(/\.request$/, ".response"),
        } as never,
        { send: this.#receive, sessionId: context.threadId }
      )
      return
    }
    throw new Error(`${this.agentId} interaction response is not supported yet`)
  }

  async #createAcp(input: ThreadProviderCreateInput): Promise<ThreadProviderSession> {
    const initialized = resultOf(
      await this.#request(input.threadId, {
        agent: this.agentId,
        clientCapabilities: {},
        clientInfo: { name: "Cypheria", version: "0.0.0" },
        protocolVersion: 1,
        requestId: randomUUID(),
        type: "agent.acp.initialize.request",
      })
    )
    this.#acpCapabilities = (initialized.agentCapabilities as Record<string, unknown>) ?? {}
    if (!this.#supportsAcp("delete")) {
      await this.#manager.disposeSession(input.threadId)
      throw new Error("ACP agent must advertise sessionCapabilities.delete")
    }
    const response = await this.#request(input.threadId, {
      agent: this.agentId,
      ...(input.forkedFromAgentSessionId
        ? {
            cwd: input.cwd ?? process.cwd(),
            mcpServers: [],
            sessionId: input.forkedFromAgentSessionId,
          }
        : { cwd: input.cwd ?? process.cwd(), mcpServers: [] }),
      protocolVersion: 1,
      requestId: randomUUID(),
      type: input.forkedFromAgentSessionId
        ? "agent.acp.session.fork.request"
        : "agent.acp.session.new.request",
    })
    const sessionId = stringId(resultOf(response).sessionId)
    this.#providerSessionId = sessionId
    return {
      capabilities: capabilities(this.agentId, this.#acpCapabilities),
      sessionId,
    }
  }

  async #resumeAcp(input: ThreadProviderResumeInput): Promise<ThreadProviderSession> {
    if (!input.agentSessionId) return this.#createAcp({ ...input, forkedFromAgentSessionId: null })
    const initialized = resultOf(
      await this.#request(input.threadId, {
        agent: this.agentId,
        clientCapabilities: {},
        clientInfo: { name: "Cypheria", version: "0.0.0" },
        protocolVersion: 1,
        requestId: randomUUID(),
        type: "agent.acp.initialize.request",
      })
    )
    this.#acpCapabilities = (initialized.agentCapabilities as Record<string, unknown>) ?? {}
    if (!this.#supportsAcp("delete")) throw new Error("ACP agent lacks session.delete capability")
    const response = await this.#request(input.threadId, {
      agent: this.agentId,
      ...{
        cwd: input.cwd ?? process.cwd(),
        mcpServers: [],
        sessionId: input.agentSessionId,
      },
      protocolVersion: 1,
      requestId: randomUUID(),
      type: "agent.acp.session.load.request",
    })
    resultOf(response)
    this.#providerSessionId = input.agentSessionId
    return {
      capabilities: capabilities(this.agentId, this.#acpCapabilities),
      sessionId: input.agentSessionId,
    }
  }

  #supportsAcp(capability: "delete" | "fork"): boolean {
    const session = (this.#acpCapabilities?.sessionCapabilities ?? {}) as Record<string, unknown>
    return session[capability] != null
  }

  #attach(onEvent: (event: ThreadProviderEvent) => void): void {
    this.#onEvent = onEvent
  }

  async #request(
    threadId: string,
    message: Record<string, unknown>
  ): Promise<AgentRuntimeServerMessage> {
    const requestId = message.requestId
    if (typeof requestId !== "string") throw new Error("Internal provider requests use string ids")
    const expectedType = String(message.type).replace(/\.request$/, ".response")
    const response = new Promise<AgentRuntimeServerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error(`Provider request timed out: ${String(message.type)}`))
      }, 30_000)
      timeout.unref()
      this.#pending.set(requestId, { expectedType, reject, resolve, timeout })
    })
    try {
      const context = { send: this.#receive, sessionId: threadId }
      if (this.agentId === "codex") await this.#manager.handleCodex(message as never, context)
      else if (this.agentId === "claude")
        await this.#manager.handleClaude(message as never, context)
      else if (this.agentId === "pi") await this.#manager.handlePi(message as never, context)
      else await this.#manager.handleAcp(message as never, context)
      return await response
    } catch (error) {
      const pending = this.#pending.get(requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.#pending.delete(requestId)
      }
      throw error
    }
  }

  async #openCodeCall(
    threadId: string,
    payload: { body?: unknown; operation: string; query?: Record<string, unknown> }
  ): Promise<AgentRuntimeServerMessage> {
    const requestId = randomUUID()
    const response = new Promise<AgentRuntimeServerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error(`OpenCode request timed out: ${payload.operation}`))
      }, 30_000)
      timeout.unref()
      this.#pending.set(requestId, {
        expectedType: "agent.opencode.call.response",
        reject,
        resolve,
        timeout,
      })
    })
    await this.#manager.handleOpenCode(
      { payload, requestId, type: "agent.opencode.call.request" } as never,
      { send: this.#receive, sessionId: threadId }
    )
    return response
  }

  async #subscribeOpenCode(threadId: string): Promise<void> {
    const requestId = randomUUID()
    const subscriptionId = `thread:${threadId}`
    const response = new Promise<AgentRuntimeServerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error("OpenCode event subscription timed out"))
      }, 30_000)
      timeout.unref()
      this.#pending.set(requestId, {
        expectedType: "agent.opencode.event.subscribe.response",
        reject,
        resolve,
        timeout,
      })
    })
    await this.#manager.handleOpenCode(
      {
        payload: { stream: "global.event", subscriptionId },
        requestId,
        type: "agent.opencode.event.subscribe.request",
      } as never,
      { send: this.#receive, sessionId: threadId }
    )
    await response
  }

  readonly #receive = (message: AgentRuntimeServerMessage): void => {
    const requestId = requestIdOf(message)
    const key = requestId === undefined || requestId === null ? undefined : String(requestId)
    const pending = key ? this.#pending.get(key) : undefined
    if (pending && message.type === pending.expectedType) {
      clearTimeout(pending.timeout)
      this.#pending.delete(key as string)
      try {
        resultOf(message)
        pending.resolve(message)
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
      return
    }
    this.#mapMessage(message)
  }

  #mapMessage(message: AgentRuntimeServerMessage): void {
    const onEvent = this.#onEvent
    if (!onEvent) return
    const payload = payloadOf(message)
    const nativeSessionId = stringId(
      payload.sessionId ??
        payload.session_id ??
        (payload.message as Record<string, unknown> | undefined)?.session_id
    )
    if (nativeSessionId && nativeSessionId !== this.#providerSessionId) {
      this.#providerSessionId = nativeSessionId
      onEvent({ sessionId: nativeSessionId, type: "session-bound" })
    }
    if (message.type.endsWith(".request")) {
      const interactionId = `provider:${this.agentId}:${String(requestIdOf(message))}`
      this.#reverse.set(interactionId, message)
      onEvent({
        interaction: {
          createdAt: new Date().toISOString(),
          expiresAt: null,
          id: interactionId,
          kind:
            message.type.includes("permission") || message.type.includes("approval")
              ? "permission"
              : "elicitation",
          message: String(payload.message ?? payload.reason ?? message.type),
          options: [],
          title: null,
        },
        type: "interaction-requested",
      })
      return
    }
    if (message.type === "agent.opencode.event.notification") {
      const event = payload.event as Record<string, unknown>
      const properties = (event?.properties ?? {}) as Record<string, unknown>
      const eventSessionId = stringId(properties.sessionID ?? properties.sessionId)
      if (!eventSessionId || eventSessionId !== this.#providerSessionId) return
      if (event?.type === "session.idle") {
        onEvent({ turnId: stringId(properties.messageID) ?? "active", type: "turn-completed" })
        return
      }
      const item = mapProviderItem(properties.part ?? properties.message)
      if (item) onEvent({ item: { item, providerItemId: item.itemId }, type: "timeline" })
      return
    }
    if (message.type.includes("turn.completed") || message.type.includes("agent_end")) {
      onEvent({
        turnId: stringId(payload.turnId ?? payload.id) ?? "active",
        type: "turn-completed",
      })
      return
    }
    const item = mapProviderItem(payload.item ?? payload.message ?? payload.event ?? payload.update)
    if (item) onEvent({ item: { item, providerItemId: item.itemId }, type: "timeline" })
  }

  #mapOpenCodeHistory(value: unknown): ThreadProviderHistoryItem[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((message) => {
      if (!message || typeof message !== "object") return []
      const record = message as Record<string, unknown>
      const parts = Array.isArray(record.parts) ? record.parts : []
      return parts.flatMap((part) => {
        const item = mapProviderItem(part)
        return item ? [{ item, providerItemId: item.itemId }] : []
      })
    })
  }
}
