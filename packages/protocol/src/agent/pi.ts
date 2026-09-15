import type {
  JsonAgentSessionEvent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
} from "@earendil-works/pi-coding-agent"
import { z } from "zod"

import { type RequestId, RequestIdSchema } from "../request-id.ts"

type DistributiveOmit<Value, Keys extends PropertyKey> = Value extends unknown
  ? Omit<Value, Extract<Keys, keyof Value>>
  : never

export type PiRpcCommandName = RpcCommand["type"]
export type PiRpcParams<Command extends PiRpcCommandName> = DistributiveOmit<
  Extract<RpcCommand, { type: Command }>,
  "id" | "type"
>

type PiRpcSuccessResponse<Command extends PiRpcCommandName> = Extract<
  RpcResponse,
  { command: Command; success: true }
>

export type PiRpcResult<Command extends PiRpcCommandName> =
  PiRpcSuccessResponse<Command> extends { data: infer Result } ? Result : undefined

type PiRequest<Command extends PiRpcCommandName, Type extends string> = Readonly<
  { requestId: RequestId; type: Type } & PiRpcParams<Command>
>

export type PiResponsePayload<Result> =
  | { readonly error: string; readonly requestId: RequestId }
  | ([Result] extends [undefined]
      ? { readonly requestId: RequestId }
      : { readonly requestId: RequestId; readonly result: Result })

type PiResponse<Command extends PiRpcCommandName, Type extends string> = Readonly<{
  payload: PiResponsePayload<PiRpcResult<Command>>
  type: Type
}>

const addIssues = (
  context: z.RefinementCtx,
  issues: readonly z.core.$ZodIssue[],
  prefix: PropertyKey[] = []
): void => {
  for (const issue of issues) context.addIssue({ ...issue, path: [...prefix, ...issue.path] })
}

const piJsonSchema = <Value>(): z.ZodType<Value> => z.json() as unknown as z.ZodType<Value>

const piRequestSchema = <
  const Command extends PiRpcCommandName,
  const Type extends string,
  ParamsSchema extends z.ZodType,
>(
  command: Command,
  type: Type,
  paramsSchema: ParamsSchema
): z.ZodType<PiRequest<Command, Type>> =>
  z
    .looseObject({ requestId: RequestIdSchema, type: z.literal(type) })
    .transform((message, context) => {
      const { requestId, type: messageType, ...params } = message
      const parsed = paramsSchema.safeParse(params)
      if (!parsed.success) {
        addIssues(context, parsed.error.issues)
        return z.NEVER
      }
      return { ...(parsed.data as object), requestId, type: messageType }
    })
    .refine(
      (message) => z.json().safeParse(message).success,
      `Pi ${command} request must be JSON`
    ) as unknown as z.ZodType<PiRequest<Command, Type>>

const piResponseSchema = <
  const Command extends PiRpcCommandName,
  const Type extends string,
  ResultSchema extends z.ZodType,
>(
  command: Command,
  type: Type,
  resultSchema: ResultSchema
): z.ZodType<PiResponse<Command, Type>> => {
  const isVoidResult = resultSchema.safeParse(undefined).success
  const payloadSchema = z
    .object({
      error: z.string().optional(),
      requestId: RequestIdSchema,
      result: z.json().optional(),
    })
    .transform((payload, context) => {
      const hasError = Object.hasOwn(payload, "error")
      const hasResult = Object.hasOwn(payload, "result")
      if (hasError && hasResult) {
        context.addIssue({
          code: "custom",
          message: `Pi ${command} response cannot contain both result and error`,
        })
        return z.NEVER
      }
      if (hasError) return { error: payload.error as string, requestId: payload.requestId }
      if (isVoidResult) {
        if (hasResult) {
          context.addIssue({
            code: "custom",
            message: `A void Pi ${command} response must omit result`,
            path: ["result"],
          })
          return z.NEVER
        }
        return { requestId: payload.requestId }
      }
      if (!hasResult) {
        context.addIssue({
          code: "custom",
          message: `Pi ${command} response must contain result or error`,
        })
        return z.NEVER
      }
      const parsed = resultSchema.safeParse(payload.result)
      if (!parsed.success) {
        addIssues(context, parsed.error.issues, ["result"])
        return z.NEVER
      }
      return { requestId: payload.requestId, result: parsed.data }
    })

  return z.object({ payload: payloadSchema, type: z.literal(type) }) as z.ZodType<
    PiResponse<Command, Type>
  >
}

