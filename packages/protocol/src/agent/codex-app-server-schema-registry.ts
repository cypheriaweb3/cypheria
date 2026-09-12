import { z } from "zod"
import type {
  ConversationSummary,
  GetAuthStatusParams,
  GetAuthStatusResponse,
  GetConversationSummaryParams,
  GetConversationSummaryResponse,
  GitDiffToRemoteParams,
  GitDiffToRemoteResponse,
  SessionSource,
} from "../generated/codex/ts/index.ts"
import { codexGeneratedZodSchemas } from "../generated/codex/zod/registry.gen.ts"
import { RequestIdSchema } from "../request-id.ts"

const generatedDefinitionSchema = <T>(name: string): z.ZodType<T> => {
  const schema = codexGeneratedZodSchemas[name]
  if (!schema) throw new TypeError(`Missing generated Codex schema definition: ${name}`)
  return schema as z.ZodType<T>
}

const ConversationSummarySchema: z.ZodType<ConversationSummary> = z.looseObject({
  cliVersion: z.string(),
  conversationId: z.string(),
  cwd: z.string(),
  gitInfo: z
    .looseObject({
      branch: z.string().nullable(),
      origin_url: z.string().nullable(),
      sha: z.string().nullable(),
    })
    .nullable(),
  modelProvider: z.string(),
  path: z.string(),
  preview: z.string(),
  source: generatedDefinitionSchema<SessionSource>("SessionSource"),
  timestamp: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

// Codex emits TypeScript for these deprecated v1 helpers but omits their JSON Schema definitions.
// Keep the generated TypeScript types as the compile-time contract for the small runtime fallback.
const legacyDefinitionSchemas = {
  GetAuthStatusParams: z.looseObject({
    includeToken: z.boolean().nullable(),
    refreshToken: z.boolean().nullable(),
  }) satisfies z.ZodType<GetAuthStatusParams>,
  GetAuthStatusResponse: z.looseObject({
    authMethod:
      generatedDefinitionSchema<GetAuthStatusResponse["authMethod"]>("AuthMode").nullable(),
    authToken: z.string().nullable(),
    requiresOpenaiAuth: z.boolean().nullable(),
  }) satisfies z.ZodType<GetAuthStatusResponse>,
  GetConversationSummaryParams: z.xor([
    z.looseObject({ rolloutPath: z.string() }),
    z.looseObject({ conversationId: z.string() }),
  ]) satisfies z.ZodType<GetConversationSummaryParams>,
  GetConversationSummaryResponse: z.looseObject({
    summary: ConversationSummarySchema,
  }) satisfies z.ZodType<GetConversationSummaryResponse>,
  GitDiffToRemoteParams: z.looseObject({
    cwd: z.string(),
  }) satisfies z.ZodType<GitDiffToRemoteParams>,
  GitDiffToRemoteResponse: z.looseObject({
    diff: z.string(),
    sha: z.string(),
  }) satisfies z.ZodType<GitDiffToRemoteResponse>,
} as const

export const codexGeneratedTypeSchema = <T>(name: string): z.ZodType<T> => {
  const legacySchema = legacyDefinitionSchemas[name as keyof typeof legacyDefinitionSchemas]
  if (legacySchema) return legacySchema as unknown as z.ZodType<T>
  return generatedDefinitionSchema<T>(name)
}

export const codexTopLevelParamsMessageSchema = <T>(
  type: string,
  paramsType: string | null
): z.ZodType<T> => {
  const paramsSchema = paramsType === null ? null : codexGeneratedTypeSchema(paramsType)
  return z
    .looseObject({
      requestId: RequestIdSchema,
      type: z.literal(type),
    })
    .refine((message) => z.json().safeParse(message).success, "Codex message must be JSON")
    .refine(
      (message) => {
        if (!paramsSchema) return true
        const { requestId: _requestId, type: _type, ...params } = message
        return paramsSchema.safeParse(params).success
      },
      `Invalid Codex ${paramsType ?? "empty"} params`
    ) as unknown as z.ZodType<T>
}

export const codexResponseMessageSchema = <T>(type: string, resultType: string): z.ZodType<T> => {
  const resultSchema = codexGeneratedTypeSchema(resultType)
  const payloadSchema = z.looseObject({ requestId: RequestIdSchema }).refine((payload) => {
    const { requestId: _requestId, ...result } = payload
    return resultSchema.safeParse(result).success
  }, `Invalid Codex ${resultType} result`)

  return z
    .looseObject({
      payload: payloadSchema,
      type: z.literal(type),
    })
    .refine(
      (message) => z.json().safeParse(message).success,
      "Codex message must be JSON"
    ) as unknown as z.ZodType<T>
}

export const codexNotificationMessageSchema = <T>(
  type: string,
  paramsType: string | null
): z.ZodType<T> =>
  z
    .looseObject(
      paramsType === null
        ? { type: z.literal(type) }
        : { payload: codexGeneratedTypeSchema(paramsType), type: z.literal(type) }
    )
    .refine(
      (message) => z.json().safeParse(message).success,
      "Codex message must be JSON"
    ) as unknown as z.ZodType<T>

export const codexMessageSchemaUnion = <T>(schemas: z.ZodType<T>[]): z.ZodType<T> => {
  if (schemas.length < 2) return schemas[0] as z.ZodType<T>
  return z.compile(z.union(schemas as [z.ZodType<T>, z.ZodType<T>, ...z.ZodType<T>[]]))
}
