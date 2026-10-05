import { z } from "zod"

import { AgentIdSchema } from "./agent/registry.ts"
import { RequestIdSchema } from "./request-id.ts"

/**
 * Plugin Extensions: the surfaces plugins' MCP servers contribute through MCP Apps and the OpenAI
 * MCP Extensions specification. Agents run the MCP servers; the Server builds the catalog from what
 * they report, keeps App instances and model context, and routes each App request to an Agent.
 * See docs/agents/plugin-extensions.md.
 */

const json = z.record(z.string(), z.unknown())
const id = z.string().trim().min(1).max(4096)
const threadId = z.string().trim().min(1)

/** An icon the Server accepted: a `data:` or `https:` image. */
export const ExtensionIconSchema = z
  .object({
    mimeType: z.string().nullable(),
    src: z.string().min(1),
    theme: z.enum(["light", "dark"]).nullable(),
  })
  .strict()
export type ExtensionIcon = z.infer<typeof ExtensionIconSchema>

/** Where a surface's MCP calls run: an Agent, or the Server for bundled plugins. */
const ExtensionSourceSchema = z.object({
  /** The Agent serving the surface; `null` when the Server answers a bundled plugin. */
  agentId: AgentIdSchema.nullable(),
  /** `<plugin>@<marketplace>`, or `null` for a server outside a plugin. */
  pluginId: z.string().nullable(),
  server: z.string().min(1),
})

export const ExtensionEntrypointTypeSchema = z.enum(["global", "thread", "file", "settings"])
export type ExtensionEntrypointType = z.infer<typeof ExtensionEntrypointTypeSchema>

export const ExtensionEntrypointSchema = ExtensionSourceSchema.extend({
  /** File extensions a `file` entry point opens, lowercase and without the dot. */
  extensions: z.array(z.string()),
  icon: ExtensionIconSchema.nullable(),
  id,
  quickAction: z
    .object({
      arguments: json,
      icon: ExtensionIconSchema.nullable(),
      title: z.string(),
      tool: z.string().min(1),
    })
    .strict()
    .nullable(),
  resourceUri: z.string().min(1),
  searchTerms: z.array(z.string()),
  title: z.string().min(1),
  tool: z.string().min(1),
  type: ExtensionEntrypointTypeSchema,
}).strict()
export type ExtensionEntrypoint = z.infer<typeof ExtensionEntrypointSchema>

export const ExtensionSettingsProviderSchema = ExtensionSourceSchema.extend({
  icon: ExtensionIconSchema.nullable(),
  id,
  readTool: z.string().min(1),
  title: z.string().min(1),
  updateTool: z.string().min(1),
}).strict()
export type ExtensionSettingsProvider = z.infer<typeof ExtensionSettingsProviderSchema>

export const ExtensionMentionProviderSchema = ExtensionSourceSchema.extend({
  icon: ExtensionIconSchema.nullable(),
  id,
  title: z.string().min(1),
  tool: z.string().min(1),
}).strict()
export type ExtensionMentionProvider = z.infer<typeof ExtensionMentionProviderSchema>

/** Something the Server dropped from the catalog, and why. */
export const ExtensionDiagnosticSchema = z
  .object({
    agentId: AgentIdSchema.nullable(),
    message: z.string(),
    pluginId: z.string().nullable(),
    reason: z.string(),
    server: z.string(),
    tool: z.string().nullable(),
  })
  .strict()
export type ExtensionDiagnostic = z.infer<typeof ExtensionDiagnosticSchema>

export const ExtensionCatalogSchema = z
  .object({
    diagnostics: z.array(ExtensionDiagnosticSchema),
    entrypoints: z.array(ExtensionEntrypointSchema),
    mentions: z.array(ExtensionMentionProviderSchema),
    revision: z.int().nonnegative(),
    settings: z.array(ExtensionSettingsProviderSchema),
  })
  .strict()
export type ExtensionCatalog = z.infer<typeof ExtensionCatalogSchema>

/** An MCP `CallToolResult`. */
export const ExtensionToolResultSchema = z
  .object({
    _meta: json.optional(),
    content: z.array(z.unknown()),
    isError: z.boolean().optional(),
    structuredContent: json.optional(),
  })
  .passthrough()