const rpc = <
  const Command extends PiRpcCommandName,
  const RequestType extends string,
  const ResponseType extends string,
  ParamsSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
>(
  command: Command,
  request: RequestType,
  response: ResponseType,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema
) => ({
  command,
  request,
  requestSchema: piRequestSchema(command, request, paramsSchema),
  response,
  responseSchema: piResponseSchema(command, response, resultSchema),
})

const piDiscriminatedUnion = <Message>(schemas: readonly z.ZodType[]): z.ZodType<Message> =>
  z.compile(
    z.discriminatedUnion("type", schemas as unknown as Parameters<typeof z.discriminatedUnion>[1])
  ) as z.ZodType<Message>

const emptyParams = z.strictObject({})
const emptyResult = z.undefined()
const imagesSchema = z.array(
  z.strictObject({ data: z.string(), mimeType: z.string(), type: z.literal("image") })
)
const promptParams = z.strictObject({
  images: imagesSchema.optional(),
  message: z.string(),
})
const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const queueModeSchema = z.enum(["all", "one-at-a-time"])

/** Stable logical wire names for every command in the pinned Pi RPC contract. */
export const AGENT_PI_RPC_TYPES = {
  prompt: { request: "agent.pi.prompt.request", response: "agent.pi.prompt.response" },
  steer: { request: "agent.pi.steer.request", response: "agent.pi.steer.response" },
  follow_up: { request: "agent.pi.follow_up.request", response: "agent.pi.follow_up.response" },
  abort: { request: "agent.pi.abort.request", response: "agent.pi.abort.response" },
  clear_queue: {
    request: "agent.pi.queue.clear.request",
    response: "agent.pi.queue.clear.response",
  },
  new_session: {
    request: "agent.pi.session.new.request",
    response: "agent.pi.session.new.response",
  },
  get_state: { request: "agent.pi.state.get.request", response: "agent.pi.state.get.response" },
  set_model: { request: "agent.pi.model.set.request", response: "agent.pi.model.set.response" },
  cycle_model: {
    request: "agent.pi.model.cycle.request",
    response: "agent.pi.model.cycle.response",
  },
  get_available_models: {
    request: "agent.pi.model.available.get.request",
    response: "agent.pi.model.available.get.response",
  },
  set_thinking_level: {
    request: "agent.pi.thinking_level.set.request",
    response: "agent.pi.thinking_level.set.response",
  },
  cycle_thinking_level: {
    request: "agent.pi.thinking_level.cycle.request",
    response: "agent.pi.thinking_level.cycle.response",
  },
  get_available_thinking_levels: {
    request: "agent.pi.thinking_level.available.get.request",
    response: "agent.pi.thinking_level.available.get.response",
  },
  set_steering_mode: {
    request: "agent.pi.steering_mode.set.request",
    response: "agent.pi.steering_mode.set.response",
  },
  set_follow_up_mode: {
    request: "agent.pi.follow_up_mode.set.request",
    response: "agent.pi.follow_up_mode.set.response",
  },
  compact: {
    request: "agent.pi.session.compact.request",
    response: "agent.pi.session.compact.response",
  },
  set_auto_compaction: {
    request: "agent.pi.auto_compaction.set.request",
    response: "agent.pi.auto_compaction.set.response",
  },
  set_auto_retry: {
    request: "agent.pi.auto_retry.set.request",
    response: "agent.pi.auto_retry.set.response",
  },
  abort_retry: {
    request: "agent.pi.retry.abort.request",
    response: "agent.pi.retry.abort.response",
  },
  bash: { request: "agent.pi.bash.request", response: "agent.pi.bash.response" },
  abort_bash: { request: "agent.pi.bash.abort.request", response: "agent.pi.bash.abort.response" },
  get_session_stats: {
    request: "agent.pi.session.stats.get.request",
    response: "agent.pi.session.stats.get.response",
  },
  export_html: {
    request: "agent.pi.session.html.export.request",
    response: "agent.pi.session.html.export.response",
  },
  switch_session: {
    request: "agent.pi.session.switch.request",
    response: "agent.pi.session.switch.response",
  },
  fork: { request: "agent.pi.session.fork.request", response: "agent.pi.session.fork.response" },
  clone: { request: "agent.pi.session.clone.request", response: "agent.pi.session.clone.response" },
  get_fork_messages: {
    request: "agent.pi.session.fork_messages.get.request",
    response: "agent.pi.session.fork_messages.get.response",
  },
  get_entries: {
    request: "agent.pi.session.entries.get.request",
    response: "agent.pi.session.entries.get.response",
  },
  get_tree: {
    request: "agent.pi.session.tree.get.request",
    response: "agent.pi.session.tree.get.response",
  },
  get_last_assistant_text: {
    request: "agent.pi.session.last_assistant_text.get.request",
    response: "agent.pi.session.last_assistant_text.get.response",
  },
  set_session_name: {
    request: "agent.pi.session.name.set.request",
    response: "agent.pi.session.name.set.response",
  },
  get_messages: {
    request: "agent.pi.messages.get.request",
    response: "agent.pi.messages.get.response",
  },
  get_commands: {
    request: "agent.pi.commands.get.request",
    response: "agent.pi.commands.get.response",
  },
} as const satisfies Record<PiRpcCommandName, { request: string; response: string }>

