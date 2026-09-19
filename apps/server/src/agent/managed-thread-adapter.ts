import { randomUUID } from "node:crypto"

import type {
  AgentId,
  RegistryAgentId,
  ThreadCapabilities,
  ThreadInputBlock,
  ThreadTimelineItem,
} from "@cypheria/protocol"
import {
  AgentAcpClientMessageSchema,
  AgentClaudeClientMessageSchema,
  AgentCodexClientRequestSchema,
  AgentCodexServerResponseSchema,
  AgentOpenCodeCallRequestSchema,
  AgentOpenCodeEventSubscribeRequestSchema,
  AgentPiClientMessageSchema,
} from "@cypheria/protocol"

import type {
  ThreadHarnessAdapter,
  ThreadHarnessContext,
  ThreadHarnessCreateInput,
  ThreadHarnessEvent,
  ThreadHarnessHistoryItem,
  ThreadHarnessResumeInput,
  ThreadHarnessSession,
  ThreadHarnessSteerInput,
  ThreadHarnessTurnInput,
  ThreadInteractionResponse,
} from "../thread/harness-adapter.js"
import type { AgentManager, AgentRuntimeServerMessage } from "./agent-manager.js"
import type { ClaudePermissionHandler, ClaudePermissionRequest } from "./claude-session-runtime.js"

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
    harnessExtensions: false,
    steer: agentId === "codex" || agentId === "pi",
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

const codexPermissionDecision = (response: ThreadInteractionResponse): unknown => {
  if (response.type === "permission" && response.decision !== undefined) return response.decision
  if (response.type !== "permission" || response.outcome === "deny") return "decline"
  return response.outcome === "allow_always" ? "acceptForSession" : "accept"
}

const grantedCodexPermissions = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const permissions = value as Record<string, unknown>
  return {
    ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
    ...(permissions.network ? { network: permissions.network } : {}),
  }
}

