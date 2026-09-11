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

const ConversationSummarySchema: z.ZodType<ConversationSummary> = z.object({
  cliVersion: z.string(),
  conversationId: z.string(),
  cwd: z.string(),
  gitInfo: z
    .object({
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
  GetAuthStatusParams: z.object({
    includeToken: z.boolean().nullable(),
    refreshToken: z.boolean().nullable(),
  }) satisfies z.ZodType<GetAuthStatusParams>,
  GetAuthStatusResponse: z.object({
    authMethod:
      generatedDefinitionSchema<GetAuthStatusResponse["authMethod"]>("AuthMode").nullable(),
    authToken: z.string().nullable(),
    requiresOpenaiAuth: z.boolean().nullable(),
  }) satisfies z.ZodType<GetAuthStatusResponse>,
  GetConversationSummaryParams: z.xor([
    z.object({ rolloutPath: z.string() }),
    z.object({ conversationId: z.string() }),
  ]) satisfies z.ZodType<GetConversationSummaryParams>,
  GetConversationSummaryResponse: z.object({
    summary: ConversationSummarySchema,
  }) satisfies z.ZodType<GetConversationSummaryResponse>,
  GitDiffToRemoteParams: z.object({ cwd: z.string() }) satisfies z.ZodType<GitDiffToRemoteParams>,
  GitDiffToRemoteResponse: z.object({
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
  const envelopeSchema = z.object({
    requestId: RequestIdSchema,
    type: z.literal(type),
  })
  const messageSchema =
    paramsType === null
      ? envelopeSchema
      : z.intersection(envelopeSchema, codexGeneratedTypeSchema(paramsType))
  return z.intersection(messageSchema, z.json()) as unknown as z.ZodType<T>
}

export const codexResponseMessageSchema = <T>(type: string, resultType: string): z.ZodType<T> =>
  z.intersection(
    z.object({
      payload: z.intersection(
        z.object({ requestId: RequestIdSchema }),
        codexGeneratedTypeSchema(resultType)
      ),
      type: z.literal(type),
    }),
    z.json()
  ) as unknown as z.ZodType<T>

export const codexNotificationMessageSchema = <T>(
  type: string,
  paramsType: string | null
): z.ZodType<T> =>
  z.intersection(
    paramsType === null
      ? z.object({ type: z.literal(type) })
      : z.object({ payload: codexGeneratedTypeSchema(paramsType), type: z.literal(type) }),
    z.json()
  ) as unknown as z.ZodType<T>

export const codexMessageSchemaUnion = <T>(schemas: z.ZodType<T>[]): z.ZodType<T> => {
  if (schemas.length < 2) return schemas[0] as z.ZodType<T>
  return z.union(schemas as [z.ZodType<T>, z.ZodType<T>, ...z.ZodType<T>[]])
}
