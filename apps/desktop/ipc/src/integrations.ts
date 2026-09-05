import { z } from "zod"

export const IntegrationListRequestSchema = z
  .object({ forceRefetch: z.boolean().optional() })
  .strict()
export const IntegrationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine(
    (value) => !["_default", "__proto__", "prototype", "constructor"].includes(value),
    "Reserved integration identifier."
  )
export const AppIdRequestSchema = z.object({ appId: IntegrationIdSchema }).strict()
export const AppEnabledRequestSchema = AppIdRequestSchema.extend({ enabled: z.boolean() }).strict()
export const McpNameRequestSchema = z.object({ name: z.string().min(1).max(256) }).strict()
export const McpAddRequestSchema = z
  .object({
    name: IntegrationIdSchema,
    url: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value)
          return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
        } catch {
          return false
        }
      }, "Use an HTTP or HTTPS URL without embedded credentials."),
  })
  .strict()
export const McpEnabledRequestSchema = z
  .object({ name: IntegrationIdSchema, enabled: z.boolean() })
  .strict()

export const CodexAppViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    logoUrl: z.string().nullable(),
    installUrl: z.string().nullable(),
    accessible: z.boolean(),
    enabled: z.boolean(),
    callable: z.boolean().nullable(),
    effectiveEnabled: z.boolean().nullable(),
    pluginNames: z.array(z.string()),
  })
  .strict()
export type CodexAppView = z.infer<typeof CodexAppViewSchema>
export const CodexAppListResultSchema = z
  .object({ apps: z.array(CodexAppViewSchema), runtimeError: z.string().nullable() })
  .strict()
export type CodexAppListResult = z.infer<typeof CodexAppListResultSchema>

export const CodexMcpViewSchema = z
  .object({
    name: z.string(),
    pluginId: z.string().nullable(),
    enabled: z.boolean().nullable(),
    configurable: z.boolean(),
    authStatus: z.enum(["unknown", "unsupported", "notLoggedIn", "bearerToken", "oAuth"]),
    runtimeStatus: z
      .enum([
        "notStarted",
        "starting",
        "connected",
        "authenticationRequired",
        "failed",
        "cancelled",
        "disabled",
      ])
      .nullable(),
    tools: z.array(z.object({ name: z.string(), description: z.string().nullable() }).strict()),
    resourceCount: z.number().int().nonnegative(),
  })
  .strict()
export type CodexMcpView = z.infer<typeof CodexMcpViewSchema>
export const CodexMcpListResultSchema = z.object({ servers: z.array(CodexMcpViewSchema) }).strict()
export type CodexMcpListResult = z.infer<typeof CodexMcpListResultSchema>
