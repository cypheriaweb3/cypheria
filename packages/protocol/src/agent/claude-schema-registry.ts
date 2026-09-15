import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

import { RequestIdSchema } from "../request-id.ts"

export const ClaudeQueryIdSchema = z.string().trim().min(1).max(128)
export type ClaudeQueryId = z.infer<typeof ClaudeQueryIdSchema>

export const ClaudeSdkErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  data: z.json().optional(),
  message: z.string(),
})
export type ClaudeSdkError = z.infer<typeof ClaudeSdkErrorSchema>

type ClaudeRequest<Type extends string, Params> = {
  readonly requestId: z.infer<typeof RequestIdSchema>
  readonly type: Type
} & Params

export type ClaudeResponsePayload<Result> =
  | { readonly error: ClaudeSdkError; readonly requestId: z.infer<typeof RequestIdSchema> }
  | ([Result] extends [undefined]
      ? { readonly requestId: z.infer<typeof RequestIdSchema> }
      : { readonly requestId: z.infer<typeof RequestIdSchema>; readonly result: Result })

type ClaudeResponse<Type extends string, Result> = {
  readonly payload: ClaudeResponsePayload<Result>
  readonly type: Type
}

export type AgentClaudeSdkNotification<
  Message extends SDKMessage = SDKMessage,
  Type extends string = string,
> = {
  readonly payload: Message
  readonly queryId: ClaudeQueryId
  readonly type: Type
}

const addIssues = (
  context: z.RefinementCtx,
  issues: readonly z.core.$ZodIssue[],
  prefix: PropertyKey[] = []
): void => {
  for (const issue of issues) context.addIssue({ ...issue, path: [...prefix, ...issue.path] })
}

export const claudeJsonSchema = <Value>(): z.ZodType<Value> =>
  z.json() as unknown as z.ZodType<Value>

export const claudeRequestSchema = <const Type extends string, ParamsSchema extends z.ZodType>(
  type: Type,
  paramsSchema: ParamsSchema
): z.ZodType<ClaudeRequest<Type, z.output<ParamsSchema>>> =>
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
      "Claude Agent SDK request must be JSON"
    ) as unknown as z.ZodType<ClaudeRequest<Type, z.output<ParamsSchema>>>

export const claudeResponseSchema = <const Type extends string, ResultSchema extends z.ZodType>(
  type: Type,
  resultSchema: ResultSchema
): z.ZodType<ClaudeResponse<Type, z.output<ResultSchema>>> => {
  const isVoidResult = resultSchema.safeParse(undefined).success
  const payloadSchema = z
    .object({
      error: ClaudeSdkErrorSchema.optional(),
      requestId: RequestIdSchema,
      result: z.json().optional(),
    })
    .transform((payload, context) => {
      const hasError = Object.hasOwn(payload, "error")
      const hasResult = Object.hasOwn(payload, "result")
      if (hasError && hasResult) {
        context.addIssue({
          code: "custom",
          message: "Claude Agent SDK response cannot contain both result and error",
        })
        return z.NEVER
      }
      if (hasError) return { error: payload.error as ClaudeSdkError, requestId: payload.requestId }
      if (isVoidResult) {
        if (hasResult) {
          context.addIssue({
            code: "custom",
            message: "A void Claude Agent SDK response must omit result",
            path: ["result"],
          })
          return z.NEVER
        }
        return { requestId: payload.requestId }
      }
      if (!hasResult) {
        context.addIssue({
          code: "custom",
          message: "Claude Agent SDK response must contain result or error",
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
    ClaudeResponse<Type, z.output<ResultSchema>>
  >
}

export const claudeSdkMessageNotificationSchema = <
  Message extends SDKMessage,
  const Type extends string,
>(
  type: Type,
  payloadType: string,
  payloadSubtypes: readonly string[],
  replay?: "live" | "replay"
): z.ZodType<AgentClaudeSdkNotification<Message, Type>> =>
  z
    .object({
      payload: z.json(),
      queryId: ClaudeQueryIdSchema,
      type: z.literal(type),
    })
    .superRefine(({ payload }, context) => {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        context.addIssue({
          code: "custom",
          message: "Claude SDK message payload must be an object",
        })
        return
      }
      if (payload.type !== payloadType) {
        context.addIssue({
          code: "custom",
          message: `Expected Claude SDK payload type ${payloadType}`,
          path: ["payload", "type"],
        })
      }
      if (payloadSubtypes.length > 0 && !payloadSubtypes.includes(String(payload.subtype))) {
        context.addIssue({
          code: "custom",
          message: `Unexpected Claude SDK payload subtype ${String(payload.subtype)}`,
          path: ["payload", "subtype"],
        })
      }
      if (replay === "replay" && payload.isReplay !== true) {
        context.addIssue({
          code: "custom",
          message: "Expected a replayed Claude user message",
          path: ["payload", "isReplay"],
        })
      }
      if (replay === "live" && payload.isReplay === true) {
        context.addIssue({
          code: "custom",
          message: "A replayed Claude user message must use the replay notification type",
          path: ["payload", "isReplay"],
        })
      }
    }) as unknown as z.ZodType<AgentClaudeSdkNotification<Message, Type>>

export const claudeDiscriminatedUnion = <Message>(
  schemas: readonly z.ZodType[]
): z.ZodType<Message> =>
  z.compile(
    z.discriminatedUnion("type", schemas as unknown as Parameters<typeof z.discriminatedUnion>[1])
  ) as z.ZodType<Message>