export type AgentPiRpcRegistry = {
  readonly [Command in PiRpcCommandName]: {
    readonly command: Command
    readonly request: (typeof AGENT_PI_RPC_TYPES)[Command]["request"]
    readonly requestSchema: z.ZodType<
      PiRequest<Command, (typeof AGENT_PI_RPC_TYPES)[Command]["request"]>
    >
    readonly response: (typeof AGENT_PI_RPC_TYPES)[Command]["response"]
    readonly responseSchema: z.ZodType<
      PiResponse<Command, (typeof AGENT_PI_RPC_TYPES)[Command]["response"]>
    >
  }
}

/** Complete, type-checked mapping of Pi RPC commands into Cypheria logical request/response pairs. */
const agentPiRpc = {
  prompt: rpc(
    "prompt",
    "agent.pi.prompt.request",
    "agent.pi.prompt.response",
    promptParams.extend({ streamingBehavior: z.enum(["steer", "followUp"]).optional() }),
    emptyResult
  ),
  steer: rpc(
    "steer",
    "agent.pi.steer.request",
    "agent.pi.steer.response",
    promptParams,
    emptyResult
  ),
  follow_up: rpc(
    "follow_up",
    "agent.pi.follow_up.request",
    "agent.pi.follow_up.response",
    promptParams,
    emptyResult
  ),
  abort: rpc(
    "abort",
    "agent.pi.abort.request",
    "agent.pi.abort.response",
    emptyParams,
    emptyResult
  ),
  clear_queue: rpc(
    "clear_queue",
    "agent.pi.queue.clear.request",
    "agent.pi.queue.clear.response",
    emptyParams,
    z.strictObject({ steering: z.array(z.string()), followUp: z.array(z.string()) })
  ),
  new_session: rpc(
    "new_session",
    "agent.pi.session.new.request",
    "agent.pi.session.new.response",
    z.strictObject({ parentSession: z.string().optional() }),
    z.strictObject({ cancelled: z.boolean() })
  ),
  get_state: rpc(
    "get_state",
    "agent.pi.state.get.request",
    "agent.pi.state.get.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"get_state">>()
  ),
  set_model: rpc(
    "set_model",
    "agent.pi.model.set.request",
    "agent.pi.model.set.response",
    z.strictObject({ modelId: z.string(), provider: z.string() }),
    piJsonSchema<PiRpcResult<"set_model">>()
  ),
  cycle_model: rpc(
    "cycle_model",
    "agent.pi.model.cycle.request",
    "agent.pi.model.cycle.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"cycle_model">>()
  ),
  get_available_models: rpc(
    "get_available_models",
    "agent.pi.model.available.get.request",
    "agent.pi.model.available.get.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"get_available_models">>()
  ),
  set_thinking_level: rpc(
    "set_thinking_level",
    "agent.pi.thinking_level.set.request",
    "agent.pi.thinking_level.set.response",
    z.strictObject({ level: thinkingLevelSchema }),
    emptyResult
  ),
  cycle_thinking_level: rpc(
    "cycle_thinking_level",
    "agent.pi.thinking_level.cycle.request",
    "agent.pi.thinking_level.cycle.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"cycle_thinking_level">>()
  ),
  get_available_thinking_levels: rpc(
    "get_available_thinking_levels",
    "agent.pi.thinking_level.available.get.request",
    "agent.pi.thinking_level.available.get.response",
    emptyParams,
    z.strictObject({ levels: z.array(thinkingLevelSchema) })
  ),
  set_steering_mode: rpc(
    "set_steering_mode",
    "agent.pi.steering_mode.set.request",
    "agent.pi.steering_mode.set.response",
    z.strictObject({ mode: queueModeSchema }),
    emptyResult
  ),
  set_follow_up_mode: rpc(
    "set_follow_up_mode",
    "agent.pi.follow_up_mode.set.request",
    "agent.pi.follow_up_mode.set.response",
    z.strictObject({ mode: queueModeSchema }),
    emptyResult
  ),
  compact: rpc(
    "compact",
    "agent.pi.session.compact.request",
    "agent.pi.session.compact.response",
    z.strictObject({ customInstructions: z.string().optional() }),
    piJsonSchema<PiRpcResult<"compact">>()
  ),
  set_auto_compaction: rpc(
    "set_auto_compaction",
    "agent.pi.auto_compaction.set.request",
    "agent.pi.auto_compaction.set.response",
    z.strictObject({ enabled: z.boolean() }),
    emptyResult
  ),
  set_auto_retry: rpc(
    "set_auto_retry",
    "agent.pi.auto_retry.set.request",
    "agent.pi.auto_retry.set.response",
    z.strictObject({ enabled: z.boolean() }),
    emptyResult
  ),
  abort_retry: rpc(
    "abort_retry",
    "agent.pi.retry.abort.request",
    "agent.pi.retry.abort.response",
    emptyParams,
    emptyResult
  ),
  bash: rpc(
    "bash",
    "agent.pi.bash.request",
    "agent.pi.bash.response",
    z.strictObject({ command: z.string(), excludeFromContext: z.boolean().optional() }),
    piJsonSchema<PiRpcResult<"bash">>()
  ),
  abort_bash: rpc(
    "abort_bash",
    "agent.pi.bash.abort.request",
    "agent.pi.bash.abort.response",
    emptyParams,
    emptyResult
  ),
  get_session_stats: rpc(
    "get_session_stats",
    "agent.pi.session.stats.get.request",
    "agent.pi.session.stats.get.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"get_session_stats">>()
  ),
  export_html: rpc(
    "export_html",
    "agent.pi.session.html.export.request",
    "agent.pi.session.html.export.response",
    z.strictObject({ outputPath: z.string().optional() }),
    z.strictObject({ path: z.string() })
  ),
  switch_session: rpc(
    "switch_session",
    "agent.pi.session.switch.request",
    "agent.pi.session.switch.response",
    z.strictObject({ sessionPath: z.string() }),
    z.strictObject({ cancelled: z.boolean() })
  ),
  fork: rpc(
    "fork",
    "agent.pi.session.fork.request",
    "agent.pi.session.fork.response",
    z.strictObject({ entryId: z.string() }),
    z.strictObject({ cancelled: z.boolean(), text: z.string() })
  ),
  clone: rpc(
    "clone",
    "agent.pi.session.clone.request",
    "agent.pi.session.clone.response",
    emptyParams,
    z.strictObject({ cancelled: z.boolean() })
  ),
  get_fork_messages: rpc(
    "get_fork_messages",
    "agent.pi.session.fork_messages.get.request",
    "agent.pi.session.fork_messages.get.response",
    emptyParams,
    z.strictObject({
      messages: z.array(z.strictObject({ entryId: z.string(), text: z.string() })),
    })
  ),
  get_entries: rpc(
    "get_entries",
    "agent.pi.session.entries.get.request",
    "agent.pi.session.entries.get.response",
    z.strictObject({ since: z.string().optional() }),
    piJsonSchema<PiRpcResult<"get_entries">>()
  ),
  get_tree: rpc(
    "get_tree",
    "agent.pi.session.tree.get.request",
    "agent.pi.session.tree.get.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"get_tree">>()
  ),
  get_last_assistant_text: rpc(
    "get_last_assistant_text",
    "agent.pi.session.last_assistant_text.get.request",
    "agent.pi.session.last_assistant_text.get.response",
    emptyParams,
    z.strictObject({ text: z.string().nullable() })
  ),
  set_session_name: rpc(
    "set_session_name",
    "agent.pi.session.name.set.request",
    "agent.pi.session.name.set.response",
    z.strictObject({ name: z.string() }),
    emptyResult
  ),
  get_messages: rpc(
    "get_messages",
    "agent.pi.messages.get.request",
    "agent.pi.messages.get.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"get_messages">>()
  ),
  get_commands: rpc(
    "get_commands",
    "agent.pi.commands.get.request",
    "agent.pi.commands.get.response",
    emptyParams,
    piJsonSchema<PiRpcResult<"get_commands">>()
  ),
} as const satisfies AgentPiRpcRegistry