export type ExtensionToolResult = z.infer<typeof ExtensionToolResultSchema>

export const ExtensionDisplayModeSchema = z.enum(["inline", "fullscreen"])
export type ExtensionDisplayMode = z.infer<typeof ExtensionDisplayModeSchema>

/** What an App instance renders. */
export const ExtensionAppTargetSchema = z.discriminatedUnion("kind", [
  /** A catalog entry point; `file` entries need a Thread and a workspace path. */
  z
    .object({
      deepLink: z.string().startsWith("/").optional(),
      entrypointId: id,
      kind: z.literal("entrypoint"),
      path: z.string().min(1).optional(),
      threadId: threadId.optional(),
    })
    .strict(),
  /** The App of a model tool call in a Thread's Timeline. */
  z.object({ itemId: z.string().min(1), kind: z.literal("tool-call"), threadId }).strict(),
  /**
   * A tool's App outside the catalog: a settings layout's App tool, or a bundled plugin's App
   * such as Code Review. The server must be in the catalog or bundled.
   */
  z
    .object({
      arguments: json.optional(),
      kind: z.literal("tool"),
      server: z.string().min(1),
      threadId: threadId.optional(),
      tool: z.string().min(1),
    })
    .strict(),
])
export type ExtensionAppTarget = z.infer<typeof ExtensionAppTargetSchema>

/** The requests an instance's App may make beyond its own server's tools. */
export const ExtensionAppCapabilitiesSchema = z
  .object({
    /** Prefixes of Cypheria host request methods the App may send; bundled plugins only. */
    host: z.array(z.string()),
    /** `ui/message` and `ui/update-model-context`; they need a Thread or a global page. */
    message: z.boolean(),
    modelContext: z.boolean(),
    /** `openai/files/open`. */
    openFiles: z.boolean(),
    /** Host-handled `resources/*` and `openai/resources/write` on the instance's file. */
    resource: z.boolean(),
    /** Reads of the server's own resources. */
    serverResources: z.boolean(),
    /** Calls to the server's own tools. */
    toolCalls: z.boolean(),
  })
  .strict()
export type ExtensionAppCapabilities = z.infer<typeof ExtensionAppCapabilitiesSchema>

export const ExtensionAppInstanceSchema = ExtensionSourceSchema.extend({
  availableDisplayModes: z.array(ExtensionDisplayModeSchema),
  capabilities: ExtensionAppCapabilitiesSchema,
  displayMode: ExtensionDisplayModeSchema,
  /** OpenAI host context entries, such as `openai/deepLink` and `openai/modelContext`. */
  hostContext: json,
  id,
  /** The UI resource's `_meta`, including `ui.csp` and `ui.permissions`. */
  resourceMeta: json,
  resourceUri: z.string().min(1),
  threadId: threadId.nullable(),
  title: z.string(),
  tool: z.string().min(1),
  toolInput: json,
  /** The result of the call that opened the instance; `null` while it runs or after it fails. */
  toolResult: ExtensionToolResultSchema.nullable(),
  /** Why the opening call failed. */
  toolError: z.string().nullable(),
}).strict()
export type ExtensionAppInstance = z.infer<typeof ExtensionAppInstanceSchema>

/** A content block an App attached to a Thread's next message with `ui/update-model-context`. */
export const ExtensionModelContextSchema = z
  .object({
    content: z.array(z.unknown()),
    /** The App that attached it: an entry point or tool call in this Thread. */
    key: id,
    pluginId: z.string().nullable(),
    server: z.string(),
    structuredContent: json.nullable(),
    title: z.string(),
    updateId: z.string().min(1),
  })
  .strict()
export type ExtensionModelContext = z.infer<typeof ExtensionModelContextSchema>

export const ExtensionMentionItemSchema = z
  .object({
    description: z.string().nullable(),
    mimeType: z.string().nullable(),
    name: z.string(),
    title: z.string().nullable(),
    uri: z.string().min(1),
  })
  .strict()
export type ExtensionMentionItem = z.infer<typeof ExtensionMentionItemSchema>

