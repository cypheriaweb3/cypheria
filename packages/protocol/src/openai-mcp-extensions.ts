import { z } from "zod"

/**
 * Host-side schemas of the OpenAI MCP Extensions specification
 * (https://github.com/openai/mcp-extensions/blob/main/docs/spec.md): the metadata MCP servers
 * declare and the requests MCP Apps send. Server validates server metadata with them, and Desktop
 * validates App requests. Entry point types follow what ChatGPT Desktop accepts, which adds the
 * `settings` type and global quick actions to the specification.
 */

const nonBlank = z.string().regex(/\S/u)
const json = z.record(z.string(), z.unknown())

/** An MCP `Icon`. */
export const OpenAIIconSchema = z
  .object({
    mimeType: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    src: z.string().min(1),
    theme: z.enum(["light", "dark"]).optional(),
  })
  .passthrough()
export type OpenAIIcon = z.infer<typeof OpenAIIconSchema>

export const OpenAIUiQuickActionSchema = z.object({
  icons: z.array(OpenAIIconSchema).min(1),
  target: z.object({
    arguments: json.optional(),
    name: nonBlank,
    type: z.literal("tool"),
  }),
  title: nonBlank,
})

export const OpenAIUiEntrypointSchema = z.discriminatedUnion("type", [
  z.object({ extensions: z.array(z.string().trim().startsWith(".")), type: z.literal("file") }),
  z.object({ quickAction: OpenAIUiQuickActionSchema.optional(), type: z.literal("global") }),
  z.object({
    searchTerms: z.array(z.string().trim().min(1)).optional(),
    type: z.literal("settings"),
  }),
  z.object({ type: z.literal("thread") }),
])
export type OpenAIUiEntrypoint = z.infer<typeof OpenAIUiEntrypointSchema>

export const OpenAIDisplayModeSchema = z.enum(["inline", "fullscreen"])
export type OpenAIDisplayMode = z.infer<typeof OpenAIDisplayModeSchema>

/** A tool's `_meta["openai/ui"]`. */
export const OpenAIUiToolMetadataSchema = z.object({
  entrypoints: z.array(OpenAIUiEntrypointSchema).optional(),
  preferredModelDisplayMode: OpenAIDisplayModeSchema.optional(),
})

/** A UI resource content item's `_meta["openai/ui"]`. `pip` is accepted and never offered. */
export const OpenAIUiResourceMetadataSchema = z.object({
  availableDisplayModes: z.array(z.enum(["inline", "fullscreen", "pip"])).optional(),
  preferredDisplayMode: z.enum(["inline", "fullscreen", "pip"]).optional(),
})

/** `capabilities.extensions["openai/settings"]`, or legacy `capabilities.experimental`. */
export const OpenAISettingsCapabilitySchema = z.object({
  readTool: nonBlank,
  updateTool: nonBlank,
})

/** `capabilities.extensions["openai/mentions"]`, as ChatGPT Desktop reads it. */
export const OpenAIMentionsCapabilitySchema = z.object({ searchTool: nonBlank })

const SettingBaseSchema = z.object({ description: z.string().optional(), title: z.string() })

export const OpenAISettingSchema = z.discriminatedUnion("type", [
  SettingBaseSchema.extend({ type: z.literal("boolean") }),
  SettingBaseSchema.extend({
    enum: z.array(z.string()).optional(),
    maxLength: z.int().nonnegative().optional(),
    minLength: z.int().nonnegative().optional(),
    pattern: z.string().optional(),
    type: z.literal("string"),
  }),
  SettingBaseSchema.extend({
    maximum: z.number().optional(),
    minimum: z.number().optional(),
    multipleOf: z.number().positive().optional(),
    type: z.enum(["number", "integer"]),
  }),
])
export type OpenAISetting = z.infer<typeof OpenAISettingSchema>

export const OpenAISettingsGroupSchema = z.object({
  items: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("property"), property: z.string() }),
      z.object({
        description: z.string().optional(),
        kind: z.literal("tool"),
        title: z.string(),
        tool: nonBlank,
      }),
    ])
  ),
  kind: z.literal("group"),
  title: z.string(),
})
export type OpenAISettingsGroup = z.infer<typeof OpenAISettingsGroupSchema>

export const OpenAISettingValueSchema = z.union([z.string(), z.number(), z.boolean()])

/** The read tool's `structuredContent`. Every schema property needs a value. */
export const OpenAISettingsReadResultSchema = z
  .object({
    layout: z.array(OpenAISettingsGroupSchema).optional(),
    schema: z.object({
      properties: z.record(z.string(), OpenAISettingSchema),
      required: z.array(z.string()).optional(),
      type: z.literal("object"),
    }),
    values: z.record(z.string(), z.unknown()),
  })
  .superRefine((result, context) => {
    for (const property of Object.keys(result.schema.properties)) {
      if (!Object.hasOwn(result.values, property)) {
        context.addIssue({ code: "custom", message: `No value for ${property}`, path: ["values"] })
      }
    }
  })
export type OpenAISettingsReadResult = z.infer<typeof OpenAISettingsReadResultSchema>

export const OpenAISettingsUpdateArgumentsSchema = z.object({
  set: z.record(z.string(), OpenAISettingValueSchema),
})

/** `ui/message` `_meta["openai/message"]`. Defaults to `{ target: "active", send: true }`. */
export const OpenAIMessageOptionsSchema = z
  .object({ send: z.literal(true).optional(), target: z.enum(["active", "new"]).optional() })
  .strict()

/** `hostContext["openai/deepLink"]`. */
export const OpenAIDeepLinkHostStateSchema = z.object({ url: z.string() })

/** `openai/files/open` params. */
export const OpenAIFileOpenParamsSchema = z.object({ path: z.string().min(1) })

/** `resources/read` `_meta["openai/resource"]`. */
export const OpenAIResourceReadMetadataSchema = z.object({
  representation: z.enum(["text", "blob"]).optional(),
})

/** `openai/resources/write` params. */
export const OpenAIResourceWriteParamsSchema = z.union([
  z.object({ ifMatch: nonBlank.optional(), text: z.string(), uri: nonBlank }),
  z.object({ blob: z.string(), ifMatch: nonBlank.optional(), uri: nonBlank }),
])
export type OpenAIResourceWriteParams = z.infer<typeof OpenAIResourceWriteParamsSchema>

export const OpenAIResourceWriteResultSchema = z.discriminatedUnion("outcome", [
  z.object({ etag: z.string(), outcome: z.literal("saved") }),
  z.object({ etag: z.string(), outcome: z.literal("conflict") }),
  z.object({ maxBytes: z.int().nonnegative(), outcome: z.literal("too-large") }),
])
export type OpenAIResourceWriteResult = z.infer<typeof OpenAIResourceWriteResultSchema>

/** A mention search tool's arguments and `structuredContent`. */
export const OpenAIMentionSearchResultSchema = z.object({
  items: z.array(
    z
      .object({
        description: z.string().optional(),
        mimeType: z.string().optional(),
        name: z.string(),
        title: z.string().optional(),
        type: z.literal("resource_link"),
        uri: z.string().min(1),
      })
      .passthrough()
  ),
})

/** The MCP extension IDs Cypheria's Codex adapter declares at `initialize`. */
export const MCP_APP_UI_EXTENSION_ID = "io.modelcontextprotocol/ui"
export const OPENAI_ELICITATION_EXTENSION_ID = "openai/elicitation"
/** The MCP App MIME type. */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
