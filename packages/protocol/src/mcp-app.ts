import { z } from "zod"

import { RequestIdSchema } from "./request-id.ts"

/**
 * MCP Apps: an MCP server's `ui://` HTML resource that a client renders in a sandboxed frame. The
 * client reads the resource and calls the server's tools through the Server, which answers bundled
 * Cypheria servers itself and reaches other servers through the Codex App Server.
 */

const server = z.string().trim().min(1).max(256)
const json = z.record(z.string(), z.unknown())

export const McpAppToolSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.unknown(),
    annotations: json.optional(),
    _meta: json.optional(),
  })
  .strict()
export type McpAppTool = z.infer<typeof McpAppToolSchema>

export const McpAppResourceContentSchema = z
  .object({
    uri: z.string().min(1),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
    _meta: json.optional(),
  })
  .strict()
export type McpAppResourceContent = z.infer<typeof McpAppResourceContentSchema>

export const McpAppToolResultSchema = z
  .object({
    content: z.array(z.unknown()),
    structuredContent: json.optional(),
    isError: z.boolean(),
    _meta: json.optional(),
  })
  .strict()
export type McpAppToolResult = z.infer<typeof McpAppToolResultSchema>

const request = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ type: z.literal(type), requestId: RequestIdSchema, payload }).strict()
const response = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z
    .object({
      type: z.literal(type),
      requestId: RequestIdSchema,
      payload: z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value }).strict(),
        z
          .object({
            ok: z.literal(false),
            error: z.object({ code: z.string(), message: z.string() }).strict(),
          })
          .strict(),
      ]),
    })
    .strict()

const threadId = z.string().trim().min(1).optional()

export const McpAppToolsListRequestSchema = request(
  "mcpApp.tools.list.request",
  z.object({ server, threadId }).strict()
)
export const McpAppResourceReadRequestSchema = request(
  "mcpApp.resource.read.request",
  z.object({ server, uri: z.string().min(1).max(2048), threadId }).strict()
)
export const McpAppToolCallRequestSchema = request(
  "mcpApp.tool.call.request",
  z
    .object({
      server,
      name: z.string().min(1).max(256),
      arguments: z.unknown().optional(),
      threadId,
      _meta: json.optional(),
    })
    .strict()
)

export const McpAppToolsListResponseSchema = response(
  "mcpApp.tools.list.response",
  z.object({ tools: z.array(McpAppToolSchema) }).strict()
)
export const McpAppResourceReadResponseSchema = response(
  "mcpApp.resource.read.response",
  z.object({ contents: z.array(McpAppResourceContentSchema) }).strict()
)
export const McpAppToolCallResponseSchema = response(
  "mcpApp.tool.call.response",
  McpAppToolResultSchema
)

export const MCP_APP_CLIENT_SCHEMAS = [
  McpAppToolsListRequestSchema,
  McpAppResourceReadRequestSchema,
  McpAppToolCallRequestSchema,
] as const

export const MCP_APP_SERVER_SCHEMAS = [
  McpAppToolsListResponseSchema,
  McpAppResourceReadResponseSchema,
  McpAppToolCallResponseSchema,
] as const

export const MCP_APP_RESPONSE_TYPES = MCP_APP_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type McpAppClientMessage = z.infer<(typeof MCP_APP_CLIENT_SCHEMAS)[number]>
export type McpAppServerMessage = z.infer<(typeof MCP_APP_SERVER_SCHEMAS)[number]>