const resultOf = (message: AgentRuntimeServerMessage): Record<string, unknown> => {
  const payload = payloadOf(message)
  if (payload.error) {
    const error = payload.error as { code?: string; message?: string }
    const failure = new Error(error.message ?? "Harness request failed")
    failure.name = error.code ?? "HARNESS_ERROR"
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

const mapCodexHistory = (thread: Record<string, unknown>): ThreadHarnessHistoryItem[] => {
  const history: ThreadHarnessHistoryItem[] = []
  for (const turn of Array.isArray(thread.turns) ? thread.turns : []) {
    if (!turn || typeof turn !== "object") continue
    const turnRecord = turn as Record<string, unknown>
    for (const item of Array.isArray(turnRecord.items) ? turnRecord.items : []) {
      const mapped = mapHarnessItem(item, "codex")
      if (mapped)
        history.push({
          item: mapped,
          harnessItemId: mapped.itemId,
          turnId: stringId(turnRecord.id),
        })
    }
  }
  return history
}

const mapTimelineStatus = (
  value: unknown
): "pending" | "running" | "completed" | "failed" | "cancelled" => {
  switch (value) {
    case "pending":
    case "queued":
      return "pending"
    case "completed":
    case "complete":
    case "success":
    case "succeeded":
      return "completed"
    case "failed":
    case "error":
      return "failed"
    case "cancelled":
    case "canceled":
      return "cancelled"
    default:
      return "running"
  }
}

const mapHarnessItem = (value: unknown, agentId: AgentId): ThreadTimelineItem | undefined => {
  if (!value || typeof value !== "object") return undefined
  const item = value as Record<string, unknown>
  const itemId = stringId(item.id ?? item.itemId ?? item.callID ?? item.callId) ?? randomUUID()
  const type = String(item.type ?? "unknown")
  const harnessData = { agentId, nativeType: type, payload: value }
  const text =
    typeof item.text === "string"
      ? item.text
      : typeof item.content === "string"
        ? item.content
        : undefined
  if (type.includes("reasoning") && text !== undefined) {
    return { itemId, operation: "replace", harnessData, text, type: "reasoning" }
  }
  if ((type.includes("message") || type === "text") && text !== undefined) {
    return {
      itemId,
      operation: "replace",
      harnessData,
      role: type.includes("user") || item.role === "user" ? "user" : "assistant",
      text,
      type: "message",
    }
  }
  if (type.includes("command")) {
    return {
      command: String(item.command ?? item.input ?? ""),
      cwd: typeof item.cwd === "string" ? item.cwd : null,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
      itemId,
      output: String(item.aggregatedOutput ?? item.output ?? ""),
      harnessData,
      status: mapTimelineStatus(item.status),
      type: "command",
    }
  }
  if (type.includes("file") && Array.isArray(item.changes) && item.changes.length > 0) {
    const changes = item.changes.flatMap((change) => {
      if (!change || typeof change !== "object") return []
      const record = change as Record<string, unknown>
      if (typeof record.path !== "string") return []
      const rawKind =
        typeof record.kind === "string"
          ? record.kind
          : String((record.kind as Record<string, unknown> | undefined)?.type ?? "update")
      const kind: "add" | "delete" | "move" | "update" =
        rawKind === "add" || rawKind === "delete" || rawKind === "move" ? rawKind : "update"
      return [
        {
          diff: typeof record.diff === "string" ? record.diff : "",
          kind,
          path: record.path,
          previousPath:
            typeof record.previousPath === "string"
              ? record.previousPath
              : typeof (record.kind as Record<string, unknown> | undefined)?.move_path === "string"
                ? String((record.kind as Record<string, unknown>).move_path)
                : null,
        },
      ]
    })
    if (changes.length > 0) {
      return {
        changes,
        itemId,
        harnessData,
        status: mapTimelineStatus(item.status),
        type: "diff",
      }
    }
  }
  if (type.includes("plan") && Array.isArray(item.entries)) {
    return {
      entries: item.entries.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return []
        const record = entry as Record<string, unknown>
        if (typeof record.text !== "string") return []
        const rawStatus = String(record.status ?? "pending")
        return [
          {
            status:
              rawStatus === "completed"
                ? ("completed" as const)
                : rawStatus === "in_progress"
                  ? ("in_progress" as const)
                  : ("pending" as const),
            text: record.text,
          },
        ]
      }),
      itemId,
      harnessData,
      type: "plan",
    }
  }
  if (type.includes("tool") || type.includes("file")) {
    return {
      error: typeof item.error === "string" ? item.error : null,
      input: item.input ?? item.command ?? null,
      itemId,
      name: String(item.name ?? item.tool ?? (type || "tool")),
      output: item.output ?? null,
      harnessData,
      status: mapTimelineStatus(item.status),
      type: "tool",
    }
  }
  return {
    agentId,
    itemId,
    nativeType: type,
    payload: value,
    status: mapTimelineStatus(item.status),
    type: "harness",
  }
}

/** Bridges existing native/raw runtimes into server-owned Thread semantics. */
export class ManagedThreadAdapter implements ThreadHarnessAdapter {
  readonly agentId: AgentId
  readonly #manager: AgentManager
  readonly #pending = new Map<string, Pending>()
  readonly #claudeInteractions = new Map<
    string,
    {
      readonly request: ClaudePermissionRequest
      readonly resolve: (result: Awaited<ReturnType<ClaudePermissionHandler>>) => void
    }
  >()
  readonly #reverse = new Map<string, AgentRuntimeServerMessage>()
  #acpCapabilities: Record<string, unknown> | undefined
  #onEvent: ((event: ThreadHarnessEvent) => void) | undefined
  #harnessSessionId: string | null = null

  constructor(manager: AgentManager, agentId: AgentId) {
    this.#manager = manager
    this.agentId = agentId
  }