export const AGENT_PI_RPC: AgentPiRpcRegistry = agentPiRpc

type PiRpcDefinition = (typeof AGENT_PI_RPC)[keyof typeof AGENT_PI_RPC]
export type AgentPiClientRequest = z.infer<PiRpcDefinition["requestSchema"]>
export type AgentPiServerResponse = z.infer<PiRpcDefinition["responseSchema"]>

export const AgentPiClientRequestSchema: z.ZodType<AgentPiClientRequest> = z.compile(
  z.discriminatedUnion(
    "type",
    Object.values(AGENT_PI_RPC).map(({ requestSchema }) => requestSchema) as unknown as Parameters<
      typeof z.discriminatedUnion
    >[1]
  )
) as z.ZodType<AgentPiClientRequest>

export const AgentPiServerResponseSchema: z.ZodType<AgentPiServerResponse> = z.compile(
  z.discriminatedUnion(
    "type",
    Object.values(AGENT_PI_RPC).map(
      ({ responseSchema }) => responseSchema
    ) as unknown as Parameters<typeof z.discriminatedUnion>[1]
  )
) as z.ZodType<AgentPiServerResponse>

export const AGENT_PI_EVENT_NOTIFICATIONS = {
  agent_start: "agent.pi.agent.start.notification",
  agent_end: "agent.pi.agent.end.notification",
  agent_settled: "agent.pi.agent.settled.notification",
  turn_start: "agent.pi.turn.start.notification",
  turn_end: "agent.pi.turn.end.notification",
  message_start: "agent.pi.message.start.notification",
  message_update: "agent.pi.message.update.notification",
  message_end: "agent.pi.message.end.notification",
  tool_execution_start: "agent.pi.tool_execution.start.notification",
  tool_execution_update: "agent.pi.tool_execution.update.notification",
  tool_execution_end: "agent.pi.tool_execution.end.notification",
  queue_update: "agent.pi.queue.update.notification",
  compaction_start: "agent.pi.compaction.start.notification",
  compaction_end: "agent.pi.compaction.end.notification",
  entry_appended: "agent.pi.entry.appended.notification",
  session_info_changed: "agent.pi.session.info_changed.notification",
  thinking_level_changed: "agent.pi.thinking_level.changed.notification",
  auto_retry_start: "agent.pi.auto_retry.start.notification",
  auto_retry_end: "agent.pi.auto_retry.end.notification",
  summarization_retry_scheduled: "agent.pi.summarization_retry.scheduled.notification",
  summarization_retry_attempt_start: "agent.pi.summarization_retry.attempt_start.notification",
  summarization_retry_finished: "agent.pi.summarization_retry.finished.notification",
  bash_execution_update: "agent.pi.bash.execution_update.notification",
} as const satisfies Record<JsonAgentSessionEvent["type"], string>

