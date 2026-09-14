import type { ErrorResponse, JsonRpcId } from "@agentclientprotocol/sdk"
import { zError as AcpSdkErrorSchema } from "@agentclientprotocol/sdk/zod"
import { z } from "zod"

export const AcpJsonRpcIdSchema: z.ZodType<JsonRpcId> = z.union([
  z.string(),
  z.number().finite(),
  z.null(),
])

export const AcpErrorResponseSchema: z.ZodType<ErrorResponse> = AcpSdkErrorSchema.refine(
  (error) => z.json().safeParse(error).success,
  "ACP error response must be JSON"
)

type AcpRequest<ProtocolVersion extends number, Type extends string, Params> = {
  readonly protocolVersion: ProtocolVersion
  readonly requestId: JsonRpcId
  readonly type: Type
} & Params

export type AcpResponsePayload<Result> =
  | { readonly error: ErrorResponse; readonly requestId: JsonRpcId }
  | { readonly requestId: JsonRpcId; readonly result: Result }

type AcpResponse<ProtocolVersion extends number, Type extends string, Result> = {
  readonly payload: AcpResponsePayload<Result>
  readonly protocolVersion: ProtocolVersion
  readonly type: Type
}

type AcpNotification<ProtocolVersion extends number, Type extends string, Params> = {
  readonly payload: Params
  readonly protocolVersion: ProtocolVersion
  readonly type: Type
}

const jsonMessage = <Output>(schema: z.ZodType<Output>): z.ZodType<Output> =>
  schema.refine(
    (message) => z.json().safeParse(message).success,
    "ACP logical message must be JSON"
  )

const addIssues = (
  context: z.RefinementCtx,
  issues: readonly z.core.$ZodIssue[],
  prefix: PropertyKey[] = []
): void => {
  for (const issue of issues) {
    context.addIssue({ ...issue, path: [...prefix, ...issue.path] })
  }
}

export const acpRequestSchema = <
  const ProtocolVersion extends number,
  const Type extends string,
  ParamsSchema extends z.ZodType,
>(
  protocolVersion: ProtocolVersion,
  type: Type,
  paramsSchema: ParamsSchema
): z.ZodType<AcpRequest<ProtocolVersion, Type, z.output<ParamsSchema>>> =>
  jsonMessage(
    z
      .looseObject({
        protocolVersion: z.literal(protocolVersion),
        requestId: AcpJsonRpcIdSchema,
        type: z.literal(type),
      })
      .transform((message, context) => {
        const { requestId, type: messageType, ...params } = message
        const parsed = paramsSchema.safeParse(params)
        if (!parsed.success) {
          addIssues(context, parsed.error.issues)
          return z.NEVER
        }
        return {
          ...(parsed.data as Record<string, unknown>),
          protocolVersion,
          requestId,
          type: messageType,
        } as AcpRequest<ProtocolVersion, Type, z.output<ParamsSchema>>
      })
  )

export const acpResponseSchema = <
  const ProtocolVersion extends number,
  const Type extends string,
  ResultSchema extends z.ZodType,
  const AllowNull extends boolean,
>(
  protocolVersion: ProtocolVersion,
  type: Type,
  resultSchema: ResultSchema,
  allowNull: AllowNull
): z.ZodType<
  AcpResponse<
    ProtocolVersion,
    Type,
    z.output<ResultSchema> | (AllowNull extends true ? null : never)
  >
> => {
  const payloadSchema = z
    .object({
      error: AcpErrorResponseSchema.optional(),
      requestId: AcpJsonRpcIdSchema,
      result: z.json().optional(),
    })
    .transform((payload, context) => {
      const hasError = Object.hasOwn(payload, "error")
      const hasResult = Object.hasOwn(payload, "result")
      if (hasError === hasResult) {
        context.addIssue({
          code: "custom",
          message: "ACP response must contain exactly one of result and error",
        })
        return z.NEVER
      }
      if (hasError) {
        return { error: payload.error as ErrorResponse, requestId: payload.requestId }
      }
      if (allowNull && payload.result === null) {
        return { requestId: payload.requestId, result: null }
      }
      const parsed = resultSchema.safeParse(payload.result)
      if (!parsed.success) {
        addIssues(context, parsed.error.issues, ["result"])
        return z.NEVER
      }
      return {
        requestId: payload.requestId,
        result: parsed.data,
      }
    })

  return jsonMessage(
    z.object({
      payload: payloadSchema,
      protocolVersion: z.literal(protocolVersion),
      type: z.literal(type),
    })
  ) as z.ZodType<
    AcpResponse<
      ProtocolVersion,
      Type,
      z.output<ResultSchema> | (AllowNull extends true ? null : never)
    >
  >
}

export const acpNotificationSchema = <
  const ProtocolVersion extends number,
  const Type extends string,
  ParamsSchema extends z.ZodType,
>(
  protocolVersion: ProtocolVersion,
  type: Type,
  paramsSchema: ParamsSchema
): z.ZodType<AcpNotification<ProtocolVersion, Type, z.output<ParamsSchema>>> =>
  jsonMessage(
    z.object({
      payload: paramsSchema,
      protocolVersion: z.literal(protocolVersion),
      type: z.literal(type),
    })
  ) as z.ZodType<AcpNotification<ProtocolVersion, Type, z.output<ParamsSchema>>>

export const acpDiscriminatedUnion = <Message>(
  discriminator: string,
  schemas: readonly z.ZodType[]
): z.ZodType<Message> =>
  z.compile(
    z.discriminatedUnion(
      discriminator,
      schemas as unknown as Parameters<typeof z.discriminatedUnion>[1]
    )
  ) as z.ZodType<Message>
