import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import type {
  AgentId,
  AgentOpenCodeV2Operation,
  RegistryAgentId,
  ThreadCapabilities,
  ThreadInputBlock,
  ThreadTimelineItem,
} from "@cypheria/protocol"
import {
  AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD,
  AgentClaudeClientMessageSchema,
  AgentCodexClientRequestSchema,
  AgentCodexServerResponseSchema,
  AgentOpenCodeCallRequestSchema,
  AgentOpenCodeEventSubscribeRequestSchema,
  AgentPiClientMessageSchema,
  CodexTurnProjector,
} from "@cypheria/protocol"
import {
  ACP_PREFERRED_PROTOCOL_VERSION,
  AgentAcpClientMessageSchema,
  parseAcpNegotiatedInitializeResult,
} from "@cypheria/protocol/acp-adapter"
import type { ServerNotification, v2 } from "@cypheria/protocol/codex-types"

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
import { ACP_V1_FALLBACK_REQUIRED_CODE, acpInitializeParams } from "./acp-negotiation.js"
import type { AgentManager, AgentRuntimeServerMessage } from "./agent-manager.js"
import type { ClaudePermissionHandler, ClaudePermissionRequest } from "./claude-session-runtime.js"
import { codexThreadItemToTimeline, codexTurnUpdateToTimeline } from "./codex-timeline.js"

type Pending = {
  readonly expectedType: string
  readonly reject: (error: Error) => void
  readonly resolve: (message: AgentRuntimeServerMessage) => void
  readonly timeout: NodeJS.Timeout
}

const capabilities = (
  agentId: AgentId,
  acp?: Record<string, unknown>,
  acpVersion?: 1 | 2
): ThreadCapabilities => {
  const session = (
    acpVersion === 2 ? (acp?.session ?? {}) : (acp?.sessionCapabilities ?? {})
  ) as Record<string, unknown>
  const prompt = (
    acpVersion === 2 ? (session.prompt ?? {}) : (acp?.promptCapabilities ?? {})
  ) as Record<string, unknown>
  const supportsPrompt = (value: unknown): boolean =>
    acpVersion === 2 ? value != null : value === true
  return {
    changeCwd: true,
    configure: true,
    fork: agentId === "codex" || agentId === "opencode" || session.fork != null,
    promptContent: [
      "text",
      ...(agentId === "codex" || agentId === "opencode" || supportsPrompt(prompt.image)
        ? (["image"] as const)
        : []),
      ...(agentId === "codex" || supportsPrompt(prompt.audio) ? (["audio"] as const) : []),
      ...(agentId !== "codex" ? (["resource-link"] as const) : []),
      ...(supportsPrompt(prompt.embeddedContext) ? (["embedded-resource"] as const) : []),
    ],
    harnessExtensions: agentId === "codex",
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
    const error = payload.error as { code?: number | string; message?: string }
    const failure = new Error(error.message ?? "Harness request failed")
    failure.name = error.code === undefined ? "HARNESS_ERROR" : String(error.code)
    throw failure
  }
  return (payload.result as Record<string, unknown> | undefined) ?? payload
}

const stringId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const localInput = (uri: string, name?: string | null): v2.UserInput | null => {
  if (!uri.startsWith("file:")) return null
  const path = fileURLToPath(uri)
  const label = (name ?? path).toLowerCase()
  if (/\.(?:avif|gif|jpe?g|png|webp)$/u.test(label)) return { path, type: "localImage" }
  if (/\.(?:aac|flac|m4a|mp3|ogg|wav)$/u.test(label)) return { path, type: "localAudio" }
  return { name: name ?? path.split(/[\\/]/u).at(-1) ?? path, path, type: "mention" }
}

const OPENCODE_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastOpenCodeMessageTimestamp = -1
let openCodeMessageCounter = 0

const createOpenCodeMessageId = (): string => {
  const now = Date.now()
  if (now !== lastOpenCodeMessageTimestamp) openCodeMessageCounter = 0
  lastOpenCodeMessageTimestamp = now
  openCodeMessageCounter += 1
  const ascending = (BigInt(now) * 0x1000n + BigInt(openCodeMessageCounter))
    .toString(16)
    .padStart(12, "0")
    .slice(-12)
  const random = Array.from(randomBytes(14), (value) =>
    OPENCODE_ID_ALPHABET.at(value % OPENCODE_ID_ALPHABET.length)
  ).join("")
  return `msg_${ascending}${random}`
}