export type PiExtensionErrorEvent = {
  readonly error: string
  readonly event: string
  readonly extensionPath: string
  readonly type: "extension_error"
}

export type PiServerEvent = JsonAgentSessionEvent | RpcExtensionUIRequest | PiExtensionErrorEvent

type PiEventNotification<Event extends PiServerEvent, Type extends string> = Readonly<{
  payload: Event
  type: Type
}>

const piEventNotificationSchema = <Event extends PiServerEvent, const Type extends string>(
  type: Type,
  eventType: Event["type"]
): z.ZodType<PiEventNotification<Event, Type>> =>
  z.object({ payload: z.json(), type: z.literal(type) }).superRefine(({ payload }, context) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      payload.type !== eventType
    ) {
      context.addIssue({
        code: "custom",
        message: `Expected Pi event payload type ${eventType}`,
        path: ["payload", "type"],
      })
    }
  }) as unknown as z.ZodType<PiEventNotification<Event, Type>>

const eventNotificationSchemas = Object.entries(AGENT_PI_EVENT_NOTIFICATIONS).map(
  ([eventType, type]) => piEventNotificationSchema(type, eventType as JsonAgentSessionEvent["type"])
)

export const AgentPiExtensionErrorNotificationSchema = piEventNotificationSchema<
  PiExtensionErrorEvent,
  "agent.pi.extension.error.notification"