/** A form or URL request raised by a call from an App, settings, or a mention search. */
export const ExtensionElicitationSchema = z
  .object({
    id,
    instanceId: id.nullable(),
    message: z.string(),
    mode: z.enum(["form", "url"]),
    /** Whether OpenAI's extended form fields may appear (`openai/elicitation/create`). */
    openai: z.boolean(),
    requestedSchema: json.nullable(),
    server: z.string(),
    url: z.string().nullable(),
  })
  .strict()
export type ExtensionElicitation = z.infer<typeof ExtensionElicitationSchema>

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
            error: z
              .object({
                code: z.string(),
                message: z.string(),
                kind: z.string().optional(),
                retryAt: z.number().optional(),
              })
              .strict(),
          })
          .strict(),
      ]),
    })
    .strict()
const notification = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ type: z.literal(type), payload }).strict()

export const ExtensionCatalogGetRequestSchema = request(
  "extension.catalog.get.request",
  z.object({ refresh: z.boolean().optional() }).strict()
)
export const ExtensionAppOpenRequestSchema = request(
  "extension.app.open.request",
  z.object({ target: ExtensionAppTargetSchema }).strict()
)
export const ExtensionAppResourceReadRequestSchema = request(
  "extension.app.resource.read.request",
  z.object({ instanceId: id, offset: z.int().nonnegative().optional() }).strict()
)
export const ExtensionAppRequestRequestSchema = request(
  "extension.app.request.request",
  z.object({ instanceId: id, method: z.string().min(1).max(256), params: json.optional() }).strict()
)
/**
 * Moves a plugin's global page App to another chat, or to none before a new one, without
 * reopening it. Its attached context comes along.
 */
export const ExtensionAppBindRequestSchema = request(
  "extension.app.bind.request",
  z.object({ instanceId: id, threadId: threadId.nullable() }).strict()
)
export const ExtensionAppCloseRequestSchema = request(
  "extension.app.close.request",
  z.object({ instanceId: id }).strict()
)
export const ExtensionContextListRequestSchema = request(
  "extension.context.list.request",
  z.object({ threadId }).strict()
)
export const ExtensionContextRemoveRequestSchema = request(
  "extension.context.remove.request",
  z.object({ index: z.int().nonnegative().optional(), key: id, threadId }).strict()
)
export const ExtensionSettingsReadRequestSchema = request(
  "extension.settings.read.request",
  z.object({ providerId: id }).strict()
)
export const ExtensionSettingsUpdateRequestSchema = request(
  "extension.settings.update.request",
  z
    .object({
      providerId: id,
      set: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    })
    .strict()
)
export const ExtensionSettingsToolRequestSchema = request(
  "extension.settings.tool.request",
  z.object({ providerId: id, tool: z.string().min(1) }).strict()
)
export const ExtensionMentionsSearchRequestSchema = request(
  "extension.mentions.search.request",
  z
    .object({
      agentId: AgentIdSchema.optional(),
      providerIds: z.array(id).optional(),
      query: z.string().max(512),
    })
    .strict()
)
export const ExtensionElicitationRespondRequestSchema = request(
  "extension.elicitation.respond.request",
  z
    .object({
      action: z.enum(["accept", "decline", "cancel"]),
      content: json.optional(),
      elicitationId: id,
    })
    .strict()
)