const mapInput = (content: readonly ThreadInputBlock[]): v2.UserInput[] =>
  content.map((block) => {
    switch (block.type) {
      case "text":
        return { text: block.text, type: "text", text_elements: [] }
      case "image":
        return { type: "image", url: `data:${block.mimeType};base64,${block.data}` }
      case "audio":
        return { type: "audio", url: `data:${block.mimeType};base64,${block.data}` }
      case "resource-link":
        return (
          localInput(block.uri, block.name) ?? {
            text: block.uri,
            type: "text",
            text_elements: [],
          }
        )
      case "embedded-resource":
        if (block.mimeType.startsWith("image/")) {
          return { type: "image", url: `data:${block.mimeType};base64,${block.data}` }
        }
        if (block.mimeType.startsWith("audio/")) {
          return { type: "audio", url: `data:${block.mimeType};base64,${block.data}` }
        }
        return {
          text: `Embedded resource ${block.uri} (${block.mimeType}):\n${Buffer.from(block.data, "base64").toString("utf8")}`,
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

const mapOpenCodeInput = (
  content: readonly ThreadInputBlock[]
): { files: Array<{ name?: string; uri: string }>; text: string } => {
  const text: string[] = []
  const files: Array<{ name?: string; uri: string }> = []
  for (const block of content) {
    if (block.type === "text") text.push(block.text)
    else if (block.type === "image" || block.type === "audio") {
      files.push({ uri: `data:${block.mimeType};base64,${block.data}` })
    } else if (block.type === "resource-link") {
      files.push({ ...(block.name ? { name: block.name } : {}), uri: block.uri })
    } else {
      text.push(`Embedded resource ${block.uri} (${block.mimeType}):\n${block.data}`)
    }
  }
  return { files, text: text.join("\n") }
}

const openCodeFormQuestions = (form: Record<string, unknown>) =>
  (Array.isArray(form.fields) ? form.fields : []).flatMap((field, index) => {
    if (!field || typeof field !== "object") return []
    const value = field as Record<string, unknown>
    if (value.hidden === true || value.type === "external") return []
    const key = stringId(value.key) ?? String(index)
    const rawOptions = Array.isArray(value.options) ? value.options : []
    const options =
      value.type === "boolean"
        ? [
            { description: null, id: "true", label: "Yes" },
            { description: null, id: "false", label: "No" },
          ]
        : rawOptions.flatMap((option) => {
            if (!option || typeof option !== "object") return []
            const item = option as Record<string, unknown>
            if (typeof item.value !== "string" || typeof item.label !== "string") return []
            return [
              {
                description: typeof item.description === "string" ? item.description : null,
                id: item.value,
                label: item.label,
              },
            ]
          })
    return [
      {
        custom: value.custom === true || options.length === 0,
        header: typeof value.title === "string" ? value.title : key,
        multiple: value.type === "multiselect",
        options,
        question:
          typeof value.description === "string"
            ? value.description
            : typeof value.title === "string"
              ? value.title
              : key,
      },
    ]
  })

const openCodeFormAnswer = (
  form: Record<string, unknown>,
  response: ThreadInteractionResponse
): Record<string, string | number | boolean | readonly string[]> => {
  const fields = (Array.isArray(form.fields) ? form.fields : []).filter(
    (field): field is Record<string, unknown> => Boolean(field && typeof field === "object")
  )
  const keyed =
    response.type === "answers" && !Array.isArray(response.answers) ? response.answers : undefined
  const positional =
    response.type === "answers" && Array.isArray(response.answers) ? response.answers : undefined
  const answer: Record<string, string | number | boolean | readonly string[]> = {}
  fields.forEach((field, index) => {
    if (field.hidden === true || field.type === "external") return
    const key = stringId(field.key) ?? String(index)
    const values =
      keyed?.[key] ??
      positional?.[index] ??
      (response.type === "selection"
        ? [response.optionId]
        : response.type === "text"
          ? [response.value]
          : [])
    if (values.length === 0) return
    if (field.type === "multiselect") answer[key] = values
    else if (field.type === "boolean") answer[key] = values[0] === "true"
    else if (field.type === "number" || field.type === "integer") {
      const value = Number(values[0])
      if (Number.isFinite(value)) answer[key] = value
    } else answer[key] = values[0] ?? ""
  })
  return answer
}

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
      const canonical = codexThreadItemToTimeline(item as v2.ThreadItem)
      const mapped = canonical
        ? { harnessItemId: canonical.itemId, item: canonical }
        : mapHarnessHistoryItem(item, "codex")
      if (mapped)
        history.push({
          ...mapped,
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
  const normalizedType = type.toLowerCase()
  const harnessData = { agentId, nativeType: type, payload: value }
  const text =
    typeof item.text === "string"
      ? item.text
      : typeof item.content === "string"
        ? item.content
        : Array.isArray(item.content)
          ? item.content
              .flatMap((content) => {
                if (typeof content === "string") return [content]
                if (!content || typeof content !== "object") return []
                const block = content as Record<string, unknown>
                return typeof block.text === "string" ? [block.text] : []
              })
              .join("\n")
          : undefined
  if (normalizedType.includes("reasoning") && text !== undefined) {
    return { itemId, operation: "replace", harnessData, text, type: "reasoning" }
  }
  if (
    (normalizedType.includes("message") ||
      normalizedType === "text" ||
      normalizedType === "user" ||
      normalizedType === "assistant") &&
    text !== undefined
  ) {
    const role =
      normalizedType.includes("user") || item.role === "user" || item.type === "user"
        ? "user"
        : "assistant"
    const metadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : undefined
    const clientMessageId = stringId(
      item.clientId ?? item.clientMessageId ?? metadata?.cypheriaClientMessageId
    )
    return {
      ...(role === "user" && clientMessageId ? { clientMessageId } : {}),
      itemId,
      operation: "replace",
      harnessData,
      role,
      text,
      type: "message",
    }
  }
  if (normalizedType.includes("command")) {
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
  if (normalizedType.includes("file") && Array.isArray(item.changes) && item.changes.length > 0) {
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
  if (normalizedType.includes("plan") && Array.isArray(item.entries)) {
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
  if (normalizedType.includes("tool") || normalizedType.includes("file")) {
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

const mapHarnessHistoryItem = (
  value: unknown,
  agentId: AgentId
): ThreadHarnessHistoryItem | undefined => {
  const item = mapHarnessItem(value, agentId)
  if (!item) return undefined
  const native = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  const agentMessageId =
    item.type === "message" && item.role === "user"
      ? stringId(native?.messageId ?? native?.messageID ?? native?.id)
      : null
  return {
    ...(agentMessageId ? { agentMessageId } : {}),
    harnessItemId: item.itemId,
    item,
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
  readonly #codexProjectors = new Map<string, CodexTurnProjector>()
  #acpCapabilities: Record<string, unknown> | undefined
  #acpProtocolVersion: 1 | 2 | undefined
  #defaultsApplied = false
  #onEvent: ((event: ThreadHarnessEvent) => void) | undefined
  #harnessSessionId: string | null = null
  #ownerThreadId: string | null = null

  constructor(manager: AgentManager, agentId: AgentId) {
    this.#manager = manager
    this.agentId = agentId
  }

  async create(input: ThreadHarnessCreateInput): Promise<ThreadHarnessSession> {
    this.#attach(input.onEvent)
    this.#ownerThreadId = input.threadId
    if (this.agentId === "codex") {
      const gitInstructions = this.#manager.codexGitInstructions()
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
              ...(gitInstructions ? { developerInstructions: gitInstructions } : {}),
              dynamicTools: this.#manager.codexDynamicTools.getSpecs(),
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
      const defaults = await this.#defaultsFor("opencode")
      const model = typeof defaults.model === "string" ? defaults.model.split("/", 2) : []
      const response = await this.#openCodeCall(
        input.threadId,
        input.forkedFromAgentSessionId
          ? {
              body: { sessionID: input.forkedFromAgentSessionId },
              operation: "session.fork",
            }
          : {
              body: {
                ...(typeof defaults.agent === "string" && defaults.agent
                  ? { agent: defaults.agent }
                  : {}),
                ...(input.cwd ? { location: { directory: input.cwd } } : {}),
                ...(model[0] && model[1]
                  ? {
                      model: {
                        id: model[1],
                        providerID: model[0],
                        ...(typeof defaults.variant === "string" && defaults.variant
                          ? { variant: defaults.variant }
                          : {}),
                      },
                    }
                  : {}),
              },
              operation: "session.create",
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
    this.#ownerThreadId = input.threadId
    if (this.agentId === "codex") {
      if (!input.agentSessionId) return this.create({ ...input, forkedFromAgentSessionId: null })
      const gitInstructions = this.#manager.codexGitInstructions()
      const response = await this.#request(input.threadId, {
        cwd: input.cwd,
        ...(gitInstructions ? { developerInstructions: gitInstructions } : {}),
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
        body: { order: "asc", sessionID: input.agentSessionId },
        operation: "message.list",
      })
      await this.#subscribeOpenCode(input.threadId)
      this.#harnessSessionId = input.agentSessionId
      return {
        capabilities: capabilities(this.agentId),
        history: this.#mapOpenCodeHistory(
          (resultOf(response).data as Record<string, unknown> | undefined)?.data
        ),
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
      const protocolVersion = this.#requireAcpVersion()
      if (protocolVersion === 2 || this.#supportsAcp("close")) {
        await this.#request(context.threadId, {
          agent: this.agentId,
          payload: { sessionId: context.agentSessionId },
          protocolVersion,
          requestId: randomUUID(),
          type: "agent.acp.session.close.request",
        })
      }
    } else if (this.agentId === "claude" && this.#harnessSessionId) {
      await this.#request(context.threadId, {
        queryId: context.threadId,
        requestId: randomUUID(),
        type: "agent.claude.query.close.request",
      })
    }
    await this.#manager.disposeSession(context.threadId)
    this.#cancelPendingInteractions()
    this.#codexProjectors.clear()
    this.#ownerThreadId = null
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
        body: { sessionID: context.agentSessionId },
        operation: "session.remove",
      })
    } else if (this.agentId !== "claude" && this.agentId !== "pi" && context.agentSessionId) {
      if (!this.#supportsAcp("delete")) throw new Error("ACP agent lacks session.delete capability")
      await this.#request(context.threadId, {
        agent: this.agentId,
        payload: { sessionId: context.agentSessionId },
        protocolVersion: this.#requireAcpVersion(),
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

  async startTurn(
    input: ThreadHarnessTurnInput
  ): Promise<{ agentMessageId?: string; turnId: string }> {
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
      const turnId = stringId(turn?.id) ?? randomUUID()
      if (turn?.id && !this.#codexProjectors.has(turnId)) {
        const projector = new CodexTurnProjector(input.agentSessionId, turn as v2.Turn)
        this.#codexProjectors.set(turnId, projector)
        this.#emitCodexUpdates(projector.initialUpdates())
      }
      return { turnId }
    }
    if (this.agentId === "opencode") {
      if (!input.agentSessionId) throw new Error("OpenCode thread is not bound")
      const defaults = await this.#defaultsFor("opencode")
      const model = typeof defaults.model === "string" ? defaults.model.split("/", 2) : []
      if (typeof defaults.agent === "string" && defaults.agent) {
        await this.#openCodeCall(input.threadId, {
          body: { agent: defaults.agent, sessionID: input.agentSessionId },
          operation: "session.switch_agent",
        })
      }
      if (model[0] && model[1]) {
        await this.#openCodeCall(input.threadId, {
          body: {
            model: {
              id: model[1],
              providerID: model[0],
              ...(typeof defaults.variant === "string" && defaults.variant
                ? { variant: defaults.variant }
                : {}),
            },
            sessionID: input.agentSessionId,
          },
          operation: "session.switch_model",
        })
      }
      const prompt = mapOpenCodeInput(input.content)
      const agentMessageId = createOpenCodeMessageId()
      const response = await this.#openCodeCall(input.threadId, {
        body: {
          id: agentMessageId,
          ...(prompt.files.length > 0 ? { files: prompt.files } : {}),
          metadata: { cypheriaClientMessageId: input.clientMessageId },
          sessionID: input.agentSessionId,
          text: prompt.text,
        },
        operation: "session.prompt",
      })
      const inbox = resultOf(response).data as Record<string, unknown>
      return {
        agentMessageId: stringId(inbox.id) ?? agentMessageId,
        turnId: randomUUID(),
      }
    }
    if (this.agentId === "claude") {
      const defaults = await this.#defaultsFor("claude")
      const text = input.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
      await this.#request(input.threadId, {
        options: {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.agentSessionId ? { resume: input.agentSessionId } : {}),
          ...(typeof defaults.model === "string" && defaults.model
            ? { model: defaults.model }
            : {}),
          ...(typeof defaults.permissionMode === "string" && defaults.permissionMode
            ? { permissionMode: defaults.permissionMode }
            : {}),
          ...(typeof defaults.effort === "string" && defaults.effort
            ? { effort: defaults.effort }
            : {}),
          ...(typeof defaults.maxThinkingTokens === "number"
            ? { maxThinkingTokens: defaults.maxThinkingTokens }
            : {}),
          ...(defaults.thinkingMode === "adaptive"
            ? { thinking: { type: "adaptive" } }
            : defaults.thinkingMode === "disabled"
              ? { thinking: { type: "disabled" } }
              : defaults.thinkingMode === "enabled"
                ? {
                    thinking: {
                      budgetTokens:
                        typeof defaults.maxThinkingTokens === "number"
                          ? defaults.maxThinkingTokens
                          : 10_000,
                      type: "enabled",
                    },
                  }
                : {}),
        },
        prompt: { text, type: "text" },
        queryId: input.threadId,
        requestId: randomUUID(),
        type: "agent.claude.query.start.request",
      })
      return { turnId: randomUUID() }
    }
    if (this.agentId === "pi") {
      if (!this.#defaultsApplied) {
        const defaults = await this.#defaultsFor("pi")
        if (typeof defaults.model === "string" && defaults.model) {
          const [provider, modelId] = defaults.model.split("/", 2)
          if (provider && modelId) {
            await this.#request(input.threadId, {
              modelId,
              provider,
              requestId: randomUUID(),
              type: "agent.pi.model.set.request",
            })
          }
        }
        if (typeof defaults.thinkingLevel === "string" && defaults.thinkingLevel) {
          await this.#request(input.threadId, {
            level: defaults.thinkingLevel,
            requestId: randomUUID(),
            type: "agent.pi.thinking_level.set.request",
          })
        }
        this.#defaultsApplied = true
      }
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
      return { turnId: randomUUID() }
    }
    if (!input.agentSessionId) throw new Error("ACP thread is not bound")
    const protocolVersion = this.#requireAcpVersion()
    const turnId = randomUUID()
    await this.#request(input.threadId, {
      agent: this.agentId,
      payload: {
        prompt: mapAcpInput(input.content),
        sessionId: input.agentSessionId,
      },
      protocolVersion,
      requestId: randomUUID(),
      type: "agent.acp.session.prompt.request",
    })
    if (protocolVersion === 1) {
      this.#onEvent?.({ turnId, type: "turn-completed" })
    }
    return { turnId }
  }

  async steerTurn(input: ThreadHarnessSteerInput): Promise<{ readonly agentMessageId?: string }> {
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
      return {}
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
      return {}
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
        body: { sessionID: context.agentSessionId },
        operation: "session.interrupt",
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
          payload: { sessionId: context.agentSessionId },
          protocolVersion: this.#requireAcpVersion(),
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
    if (this.agentId === "codex") {
      const turnId = [...this.#codexProjectors.keys()].at(-1)
      if (!context.agentSessionId || !turnId) return
      if (patch.mode !== undefined) {
        throw new Error("Codex permission mode changes apply to the next turn")
      }
      if (patch.model || patch.thinking) {
        await this.#request(context.threadId, {
          ...(patch.thinking ? { effort: patch.thinking } : {}),
          ...(patch.model ? { model: patch.model } : {}),
          requestId: randomUUID(),
          threadId: context.agentSessionId,
          turnId,
          type: "agent.codex.turn.settings.update.request",
        })
      }
      return
    }
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
      const payload = await (async () => {
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
            await this.#manager.rejectCodexReverse(
              context.threadId,
              String(request.requestId),
              `Cypheria does not support this Codex interaction: ${reverse.type}`
            )
            this.#reverse.delete(interactionId)
            return
        }
      })()
      if (!payload) return
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
      const data = (event?.data ?? {}) as Record<string, unknown>
      if (event?.type === "permission.asked") {
        const requestId = stringId(data.id)
        const sessionId = stringId(data.sessionID)
        if (!requestId || !sessionId) throw new Error("OpenCode permission is missing identity")
        await this.#openCodeCall(context.threadId, {
          body: {
            decision:
              response.type === "permission" && response.outcome !== "deny"
                ? response.outcome === "allow_always"
                  ? "always"
                  : "once"
                : "reject",
            requestID: requestId,
            sessionID: sessionId,
          },
          operation: "permission.reply",
        })
      } else if (event?.type === "form.created") {
        const form = (data.form ?? {}) as Record<string, unknown>
        const formId = stringId(form.id)
        const sessionId = stringId(form.sessionID)
        if (!formId || !sessionId) throw new Error("OpenCode form is missing identity")
        if (response.type === "cancel" || response.type === "permission") {
          await this.#openCodeCall(context.threadId, {
            body: { formID: formId, sessionID: sessionId },
            operation: "session.form.cancel",
          })
        } else {
          await this.#openCodeCall(context.threadId, {
            body: {
              answer: openCodeFormAnswer(form, response),
              formID: formId,
              sessionID: sessionId,
            },
            operation: "session.form.reply",
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
        protocolVersion: this.#requireAcpVersion(),
        type: String(request.type).replace(/\.request$/, ".response"),
      }),
      { send: this.#receive, sessionId: context.threadId }
    )
    this.#reverse.delete(interactionId)
  }

  async #createAcp(input: ThreadHarnessCreateInput): Promise<ThreadHarnessSession> {
    await this.#initializeAcp(input.threadId)
    const protocolVersion = this.#requireAcpVersion()
    if (input.forkedFromAgentSessionId && !this.#supportsAcp("fork")) {
      await this.#manager.disposeSession(input.threadId)
      throw new Error("ACP agent lacks session.fork capability")
    }
    const response = await this.#request(input.threadId, {
      agent: this.agentId,
      payload: input.forkedFromAgentSessionId
        ? {
            cwd: input.cwd ?? process.cwd(),
            mcpServers: [],
            sessionId: input.forkedFromAgentSessionId,
          }
        : { cwd: input.cwd ?? process.cwd(), mcpServers: [] },
      protocolVersion,
      requestId: randomUUID(),
      type: input.forkedFromAgentSessionId
        ? "agent.acp.session.fork.request"
        : "agent.acp.session.new.request",
    })
    const sessionId = stringId(resultOf(response).sessionId)
    if (!sessionId) throw new Error("ACP agent did not return a session ID")
    this.#harnessSessionId = sessionId
    await this.#applyAcpDefaults(input.threadId, sessionId)
    return {
      capabilities: capabilities(this.agentId, this.#acpCapabilities, protocolVersion),
      sessionId,
    }
  }

  async #resumeAcp(input: ThreadHarnessResumeInput): Promise<ThreadHarnessSession> {
    if (!input.agentSessionId) return this.#createAcp({ ...input, forkedFromAgentSessionId: null })
    await this.#initializeAcp(input.threadId)
    const protocolVersion = this.#requireAcpVersion()
    if (protocolVersion === 1 && this.#acpCapabilities?.loadSession !== true) {
      throw new Error("ACP v1 agent lacks session/load capability")
    }
    const response = await this.#request(input.threadId, {
      agent: this.agentId,
      payload: {
        cwd: input.cwd ?? process.cwd(),
        mcpServers: [],
        sessionId: input.agentSessionId,
      },
      protocolVersion,
      requestId: randomUUID(),
      type:
        protocolVersion === 2
          ? "agent.acp.session.resume.request"
          : "agent.acp.session.load.request",
    })
    resultOf(response)
    this.#harnessSessionId = input.agentSessionId
    return {
      capabilities: capabilities(this.agentId, this.#acpCapabilities, protocolVersion),
      sessionId: input.agentSessionId,
    }
  }

  async #applyAcpDefaults(threadId: string, sessionId: string): Promise<void> {
    const protocolVersion = this.#requireAcpVersion()
    for (const [configId, value] of Object.entries(await this.#defaultsFor(this.agentId))) {
      if (value === null) continue
      if (protocolVersion === 1 && configId === "mode" && typeof value === "string") {
        await this.#request(threadId, {
          agent: this.agentId,
          payload: { modeId: value, sessionId },
          protocolVersion,
          requestId: randomUUID(),
          type: "agent.acp.session.set_mode.request",
        })
        continue
      }
      if (typeof value !== "boolean" && typeof value !== "string") continue
      await this.#request(threadId, {
        agent: this.agentId,
        payload: {
          configId,
          sessionId,
          ...(typeof value === "boolean"
            ? { type: "boolean" }
            : protocolVersion === 2
              ? { type: "id" }
              : {}),
          value,
        },
        protocolVersion,
        requestId: randomUUID(),
        type: "agent.acp.session.set_config_option.request",
      })
    }
  }

  async #defaultsFor(agentId: AgentId): Promise<ReturnType<AgentManager["defaultsFor"]>> {
    const manager = this.#manager as AgentManager & {
      defaultsFor?: AgentManager["defaultsFor"]
      validatedDefaultsFor?: AgentManager["validatedDefaultsFor"]
    }
    if (manager.validatedDefaultsFor) return manager.validatedDefaultsFor(agentId)
    return manager.defaultsFor?.(agentId) ?? {}
  }

  #supportsAcp(capability: "close" | "delete" | "fork"): boolean {
    const session = (
      this.#acpProtocolVersion === 2
        ? (this.#acpCapabilities?.session ?? {})
        : (this.#acpCapabilities?.sessionCapabilities ?? {})
    ) as Record<string, unknown>
    return session[capability] != null
  }

  async #initializeAcp(threadId: string): Promise<void> {
    let negotiated: ReturnType<typeof parseAcpNegotiatedInitializeResult>
    try {
      try {
        const v2Params = acpInitializeParams(ACP_PREFERRED_PROTOCOL_VERSION)
        const { protocolVersion: _protocolVersion, ...v2Payload } = v2Params
        negotiated = parseAcpNegotiatedInitializeResult(
          resultOf(
            await this.#request(threadId, {
              agent: this.agentId,
              payload: v2Payload,
              protocolVersion: ACP_PREFERRED_PROTOCOL_VERSION,
              requestId: randomUUID(),
              type: "agent.acp.initialize.request",
            })
          )
        )
      } catch (error) {
        if (!(error instanceof Error) || error.name !== String(ACP_V1_FALLBACK_REQUIRED_CODE)) {
          throw error
        }
        // Google Antigravity 1.1.1 claims v2 while returning the v1 initialize
        // shape. Dispose that connection before explicitly negotiating v1.
        await this.#manager.disposeSession(threadId)
        const v1Params = acpInitializeParams(1)
        const { protocolVersion: _protocolVersion, ...payload } = v1Params
        negotiated = parseAcpNegotiatedInitializeResult(
          resultOf(
            await this.#request(threadId, {
              agent: this.agentId,
              payload,
              protocolVersion: 1,
              requestId: randomUUID(),
              type: "agent.acp.initialize.request",
            })
          )
        )
      }
    } catch (error) {
      await this.#manager.disposeSession(threadId)
      throw error
    }
    const { protocolVersion } = negotiated
    this.#acpProtocolVersion = protocolVersion
    this.#acpCapabilities =
      (protocolVersion === 2
        ? negotiated.result.capabilities
        : negotiated.result.agentCapabilities) ?? {}
    if (protocolVersion === 2 && this.#acpCapabilities.session == null) {
      await this.#manager.disposeSession(threadId)
      throw new Error("ACP v2 agent does not advertise session support")
    }
  }

  #requireAcpVersion(): 1 | 2 {
    if (!this.#acpProtocolVersion) throw new Error("ACP connection is not initialized")
    return this.#acpProtocolVersion
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
    payload: { body?: unknown; operation: AgentOpenCodeV2Operation }
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
        payload: { stream: "event", subscriptionId },
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

  #emitCodexUpdates(updates: ReturnType<CodexTurnProjector["apply"]>): void {
    for (const update of updates) {
      const item = codexTurnUpdateToTimeline(update)
      if (!item) continue
      const turnId = update.type === "turn" ? update.data.id : update.data.turnId
      this.#onEvent?.({
        item: { harnessItemId: item.itemId, item, turnId },
        type: "timeline",
      })
    }
  }

  #mapCodexNotification(message: AgentRuntimeServerMessage): boolean {
    if (this.agentId !== "codex") return false
    const method =
      AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD[
        message.type as keyof typeof AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD
      ]
    if (!method) return false
    const params = payloadOf(message)
    const notification = { method, params } as ServerNotification
    const turn = params.turn as v2.Turn | undefined
    const turnId = stringId(params.turnId) ?? stringId(turn?.id)

    if (method === "turn/started" && turn) {
      let projector = this.#codexProjectors.get(turn.id)
      if (!projector) {
        projector = new CodexTurnProjector(String(params.threadId), turn)
        this.#codexProjectors.set(turn.id, projector)
        this.#emitCodexUpdates(projector.initialUpdates())
      } else {
        this.#emitCodexUpdates(projector.apply(notification))
      }
    } else if (turnId) {
      if (
        (method === "item/started" || method === "item/completed") &&
        (params.item as { type?: unknown } | undefined)?.type === "userMessage"
      ) {
        const userMessage = mapHarnessHistoryItem(params.item, "codex")
        if (userMessage) {
          this.#onEvent?.({
            item: { ...userMessage, turnId },
            type: "timeline",
          })
        }
      }
      const projector = this.#codexProjectors.get(turnId)
      if (projector) this.#emitCodexUpdates(projector.apply(notification))
      else if ((method === "item/started" || method === "item/completed") && params.item) {
        const canonical = codexThreadItemToTimeline(params.item as v2.ThreadItem)
        const item = canonical
          ? { harnessItemId: canonical.itemId, item: canonical }
          : mapHarnessHistoryItem(params.item, "codex")
        if (item) {
          this.#onEvent?.({
            item: { ...item, turnId },
            type: "timeline",
          })
        }
      }
    }

    if (method === "turn/completed" && turnId) {
      this.#codexProjectors.delete(turnId)
      this.#onEvent?.({ turnId, type: "turn-completed" })
    }

    const highFrequency =
      method.endsWith("Delta") ||
      method === "item/started" ||
      method === "item/completed" ||
      method === "turn/started" ||
      method === "turn/completed" ||
      method === "turn/diff/updated" ||
      method === "turn/plan/updated"
    if (!highFrequency) {
      this.#onEvent?.({
        agentId: "codex",
        nativeType: message.type,
        payload: params as never,
        type: "harness",
      })
    }
    return true
  }

  #mapMessage(message: AgentRuntimeServerMessage): void {
    const onEvent = this.#onEvent
    if (!onEvent) return
    const payload = payloadOf(message)
    if (this.#mapCodexNotification(message)) return
    if (this.agentId === "codex" && message.type === "agent.codex.item.tool.call.request") {
      const requestId = requestIdOf(message)
      if (requestId === undefined || requestId === null) return
      void this.#manager.codexDynamicTools
        .call(payload as unknown as v2.DynamicToolCallParams)
        .then((result) =>
          this.#manager.handleCodex(
            {
              payload: { requestId: String(requestId), ...result },
              type: "agent.codex.item.tool.call.response",
            },
            { send: this.#receive, sessionId: this.#ownerThreadId ?? String(payload.threadId) }
          )
        )
      return
    }
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
          ...(stringId(payload.itemId ?? request.itemId)
            ? { itemId: String(payload.itemId ?? request.itemId) }
            : {}),
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
          ...(stringId(payload.turnId ?? request.turnId)
            ? { turnId: String(payload.turnId ?? request.turnId) }
            : {}),
        },
        type: "interaction-requested",
      })
      return
    }
    if (message.type === "agent.opencode.event.notification") {
      const event = payload.event as Record<string, unknown>
      const data = (event?.data ?? {}) as Record<string, unknown>
      const form = (data.form ?? {}) as Record<string, unknown>
      const eventSessionId = stringId(data.sessionID ?? form.sessionID)
      if (!eventSessionId || eventSessionId !== this.#harnessSessionId) return
      if (event?.type === "permission.asked" || event?.type === "form.created") {
        const requestId = stringId(event?.type === "permission.asked" ? data.id : form.id)
        if (!requestId) return
        const interactionId = `harness:opencode:${requestId}`
        this.#reverse.set(interactionId, message)
        const questions = event?.type === "form.created" ? openCodeFormQuestions(form) : []
        const firstQuestion = questions[0]
        onEvent({
          interaction: {
            createdAt: new Date().toISOString(),
            expiresAt: null,
            id: interactionId,
            kind: event.type === "permission.asked" ? "permission" : "question",
            message:
              event.type === "permission.asked"
                ? String(data.message ?? `Allow ${String(data.action ?? "requested operation")}?`)
                : String(
                    firstQuestion?.question ?? firstQuestion?.header ?? form.title ?? "Answer form"
                  ),
            options:
              event.type === "permission.asked"
                ? [
                    { description: null, id: "allow_once", label: "Allow once" },
                    { description: null, id: "allow_always", label: "Always allow" },
                    { description: null, id: "deny", label: "Deny" },
                  ]
                : (firstQuestion?.options ?? []),
            ...(event.type === "form.created" ? { questions } : {}),
            title:
              event.type === "permission.asked"
                ? String(data.action ?? "Permission")
                : typeof firstQuestion?.header === "string"
                  ? firstQuestion.header
                  : typeof form.title === "string"
                    ? form.title
                    : null,
          },
          type: "interaction-requested",
        })
        return
      }
      if (
        event?.type === "permission.replied" ||
        event?.type === "form.replied" ||
        event?.type === "form.cancelled"
      ) {
        const requestId = stringId(data.requestID ?? data.id)
        if (requestId) {
          const interactionId = `harness:opencode:${requestId}`
          this.#reverse.delete(interactionId)
          onEvent({ interactionId, type: "interaction-resolved" })
        }
        return
      }
      if (
        event?.type === "session.idle" ||
        event?.type === "session.execution.succeeded" ||
        event?.type === "session.execution.failed" ||
        event?.type === "session.execution.interrupted"
      ) {
        onEvent({ turnId: "active", type: "turn-completed" })
        return
      }
      const item = this.#mapOpenCodeEventItem(event, data)
      if (item) onEvent({ item: { item, harnessItemId: item.itemId }, type: "timeline" })
      return
    }
    if (message.type === "agent.acp.session.update.notification" && message.protocolVersion === 2) {
      const update = payload.update as Record<string, unknown> | undefined
      if (update?.sessionUpdate === "state_update" && update.state === "idle") {
        onEvent({ turnId: "active", type: "turn-completed" })
        return
      }
    }
    if (message.type.includes("turn.completed") || message.type.includes("agent_end")) {
      onEvent({
        turnId: stringId(payload.turnId ?? payload.id) ?? "active",
        type: "turn-completed",
      })
      return
    }
    const item = mapHarnessHistoryItem(
      payload.item ?? payload.message ?? payload.event ?? payload.update,
      this.agentId
    )
    if (item) onEvent({ item, type: "timeline" })
  }

  #mapOpenCodeHistory(value: unknown): ThreadHarnessHistoryItem[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((message) => {
      if (!message || typeof message !== "object") return []
      const record = message as Record<string, unknown>
      const parts = Array.isArray(record.content) ? record.content : [record]
      return parts.flatMap((part, index) => {
        const item = mapHarnessHistoryItem(
          part && typeof part === "object"
            ? {
                id: `${String(record.id ?? "message")}:${index}`,
                messageId: record.id,
                metadata: record.metadata,
                role: record.role ?? record.type,
                ...part,
              }
            : part,
          this.agentId
        )
        return item ? [item] : []
      })
    })
  }

  #mapOpenCodeEventItem(
    event: Record<string, unknown>,
    data: Record<string, unknown>
  ): ThreadTimelineItem | undefined {
    const type = String(event.type ?? "unknown")
    const assistantMessageId =
      stringId(data.assistantMessageID) ?? stringId(event.id) ?? randomUUID()
    const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0
    if (type === "session.text.delta" || type === "session.text.ended") {
      return {
        harnessData: { agentId: this.agentId, nativeType: type, payload: event },
        itemId: `${assistantMessageId}:text:${ordinal}`,
        operation: type.endsWith(".delta") ? "append" : "replace",
        role: "assistant",
        text: String(type.endsWith(".delta") ? (data.delta ?? "") : (data.text ?? "")),
        type: "message",
      }
    }
    if (type === "session.reasoning.delta" || type === "session.reasoning.ended") {
      return {
        harnessData: { agentId: this.agentId, nativeType: type, payload: event },
        itemId: `${assistantMessageId}:reasoning:${ordinal}`,
        operation: type.endsWith(".delta") ? "append" : "replace",
        text: String(type.endsWith(".delta") ? (data.delta ?? "") : (data.text ?? "")),
        type: "reasoning",
      }
    }
    if (type.startsWith("session.tool.")) {
      return mapHarnessItem(
        {
          error: data.error,
          id: data.id,
          input: data.input ?? data.text,
          name: data.name ?? "tool",
          output: data.content,
          status: type.endsWith(".failed")
            ? "failed"
            : type.endsWith(".success")
              ? "completed"
              : "running",
          type: "tool",
        },
        this.agentId
      )
    }
    return undefined
  }
}