>("agent.pi.extension.error.notification", "extension_error")

type AgentPiSessionEventNotification = {
  [EventType in JsonAgentSessionEvent["type"]]: PiEventNotification<
    Extract<JsonAgentSessionEvent, { type: EventType }>,
    (typeof AGENT_PI_EVENT_NOTIFICATIONS)[EventType]
  >
}[JsonAgentSessionEvent["type"]]

export type AgentPiEventNotification =
  | AgentPiSessionEventNotification
  | PiEventNotification<PiExtensionErrorEvent, "agent.pi.extension.error.notification">

export const AgentPiEventNotificationSchema: z.ZodType<AgentPiEventNotification> = z.compile(
  z.discriminatedUnion("type", [
    ...eventNotificationSchemas,
    AgentPiExtensionErrorNotificationSchema,
  ] as unknown as Parameters<typeof z.discriminatedUnion>[1])
) as z.ZodType<AgentPiEventNotification>

export const AGENT_PI_EXTENSION_UI = {
  select: {
    request: "agent.pi.extension_ui.select.request",
    response: "agent.pi.extension_ui.select.response",
  },
  confirm: {
    request: "agent.pi.extension_ui.confirm.request",
    response: "agent.pi.extension_ui.confirm.response",
  },
  input: {
    request: "agent.pi.extension_ui.input.request",
    response: "agent.pi.extension_ui.input.response",
  },
  editor: {
    request: "agent.pi.extension_ui.editor.request",
    response: "agent.pi.extension_ui.editor.response",
  },
  notify: { notification: "agent.pi.extension_ui.notify.notification" },
  setStatus: { notification: "agent.pi.extension_ui.status.set.notification" },
  setWidget: { notification: "agent.pi.extension_ui.widget.set.notification" },
  setTitle: { notification: "agent.pi.extension_ui.title.set.notification" },
  set_editor_text: { notification: "agent.pi.extension_ui.editor_text.set.notification" },
} as const satisfies Record<RpcExtensionUIRequest["method"], unknown>

export type PiBlockingExtensionUIMethod = "select" | "confirm" | "input" | "editor"
export type PiExtensionUIRequest<Method extends RpcExtensionUIRequest["method"]> = Extract<
  RpcExtensionUIRequest,
  { method: Method }
> & { readonly id: string; readonly method: Method }
export type PiExtensionUIResponse<Method extends PiBlockingExtensionUIMethod> =
  | Extract<RpcExtensionUIResponse, { cancelled: true }>
  | (Method extends "confirm"
      ? Extract<RpcExtensionUIResponse, { confirmed: boolean }>
      : Extract<RpcExtensionUIResponse, { value: string }>)

type PiExtensionUIRequestEnvelope<
  Method extends PiBlockingExtensionUIMethod,
  Type extends string,
> = Readonly<{
  payload: PiExtensionUIRequest<Method>
  requestId: RequestId
  type: Type
}>

type PiExtensionUIResponseEnvelope<
  Method extends PiBlockingExtensionUIMethod,
  Type extends string,
> = Readonly<{
  payload: PiExtensionUIResponse<Method>
  requestId: RequestId
  type: Type
}>

const piExtensionUIRequestSchema = <
  const Method extends PiBlockingExtensionUIMethod,
  const Type extends string,
>(
  method: Method,
  type: Type
): z.ZodType<PiExtensionUIRequestEnvelope<Method, Type>> =>
  z
    .object({ payload: z.json(), requestId: RequestIdSchema, type: z.literal(type) })
    .superRefine(({ payload, requestId }, context) => {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        context.addIssue({ code: "custom", message: "Expected a Pi extension UI request payload" })
        return
      }
      if (payload.type !== "extension_ui_request" || payload.method !== method) {
        context.addIssue({
          code: "custom",
          message: `Expected Pi extension UI ${method} request`,
          path: ["payload", "method"],
        })
      }
      if (payload.id !== requestId) {
        context.addIssue({
          code: "custom",
          message: "Pi extension UI request id must match the Cypheria request id",
          path: ["payload", "id"],
        })
      }
    }) as unknown as z.ZodType<PiExtensionUIRequestEnvelope<Method, Type>>