export const ExtensionCatalogGetResponseSchema = response(
  "extension.catalog.get.response",
  ExtensionCatalogSchema
)
export const ExtensionAppOpenResponseSchema = response(
  "extension.app.open.response",
  z.object({ instance: ExtensionAppInstanceSchema }).strict()
)
/** App HTML arrives in pieces so a relay message limit cannot truncate it. */
export const ExtensionAppResourceReadResponseSchema = response(
  "extension.app.resource.read.response",
  z
    .object({
      mimeType: z.string().nullable(),
      nextOffset: z.int().nonnegative().nullable(),
      text: z.string(),
    })
    .strict()
)
export const ExtensionAppRequestResponseSchema = response(
  "extension.app.request.response",
  z.object({ result: z.unknown() }).strict()
)
export const ExtensionAppBindResponseSchema = response(
  "extension.app.bind.response",
  z.object({ instance: ExtensionAppInstanceSchema }).strict()
)
export const ExtensionAppCloseResponseSchema = response(
  "extension.app.close.response",
  z.object({}).strict()
)
export const ExtensionContextListResponseSchema = response(
  "extension.context.list.response",
  z.object({ entries: z.array(ExtensionModelContextSchema) }).strict()
)
export const ExtensionContextRemoveResponseSchema = response(
  "extension.context.remove.response",
  z.object({}).strict()
)
export const ExtensionSettingsReadResponseSchema = response(
  "extension.settings.read.response",
  z.object({ layout: z.array(json), schema: json, values: json }).strict()
)
export const ExtensionSettingsUpdateResponseSchema = response(
  "extension.settings.update.response",
  z.object({ values: json }).strict()
)
export const ExtensionSettingsToolResponseSchema = response(
  "extension.settings.tool.response",
  z.object({ isError: z.boolean(), text: z.string() }).strict()
)
export const ExtensionMentionsSearchResponseSchema = response(
  "extension.mentions.search.response",
  z
    .object({
      groups: z.array(
        z
          .object({
            error: z.string().nullable(),
            items: z.array(ExtensionMentionItemSchema),
            providerId: id,
          })
          .strict()
      ),
    })
    .strict()
)
export const ExtensionElicitationRespondResponseSchema = response(
  "extension.elicitation.respond.response",
  z.object({}).strict()
)

export const ExtensionCatalogUpdatedNotificationSchema = notification(
  "extension.catalog.updated.notification",
  z.object({ revision: z.int().nonnegative() }).strict()
)
/** An MCP notification or host context change for an instance the client has open. */
export const ExtensionAppNotificationSchema = notification(
  "extension.app.notification",
  z.object({ instanceId: id, method: z.string().min(1), params: json }).strict()
)
export const ExtensionContextUpdatedNotificationSchema = notification(
  "extension.context.updated.notification",
  z.object({ threadId }).strict()
)
export const ExtensionElicitationNotificationSchema = notification(
  "extension.elicitation.notification",
  ExtensionElicitationSchema
)

export const EXTENSION_CLIENT_SCHEMAS = [
  ExtensionCatalogGetRequestSchema,
  ExtensionAppOpenRequestSchema,
  ExtensionAppResourceReadRequestSchema,
  ExtensionAppRequestRequestSchema,
  ExtensionAppBindRequestSchema,
  ExtensionAppCloseRequestSchema,
  ExtensionContextListRequestSchema,
  ExtensionContextRemoveRequestSchema,
  ExtensionSettingsReadRequestSchema,
  ExtensionSettingsUpdateRequestSchema,
  ExtensionSettingsToolRequestSchema,
  ExtensionMentionsSearchRequestSchema,
  ExtensionElicitationRespondRequestSchema,
] as const

const EXTENSION_RESPONSE_SCHEMAS = [
  ExtensionCatalogGetResponseSchema,
  ExtensionAppOpenResponseSchema,
  ExtensionAppResourceReadResponseSchema,
  ExtensionAppRequestResponseSchema,
  ExtensionAppBindResponseSchema,
  ExtensionAppCloseResponseSchema,
  ExtensionContextListResponseSchema,
  ExtensionContextRemoveResponseSchema,
  ExtensionSettingsReadResponseSchema,
  ExtensionSettingsUpdateResponseSchema,
  ExtensionSettingsToolResponseSchema,
  ExtensionMentionsSearchResponseSchema,
  ExtensionElicitationRespondResponseSchema,
] as const

export const EXTENSION_SERVER_SCHEMAS = [
  ...EXTENSION_RESPONSE_SCHEMAS,
  ExtensionCatalogUpdatedNotificationSchema,
  ExtensionAppNotificationSchema,
  ExtensionContextUpdatedNotificationSchema,
  ExtensionElicitationNotificationSchema,
] as const

export const EXTENSION_RESPONSE_TYPES = EXTENSION_RESPONSE_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type ExtensionClientMessage = z.infer<(typeof EXTENSION_CLIENT_SCHEMAS)[number]>
export type ExtensionServerMessage = z.infer<(typeof EXTENSION_SERVER_SCHEMAS)[number]>
export type ExtensionResponseMessage = z.infer<(typeof EXTENSION_RESPONSE_SCHEMAS)[number]>