  async create(input: ThreadHarnessCreateInput): Promise<ThreadHarnessSession> {
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
      this.#harnessSessionId = sessionId
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
      this.#harnessSessionId = sessionId
      return { capabilities: capabilities(this.agentId), sessionId }
    }
    if (this.agentId === "claude" || this.agentId === "pi") {
      if (input.forkedFromAgentSessionId) {
        throw new Error(`${this.agentId} does not expose a native empty-session fork`)
      }
      this.#harnessSessionId = null
      return { capabilities: capabilities(this.agentId), sessionId: null }
    }
    return this.#createAcp(input)
  }

  async resume(input: ThreadHarnessResumeInput): Promise<ThreadHarnessSession> {
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
      this.#harnessSessionId = sessionId
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
      this.#harnessSessionId = input.agentSessionId
      return {
        capabilities: capabilities(this.agentId),
        history: this.#mapOpenCodeHistory(resultOf(response).data),
        sessionId: input.agentSessionId,
      }
    }
    if (this.agentId === "claude" || this.agentId === "pi") {
      this.#harnessSessionId = input.agentSessionId
      return { capabilities: capabilities(this.agentId), sessionId: input.agentSessionId }
    }
    return this.#resumeAcp(input)
  }

  async close(context: ThreadHarnessContext): Promise<void> {
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
    } else if (this.agentId === "claude" && this.#harnessSessionId) {
      await this.#request(context.threadId, {
        queryId: context.threadId,
        requestId: randomUUID(),
        type: "agent.claude.query.close.request",
      })
    }
    await this.#manager.disposeSession(context.threadId)
    this.#cancelPendingInteractions()
    this.#onEvent = undefined
  }

  async delete(context: ThreadHarnessContext): Promise<void> {
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
    if (
      this.agentId !== "codex" &&
      this.agentId !== "opencode" &&
      this.agentId !== "claude" &&
      this.agentId !== "pi"
    ) {
      await this.#manager.disposeSession(context.threadId)
      this.#cancelPendingInteractions()
      this.#onEvent = undefined
    } else {
      await this.close(context)
    }
    this.#manager.releaseThreadAdapter(this.agentId, context.threadId)
  }

  async startTurn(input: ThreadHarnessTurnInput): Promise<{ turnId: string }> {
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
      const text = input.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
      await this.#request(input.threadId, {
        options: {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.agentSessionId ? { resume: input.agentSessionId } : {}),
        },
        prompt: { text, type: "text" },
        queryId: input.threadId,
        requestId: randomUUID(),
        type: "agent.claude.query.start.request",
      })
      return { turnId: input.clientMessageId }
    }
    if (this.agentId === "pi") {
      await this.#request(input.threadId, {
        images: input.content
          .filter((block) => block.type === "image")
          .map((block) => ({ data: block.data, mimeType: block.mimeType, type: "image" })),
        message: input.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
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
      sessionId: input.agentSessionId,
      type: "agent.acp.session.prompt.request",
    })
    return { turnId: input.clientMessageId }
  }

  async steerTurn(input: ThreadHarnessSteerInput): Promise<void> {
    if (this.agentId === "codex") {
      if (!input.agentSessionId) throw new Error("Codex thread is not bound")
      await this.#request(input.threadId, {
        clientUserMessageId: input.clientMessageId,
        expectedTurnId: input.turnId,
        input: mapInput(input.content),
        requestId: randomUUID(),
        threadId: input.agentSessionId,
        type: "agent.codex.turn.steer.request",
      })
      return
    }
    if (this.agentId === "pi") {
      await this.#request(input.threadId, {
        images: input.content
          .filter((block) => block.type === "image")
          .map((block) => ({ data: block.data, mimeType: block.mimeType, type: "image" })),
        message: input.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        requestId: randomUUID(),
        type: "agent.pi.steer.request",
      })
      return
    }
    throw new Error(`${this.agentId} does not support steering active turns`)
  }

  async cancelTurn(context: ThreadHarnessContext & { turnId?: string }): Promise<void> {
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
        requestId: randomUUID(),
        type: "agent.pi.abort.request",
      })
    } else if (context.agentSessionId) {
      await this.#manager.handleAcp(
        AgentAcpClientMessageSchema.parse({
          agent: this.agentId as RegistryAgentId,
          sessionId: context.agentSessionId,
          protocolVersion: 1,
          type: "agent.acp.session.cancel.notification",
        }),
        { send: this.#receive, sessionId: context.threadId }
      )
    }
  }

  async updateConfig(
    context: ThreadHarnessContext,
    patch: {
      mode?: string | null
      model?: string | null
      thinking?: string | null
    }
  ): Promise<void> {
    if (this.agentId === "pi") {
      if (patch.model) {
        const [provider, modelId] = patch.model.split("/", 2)
        if (!provider || !modelId) throw new Error("Pi model must use provider/model format")
        await this.#request(context.threadId, {
          modelId,
          provider,
          requestId: randomUUID(),
          type: "agent.pi.model.set.request",
        })
      }
      if (patch.thinking) {
        await this.#request(context.threadId, {
          level: patch.thinking,
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
    context: ThreadHarnessContext,
    interactionId: string,
    response: ThreadInteractionResponse
  ): Promise<void> {
    if (this.agentId === "claude") {
      const pending = this.#claudeInteractions.get(interactionId)
      if (!pending) throw new Error("Claude permission is no longer pending")
      pending.resolve(
        response.type === "permission" && response.outcome !== "deny"
          ? {
              behavior: "allow",
              toolUseID: pending.request.toolUseID,
              updatedInput: pending.request.input,
              ...(response.outcome === "allow_always" && pending.request.suggestions
                ? { updatedPermissions: pending.request.suggestions }
                : {}),
            }
          : {
              behavior: "deny",
              message: "Denied by user",
              toolUseID: pending.request.toolUseID,
            }
      )
      this.#claudeInteractions.delete(interactionId)
      return
    }
    const reverse = this.#reverse.get(interactionId)
    if (!reverse) throw new Error("Harness interaction is no longer pending")
    if (this.agentId === "codex") {
      const request = reverse as unknown as Record<string, unknown>
      const requestPayload = { ...request, ...payloadOf(reverse) }
      const payload = (() => {
        switch (reverse.type) {
          case "agent.codex.apply_patch_approval.request":
          case "agent.codex.exec_command_approval.request":
            return {
              decision:
                response.type === "permission" && response.outcome !== "deny"
                  ? response.outcome === "allow_always"
                    ? "approved_for_session"
                    : "approved"
                  : response.type === "cancel"
                    ? "abort"
                    : { denied: { rejection: "Declined by the user." } },
              requestId: request.requestId,
            }
          case "agent.codex.item.command_execution.request_approval.request":
          case "agent.codex.item.file_change.request_approval.request":
            return { decision: codexPermissionDecision(response), requestId: request.requestId }
          case "agent.codex.item.permissions.request_approval.request": {
            const accepted = response.type === "permission" && response.outcome !== "deny"
            return {
              permissions: accepted
                ? grantedCodexPermissions(response.permissions ?? requestPayload.permissions)
                : {},
              requestId: request.requestId,
              scope:
                response.type === "permission" && response.scope
                  ? response.scope
                  : response.type === "permission" && response.outcome === "allow_always"
                    ? "session"
                    : "turn",
              ...(response.type === "permission" && response.strictAutoReview !== undefined
                ? { strictAutoReview: response.strictAutoReview }
                : {}),
            }
          }
          case "agent.codex.item.tool.request_user_input.request": {
            const questions = Array.isArray(requestPayload.questions)
              ? (requestPayload.questions as Array<Record<string, unknown>>)
              : []
            const answers =
              response.type === "answers"
                ? Array.isArray(response.answers)
                  ? Object.fromEntries(
                      response.answers.map((answer, index) => [
                        String(questions[index]?.id ?? index),
                        { answers: answer },
                      ])
                    )
                  : Object.fromEntries(
                      Object.entries(response.answers).map(([id, answer]) => [
                        id,
                        { answers: answer },
                      ])
                    )
                : {}
            return { answers, requestId: request.requestId }
          }
          case "agent.codex.mcp_server.elicitation.request.request":
            return {
              _meta: null,
              action:
                response.type === "elicitation"
                  ? response.action
                  : response.type === "cancel"
                    ? "cancel"
                    : "decline",
              content:
                response.type === "elicitation" && response.action === "accept"
                  ? (response.content ?? null)
                  : null,
              requestId: request.requestId,
            }
          default:
            throw new Error(`Unsupported Codex interaction: ${reverse.type}`)
        }
      })()
      await this.#manager.handleCodex(
        AgentCodexServerResponseSchema.parse({
          payload,
          type: String(request.type).replace(/\.request$/, ".response"),
        }),
        { send: this.#receive, sessionId: context.threadId }
      )
      this.#reverse.delete(interactionId)
      return
    }
    if (this.agentId === "opencode") {
      const event = payloadOf(reverse).event as Record<string, unknown>
      const properties = (event?.properties ?? {}) as Record<string, unknown>
      const requestId = stringId(properties.id)
      if (!requestId) throw new Error("OpenCode interaction has no request id")
      if (event?.type === "permission.asked") {
        await this.#openCodeCall(context.threadId, {
          body: {
            reply:
              response.type === "permission" && response.outcome !== "deny"
                ? response.outcome === "allow_always"
                  ? "always"
                  : "once"
                : "reject",
          },
          operation: `POST /permission/${encodeURIComponent(requestId)}/reply`,
          query: context.cwd ? { directory: context.cwd } : undefined,
        })
      } else if (event?.type === "question.asked") {
        if (response.type === "cancel" || response.type === "permission") {
          await this.#openCodeCall(context.threadId, {
            operation: `POST /question/${encodeURIComponent(requestId)}/reject`,
            query: context.cwd ? { directory: context.cwd } : undefined,
          })
        } else {
          const answers =
            response.type === "answers"
              ? Array.isArray(response.answers)
                ? response.answers
                : Object.values(response.answers)
              : [
                  [
                    response.type === "selection"
                      ? response.optionId
                      : response.type === "text"
                        ? response.value
                        : "",
                  ],
                ]
          await this.#openCodeCall(context.threadId, {
            body: { answers },
            operation: `POST /question/${encodeURIComponent(requestId)}/reply`,
            query: context.cwd ? { directory: context.cwd } : undefined,
          })
        }
      } else {
        throw new Error("Unsupported OpenCode interaction")
      }
      this.#reverse.delete(interactionId)
      return
    }
    if (this.agentId === "pi") {
      const request = reverse as unknown as Record<string, unknown>
      const payload = payloadOf(reverse)
      const requestId = String(requestIdOf(reverse))
      const method = String(payload.method)
      const answer =
        response.type === "cancel"
          ? { cancelled: true }
          : method === "confirm"
            ? {
                confirmed: response.type === "permission" && response.outcome !== "deny",
              }
            : {
                value:
                  response.type === "selection"
                    ? response.optionId
                    : response.type === "text"
                      ? response.value
                      : "",
              }
      await this.#manager.handlePi(
        AgentPiClientMessageSchema.parse({
          payload: { ...answer, id: requestId, type: "extension_ui_response" },
          requestId,
          type: String(request.type).replace(/\.request$/, ".response"),
        }),
        { send: this.#receive, sessionId: context.threadId }
      )
      this.#reverse.delete(interactionId)
      return
    }
    const request = reverse as unknown as Record<string, unknown>
    const payload = payloadOf(reverse)
    const options = (
      Array.isArray(payload.options)
        ? payload.options
        : Array.isArray(request.options)
          ? request.options
          : []
    ) as Array<Record<string, unknown>>
    const selectedOptionId = (() => {
      if (response.type === "selection") return response.optionId
      if (response.type !== "permission") return null
      const desiredKind =
        response.outcome === "allow_always"
          ? "allow_always"
          : response.outcome === "allow_once"
            ? "allow_once"
            : "reject_once"
      const option = options.find((candidate) => candidate.kind === desiredKind)
      return option ? String(option.optionId) : null
    })()
    if (response.type === "permission" && response.outcome !== "deny" && !selectedOptionId) {
      throw new Error(`ACP permission request has no ${response.outcome} option`)
    }
    await this.#manager.handleAcp(
      AgentAcpClientMessageSchema.parse({
        agent: this.agentId,
        payload: {
          requestId: requestIdOf(reverse),
          result: {
            outcome: selectedOptionId
              ? { optionId: selectedOptionId, outcome: "selected" }
              : { outcome: "cancelled" },
          },
        },
        protocolVersion: 1,
        type: String(request.type).replace(/\.request$/, ".response"),
      }),
      { send: this.#receive, sessionId: context.threadId }
    )
    this.#reverse.delete(interactionId)
  }

  async #createAcp(input: ThreadHarnessCreateInput): Promise<ThreadHarnessSession> {
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
    this.#harnessSessionId = sessionId
    return {
      capabilities: capabilities(this.agentId, this.#acpCapabilities),
      sessionId,
    }
  }

  async #resumeAcp(input: ThreadHarnessResumeInput): Promise<ThreadHarnessSession> {
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
    this.#harnessSessionId = input.agentSessionId
    return {
      capabilities: capabilities(this.agentId, this.#acpCapabilities),
      sessionId: input.agentSessionId,
    }
  }

  #supportsAcp(capability: "delete" | "fork"): boolean {
    const session = (this.#acpCapabilities?.sessionCapabilities ?? {}) as Record<string, unknown>
    return session[capability] != null
  }

  #attach(onEvent: (event: ThreadHarnessEvent) => void): void {
    this.#onEvent = onEvent
  }

  #cancelPendingInteractions(): void {
    for (const pending of this.#claudeInteractions.values()) {
      pending.resolve({
        behavior: "deny",
        message: "Thread was closed",
        toolUseID: pending.request.toolUseID,
      })
    }
    this.#claudeInteractions.clear()
    this.#reverse.clear()
  }

  async #request(
    threadId: string,
    message: Record<string, unknown>
  ): Promise<AgentRuntimeServerMessage> {
    const requestId = message.requestId
    if (typeof requestId !== "string") throw new Error("Internal harness requests use string ids")
    const expectedType = String(message.type).replace(/\.request$/, ".response")
    const response = new Promise<AgentRuntimeServerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error(`Harness request timed out: ${String(message.type)}`))
      }, 30_000)
      timeout.unref()
      this.#pending.set(requestId, { expectedType, reject, resolve, timeout })
    })
    try {
      const context = {
        requestClaudePermission: this.#requestClaudePermission,
        send: this.#receive,
        sessionId: threadId,
      }
      if (this.agentId === "codex") {
        await this.#manager.handleCodex(AgentCodexClientRequestSchema.parse(message), context)
      } else if (this.agentId === "claude") {
        await this.#manager.handleClaude(AgentClaudeClientMessageSchema.parse(message), context)
      } else if (this.agentId === "pi") {
        await this.#manager.handlePi(AgentPiClientMessageSchema.parse(message), context)
      } else {
        await this.#manager.handleAcp(AgentAcpClientMessageSchema.parse(message), context)
      }
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
      AgentOpenCodeCallRequestSchema.parse({
        payload,
        requestId,
        type: "agent.opencode.call.request",
      }),
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
      AgentOpenCodeEventSubscribeRequestSchema.parse({
        payload: { stream: "global.event", subscriptionId },
        requestId,
        type: "agent.opencode.event.subscribe.request",
      }),
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

  readonly #requestClaudePermission: ClaudePermissionHandler = async (request) => {
    const interactionId = `harness:claude:${request.requestId}`
    return new Promise((resolve) => {
      const abort = (): void => {
        this.#claudeInteractions.delete(interactionId)
        resolve({
          behavior: "deny",
          message: "Permission request was cancelled",
          toolUseID: request.toolUseID,
        })
      }
      request.signal.addEventListener("abort", abort, { once: true })
      this.#claudeInteractions.set(interactionId, {
        request,
        resolve: (result) => {
          request.signal.removeEventListener("abort", abort)
          resolve(result)
        },
      })
      this.#onEvent?.({
        interaction: {
          createdAt: new Date().toISOString(),
          expiresAt: null,
          id: interactionId,
          kind: "permission",
          message:
            request.title ??
            request.description ??
            request.decisionReason ??
            `Allow ${request.toolName}?`,
          options: [
            { description: null, id: "allow_once", label: "Allow once" },
            ...(request.suppressAlwaysAllowRule
              ? []
              : [{ description: null, id: "allow_always", label: "Always allow" }]),
            { description: null, id: "deny", label: "Deny" },
          ],
          title: request.displayName ?? request.toolName,
        },
        type: "interaction-requested",
      })
    })
  }

  #mapMessage(message: AgentRuntimeServerMessage): void {
    const onEvent = this.#onEvent
    if (!onEvent) return
    const payload = payloadOf(message)
    if (
      this.agentId === "codex" &&
      (message.type === "agent.codex.item.auto_approval_review.started.notification" ||
        message.type === "agent.codex.item.auto_approval_review.completed.notification" ||
        message.type === "agent.codex.auto_approval_review.strict_review_required.notification" ||
        message.type === "agent.codex.mcp_server.oauth_login.completed.notification" ||
        message.type === "agent.codex.mcp_server.startup_status.updated.notification")
    ) {
      onEvent({
        agentId: "codex",
        nativeType: message.type,
        payload: payload as never,
        type: "harness",
      })
      return
    }
    const nativeSessionId = stringId(
      payload.sessionId ??
        payload.session_id ??
        (payload.message as Record<string, unknown> | undefined)?.session_id
    )
    if (nativeSessionId && nativeSessionId !== this.#harnessSessionId) {
      this.#harnessSessionId = nativeSessionId
      onEvent({ sessionId: nativeSessionId, type: "session-bound" })
    }
    if (message.type.endsWith(".request")) {
      const interactionId = `harness:${this.agentId}:${String(requestIdOf(message))}`
      this.#reverse.set(interactionId, message)
      const request = message as unknown as Record<string, unknown>
      const rawOptions = Array.isArray(payload.options)
        ? payload.options
        : Array.isArray(request.options)
          ? request.options
          : []
      const rawQuestions = Array.isArray(payload.questions)
        ? payload.questions
        : Array.isArray(request.questions)
          ? request.questions
          : undefined
      const questions = rawQuestions
        ? rawQuestions.flatMap((question, questionIndex) => {
            if (!question || typeof question !== "object") return []
            const value = question as Record<string, unknown>
            const options = Array.isArray(value.options) ? value.options : []
            return [
              {
                custom: value.isOther === true,
                header: String(value.header ?? value.title ?? `Question ${questionIndex + 1}`),
                id: String(value.id ?? questionIndex),
                multiple: value.multiple === true,
                options: options.flatMap((option, optionIndex) => {
                  if (!option || typeof option !== "object") return []
                  const candidate = option as Record<string, unknown>
                  const label = String(candidate.label ?? candidate.name ?? optionIndex)
                  return [
                    {
                      description:
                        typeof candidate.description === "string" ? candidate.description : null,
                      id: String(candidate.id ?? candidate.value ?? label),
                      label,
                    },
                  ]
                }),
                question: String(
                  value.question ?? value.message ?? value.header ?? "Input required"
                ),
                secret: value.isSecret === true,
              },
            ]
          })
        : undefined
      const interactionOptions = rawOptions.flatMap((option, index) => {
        if (typeof option === "string") {
          return [{ description: null, id: option, label: option }]
        }
        if (!option || typeof option !== "object") return []
        const value = option as Record<string, unknown>
        const id = String(value.optionId ?? value.id ?? value.value ?? index)
        return [
          {
            description: typeof value.description === "string" ? value.description : null,
            id,
            label: String(value.name ?? value.label ?? value.title ?? id),
          },
        ]
      })
      if (
        interactionOptions.length === 0 &&
        (message.type.includes("permission") || message.type.includes("approval"))
      ) {
        interactionOptions.push(
          { description: null, id: "allow_once", label: "Allow once" },
          { description: null, id: "allow_always", label: "Always allow" },
          { description: null, id: "deny", label: "Deny" }
        )
      }
      const harnessMetadata = { ...request, ...payload }
      delete harnessMetadata.requestId
      delete harnessMetadata.type
      onEvent({
        interaction: {
          createdAt: new Date().toISOString(),
          expiresAt: null,
          id: interactionId,
          kind:
            message.type.includes("permission") || message.type.includes("approval")
              ? "permission"
              : message.type.includes("request_user_input")
                ? "question"
                : "elicitation",
          message: String(
            payload.message ??
              request.message ??
              payload.description ??
              (payload.toolCall as Record<string, unknown> | undefined)?.title ??
              (request.toolCall as Record<string, unknown> | undefined)?.title ??
              payload.reason ??
              request.reason ??
              message.type
          ),
          options: interactionOptions,
          ...(this.agentId === "codex"
            ? {
                harness: {
                  agentId: "codex" as const,
                  metadata: harnessMetadata as never,
                  nativeType: message.type,
                },
              }
            : {}),
          ...(questions?.length ? { questions } : {}),
          title:
            typeof (
              payload.title ??
              request.title ??
              (payload.toolCall as Record<string, unknown> | undefined)?.title ??
              (request.toolCall as Record<string, unknown> | undefined)?.title
            ) === "string"
              ? String(
                  payload.title ??
                    request.title ??
                    (payload.toolCall as Record<string, unknown> | undefined)?.title ??
                    (request.toolCall as Record<string, unknown> | undefined)?.title
                )
              : null,
        },
        type: "interaction-requested",
      })
      return
    }
    if (message.type === "agent.opencode.event.notification") {
      const event = payload.event as Record<string, unknown>
      const properties = (event?.properties ?? {}) as Record<string, unknown>
      const eventSessionId = stringId(properties.sessionID ?? properties.sessionId)
      if (!eventSessionId || eventSessionId !== this.#harnessSessionId) return
      if (event?.type === "permission.asked" || event?.type === "question.asked") {
        const requestId = stringId(properties.id)
        if (!requestId) return
        const interactionId = `harness:opencode:${requestId}`
        this.#reverse.set(interactionId, message)
        const questions = Array.isArray(properties.questions)
          ? properties.questions.flatMap((question) => {
              if (!question || typeof question !== "object") return []
              const value = question as Record<string, unknown>
              if (typeof value.question !== "string" || typeof value.header !== "string") return []
              const rawOptions = Array.isArray(value.options) ? value.options : []
              return [
                {
                  custom: value.custom === true,
                  header: value.header,
                  multiple: value.multiple === true,
                  options: rawOptions.flatMap((option, index) => {
                    if (!option || typeof option !== "object") return []
                    const optionValue = option as Record<string, unknown>
                    if (typeof optionValue.label !== "string") return []
                    return [
                      {
                        description:
                          typeof optionValue.description === "string"
                            ? optionValue.description
                            : null,
                        id: optionValue.label || String(index),
                        label: optionValue.label,
                      },
                    ]
                  }),
                  question: value.question,
                },
              ]
            })
          : []
        const firstQuestion = questions[0]
        onEvent({
          interaction: {
            createdAt: new Date().toISOString(),
            expiresAt: null,
            id: interactionId,
            kind: event.type === "permission.asked" ? "permission" : "question",
            message:
              event.type === "permission.asked"
                ? `Allow ${String(properties.permission ?? "requested operation")}?`
                : String(firstQuestion?.question ?? firstQuestion?.header ?? "Answer question"),
            options:
              event.type === "permission.asked"
                ? [
                    { description: null, id: "allow_once", label: "Allow once" },
                    { description: null, id: "allow_always", label: "Always allow" },
                    { description: null, id: "deny", label: "Deny" },
                  ]
                : (firstQuestion?.options ?? []),
            ...(event.type === "question.asked" ? { questions } : {}),
            title:
              event.type === "permission.asked"
                ? String(properties.permission ?? "Permission")
                : typeof firstQuestion?.header === "string"
                  ? firstQuestion.header
                  : null,
          },
          type: "interaction-requested",
        })
        return
      }
      if (
        event?.type === "permission.replied" ||
        event?.type === "question.replied" ||
        event?.type === "question.rejected"
      ) {
        const requestId = stringId(properties.requestID)
        if (requestId) {
          const interactionId = `harness:opencode:${requestId}`
          this.#reverse.delete(interactionId)
          onEvent({ interactionId, type: "interaction-resolved" })
        }
        return
      }
      if (event?.type === "session.idle") {
        onEvent({ turnId: stringId(properties.messageID) ?? "active", type: "turn-completed" })
        return
      }
      const item = mapHarnessItem(properties.part ?? properties.message, this.agentId)
      if (item) onEvent({ item: { item, harnessItemId: item.itemId }, type: "timeline" })
      return
    }
    if (message.type.includes("turn.completed") || message.type.includes("agent_end")) {
      onEvent({
        turnId: stringId(payload.turnId ?? payload.id) ?? "active",
        type: "turn-completed",
      })
      return
    }
    const item = mapHarnessItem(
      payload.item ?? payload.message ?? payload.event ?? payload.update,
      this.agentId
    )
    if (item) onEvent({ item: { item, harnessItemId: item.itemId }, type: "timeline" })
  }

  #mapOpenCodeHistory(value: unknown): ThreadHarnessHistoryItem[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((message) => {
      if (!message || typeof message !== "object") return []
      const record = message as Record<string, unknown>
      const parts = Array.isArray(record.parts) ? record.parts : []
      return parts.flatMap((part) => {
        const item = mapHarnessItem(part, this.agentId)
        return item ? [{ item, harnessItemId: item.itemId }] : []
      })
    })
  }
}