const piExtensionUIResponseSchema = <
  const Method extends PiBlockingExtensionUIMethod,
  const Type extends string,
>(
  method: Method,
  type: Type
): z.ZodType<PiExtensionUIResponseEnvelope<Method, Type>> =>
  z
    .object({ payload: z.json(), requestId: RequestIdSchema, type: z.literal(type) })
    .superRefine(({ payload, requestId }, context) => {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        context.addIssue({ code: "custom", message: "Expected a Pi extension UI response payload" })
        return
      }
      const isCancelled = payload.cancelled === true
      const hasResult =
        method === "confirm"
          ? typeof payload.confirmed === "boolean"
          : typeof payload.value === "string"
      if (payload.type !== "extension_ui_response" || (!isCancelled && !hasResult)) {
        context.addIssue({
          code: "custom",
          message: `Expected Pi extension UI ${method} response`,
          path: ["payload"],
        })
      }
      if (payload.id !== requestId) {
        context.addIssue({
          code: "custom",
          message: "Pi extension UI response id must match the Cypheria request id",
          path: ["payload", "id"],
        })
      }
    }) as unknown as z.ZodType<PiExtensionUIResponseEnvelope<Method, Type>>

const blockingExtensionUISchemas = (["select", "confirm", "input", "editor"] as const).map(
  (method) => ({
    request: piExtensionUIRequestSchema(method, AGENT_PI_EXTENSION_UI[method].request),
    response: piExtensionUIResponseSchema(method, AGENT_PI_EXTENSION_UI[method].response),
  })
)

export type AgentPiServerRequest = {
  [Method in PiBlockingExtensionUIMethod]: PiExtensionUIRequestEnvelope<
    Method,
    (typeof AGENT_PI_EXTENSION_UI)[Method]["request"]
  >
}[PiBlockingExtensionUIMethod]
export type AgentPiClientResponse = {
  [Method in PiBlockingExtensionUIMethod]: PiExtensionUIResponseEnvelope<
    Method,
    (typeof AGENT_PI_EXTENSION_UI)[Method]["response"]
  >
}[PiBlockingExtensionUIMethod]

export const AgentPiServerRequestSchema: z.ZodType<AgentPiServerRequest> = z.compile(
  z.discriminatedUnion(
    "type",
    blockingExtensionUISchemas.map(({ request }) => request) as unknown as Parameters<
      typeof z.discriminatedUnion
    >[1]
  )
) as z.ZodType<AgentPiServerRequest>

export const AgentPiClientResponseSchema: z.ZodType<AgentPiClientResponse> = z.compile(
  z.discriminatedUnion(
    "type",
    blockingExtensionUISchemas.map(({ response }) => response) as unknown as Parameters<
      typeof z.discriminatedUnion
    >[1]
  )
) as z.ZodType<AgentPiClientResponse>

const extensionUINotificationSchemas = (
  [
    ["notify", "agent.pi.extension_ui.notify.notification"],
    ["setStatus", "agent.pi.extension_ui.status.set.notification"],
    ["setWidget", "agent.pi.extension_ui.widget.set.notification"],
    ["setTitle", "agent.pi.extension_ui.title.set.notification"],
    ["set_editor_text", "agent.pi.extension_ui.editor_text.set.notification"],
  ] as const
).map(([method, type]) =>
  piEventNotificationSchema<PiExtensionUIRequest<typeof method>, typeof type>(
    type,
    "extension_ui_request"
  ).superRefine(({ payload }, context) => {
    if (payload.method !== method) {
      context.addIssue({
        code: "custom",
        message: `Expected Pi extension UI method ${method}`,
        path: ["payload", "method"],
      })
    }
  })
)

type PiNonBlockingExtensionUIMethod = Exclude<
  RpcExtensionUIRequest["method"],
  PiBlockingExtensionUIMethod
>
export type AgentPiExtensionUINotification = {
  [Method in PiNonBlockingExtensionUIMethod]: PiEventNotification<
    PiExtensionUIRequest<Method>,
    (typeof AGENT_PI_EXTENSION_UI)[Method]["notification"]
  >
}[PiNonBlockingExtensionUIMethod]
export const AgentPiExtensionUINotificationSchema: z.ZodType<AgentPiExtensionUINotification> =
  z.compile(
    z.discriminatedUnion(
      "type",
      extensionUINotificationSchemas as unknown as Parameters<typeof z.discriminatedUnion>[1]
    )
  ) as z.ZodType<AgentPiExtensionUINotification>

export type AgentPiClientMessage = AgentPiClientRequest | AgentPiClientResponse
export const AgentPiClientMessageSchema: z.ZodType<AgentPiClientMessage> = z.compile(
  piDiscriminatedUnion<AgentPiClientMessage>([
    AgentPiClientRequestSchema,
    AgentPiClientResponseSchema,
  ])
) as z.ZodType<AgentPiClientMessage>

export type AgentPiServerMessage =
  | AgentPiServerResponse
  | AgentPiEventNotification
  | AgentPiServerRequest
  | AgentPiExtensionUINotification
export const AgentPiServerMessageSchema: z.ZodType<AgentPiServerMessage> = z.compile(
  piDiscriminatedUnion<AgentPiServerMessage>([
    AgentPiServerResponseSchema,
    AgentPiEventNotificationSchema,
    AgentPiServerRequestSchema,
    AgentPiExtensionUINotificationSchema,
  ])
) as z.ZodType<AgentPiServerMessage>

const piRpcDefinitionsByRequestType = new Map<string, AgentPiRpcRegistry[PiRpcCommandName]>(
  Object.values(AGENT_PI_RPC).map((definition) => [definition.request, definition])
)

/** Looks up the Pi command represented by a concrete Cypheria request type. */
export const getAgentPiRpcDefinition = (
  message: AgentPiClientRequest
): AgentPiRpcRegistry[PiRpcCommandName] => {
  const definition = piRpcDefinitionsByRequestType.get(message.type)
  if (!definition) throw new Error(`Unsupported Pi RPC request type: ${message.type}`)
  return definition
}

/** Converts a validated Cypheria request into one JSONL command for `pi --mode rpc`. */
export const unwrapPiRpcCommand = (message: AgentPiClientRequest): RpcCommand => {
  const definition = getAgentPiRpcDefinition(message)
  const { requestId, type: _type, ...params } = message
  return { ...params, id: requestId, type: definition.command } as RpcCommand
}

/** Converts one correlated Pi JSONL response into its concrete Cypheria response pair. */
export const wrapPiRpcResponse = (response: RpcResponse): AgentPiServerResponse => {
  if (!response.id) throw new Error(`Pi ${response.command} response is missing its request id`)
  const definition = AGENT_PI_RPC[response.command as PiRpcCommandName]
  if (!definition) throw new Error(`Unsupported Pi RPC response command: ${response.command}`)
  if (!response.success) {
    return AgentPiServerResponseSchema.parse({
      payload: { error: response.error, requestId: response.id },
      type: definition.response,
    })
  }
  const responseWithOptionalData = response as RpcResponse & { readonly data?: unknown }
  return AgentPiServerResponseSchema.parse({
    payload: {
      requestId: response.id,
      ...(Object.hasOwn(responseWithOptionalData, "data")
        ? { result: responseWithOptionalData.data }
        : {}),
    },
    type: definition.response,
  })
}

/** Converts one Pi stdout event or extension UI interaction into a concrete logical message. */
export const wrapPiServerEvent = (
  event: PiServerEvent
): Exclude<AgentPiServerMessage, AgentPiServerResponse> => {
  if (event.type === "extension_ui_request") {
    const definition = AGENT_PI_EXTENSION_UI[event.method]
    if ("request" in definition) {
      return AgentPiServerRequestSchema.parse({
        payload: event,
        requestId: event.id,
        type: definition.request,
      })
    }
    return AgentPiExtensionUINotificationSchema.parse({
      payload: event,
      type: definition.notification,
    })
  }
  if (event.type === "extension_error") {
    return AgentPiExtensionErrorNotificationSchema.parse({
      payload: event,
      type: "agent.pi.extension.error.notification",
    })
  }
  return AgentPiEventNotificationSchema.parse({
    payload: event,
    type: AGENT_PI_EVENT_NOTIFICATIONS[event.type],
  })
}

/** Restores the exact Pi stdout event carried by a logical notification or reverse request. */
export const unwrapPiServerEvent = (
  message: AgentPiEventNotification | AgentPiServerRequest | AgentPiExtensionUINotification
): PiServerEvent => message.payload

/** Restores the exact extension UI response expected on Pi stdin. */
export const unwrapPiExtensionUIResponse = (
  message: AgentPiClientResponse
): RpcExtensionUIResponse => message.payload
