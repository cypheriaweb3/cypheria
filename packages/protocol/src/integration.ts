import { z } from "zod"

import { AgentCompatibilityTagSchema, AgentIdSchema } from "./agent/registry.ts"
import { RequestIdSchema } from "./request-id.ts"

export const IntegrationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine(
    (value) => !["_default", "__proto__", "prototype", "constructor"].includes(value),
    "Reserved integration identifier"
  )

export const IntegrationEcosystemSchema = z.enum(["cypheria", "openai", "claude", "pi", "opencode"])
export type IntegrationEcosystem = z.infer<typeof IntegrationEcosystemSchema>

export const MarketplaceSourceKindSchema = z.enum([
  "cypheria",
  "openai",
  "claude",
  "pi",
  "opencode",
  "custom",
])
export type MarketplaceSourceKind = z.infer<typeof MarketplaceSourceKindSchema>

const compatibility = z.array(AgentCompatibilityTagSchema).min(1)
const provider = z.object({ agentId: AgentIdSchema, nativeId: z.string().nullable() }).strict()

export const SkillViewSchema = z
  .object({
    brandColor: z.string().nullable(),
    compatibility,
    cwd: z.string(),
    dependencyCount: z.number().int().nonnegative(),
    description: z.string(),
    displayName: z.string(),
    enabled: z.boolean(),
    iconUrl: z.string().nullable(),
    name: z.string().min(1),
    path: z.string().min(1),
    pluginId: z.string().nullable(),
    provider,
    scope: z.enum(["user", "repo", "system", "admin"]),
  })
  .strict()
export type SkillView = z.infer<typeof SkillViewSchema>

export const McpServerViewSchema = z
  .object({
    authStatus: z.enum(["unknown", "unsupported", "notLoggedIn", "bearerToken", "oAuth"]),
    compatibility,
    configurable: z.boolean(),
    enabled: z.boolean().nullable(),
    name: z.string().min(1),
    pluginId: z.string().nullable(),
    provider,
    resourceCount: z.number().int().nonnegative(),
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
    tools: z.array(z.object({ description: z.string().nullable(), name: z.string() }).strict()),
  })
  .strict()
export type McpServerView = z.infer<typeof McpServerViewSchema>

export const PluginViewSchema = z
  .object({
    availability: z.enum(["AVAILABLE", "DISABLED_BY_ADMIN"]),
    brandColor: z.string().nullable(),
    capabilities: z.array(z.string()),
    category: z.string().nullable(),
    compatibility,
    description: z.string().nullable(),
    developerName: z.string().nullable(),
    displayName: z.string(),
    ecosystem: IntegrationEcosystemSchema,
    enabled: z.boolean(),
    featured: z.boolean(),
    id: z.string().min(1),
    installed: z.boolean(),
    installPolicy: z.enum(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]),
    logoUrl: z.string().nullable(),
    marketplaceName: z.string().min(1),
    marketplacePath: z.string().nullable(),
    name: z.string().min(1),
    provider,
    sourceType: z.enum(["local", "git", "npm", "remote"]),
    version: z.string().nullable(),
  })
  .strict()
export type PluginView = z.infer<typeof PluginViewSchema>

export const MarketplaceViewSchema = z
  .object({
    displayName: z.string().min(1),
    name: z.string().min(1),
    path: z.string().nullable(),
    plugins: z.array(PluginViewSchema),
    sourceKind: MarketplaceSourceKindSchema,
  })
  .strict()
export type MarketplaceView = z.infer<typeof MarketplaceViewSchema>

export const PluginDetailViewSchema = z
  .object({
    apps: z.array(
      z
        .object({
          category: z.string().nullable(),
          description: z.string().nullable(),
          id: z.string(),
          installUrl: z.string().nullable(),
          name: z.string(),
        })
        .strict()
    ),
    description: z.string().nullable(),
    mcpServers: z.array(z.string()),
    privacyPolicyUrl: z.string().nullable(),
    prompts: z.array(z.string()),
    shareUrl: z.string().nullable(),
    skills: z.array(
      z
        .object({
          description: z.string(),
          enabled: z.boolean(),
          name: z.string(),
          path: z.string().nullable(),
        })
        .strict()
    ),
    termsOfServiceUrl: z.string().nullable(),
    websiteUrl: z.string().nullable(),
  })
  .strict()
export type PluginDetailView = z.infer<typeof PluginDetailViewSchema>

export const CodexAppViewSchema = z
  .object({
    accessible: z.boolean(),
    callable: z.boolean().nullable(),
    description: z.string().nullable(),
    effectiveEnabled: z.boolean().nullable(),
    enabled: z.boolean(),
    id: z.string(),
    installUrl: z.string().nullable(),
    logoUrl: z.string().nullable(),
    name: z.string(),
    pluginNames: z.array(z.string()),
  })
  .strict()
export type CodexAppView = z.infer<typeof CodexAppViewSchema>

const request = <const T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) })
const error = z.object({ code: z.string(), message: z.string() }).strict()
const result = <S extends z.ZodType>(value: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ error, ok: z.literal(false) }).strict(),
  ])
const response = <const T extends string, S extends z.ZodType>(type: T, value: S) =>
  z.object({ payload: result(value), requestId: RequestIdSchema, type: z.literal(type) })

const agentListInput = z
  .object({ agentId: AgentIdSchema, forceRefresh: z.boolean().optional() })
  .strict()
const providerItem = z.object({ agentId: AgentIdSchema, id: z.string().min(1) }).strict()
const setEnabled = providerItem.extend({ enabled: z.boolean() }).strict()
const pluginLocator = z
  .object({
    agentId: AgentIdSchema,
    marketplaceName: z.string().min(1),
    marketplacePath: z.string().nullable(),
    pluginName: z.string().min(1),
  })
  .strict()

export const SkillListRequestSchema = request(
  "integration.skill.list.request",
  agentListInput.extend({ cwd: z.string().min(1).optional() }).strict()
)
export const SkillSetEnabledRequestSchema = request(
  "integration.skill.set-enabled.request",
  setEnabled
)
export const McpListRequestSchema = request("integration.mcp.list.request", agentListInput)
export const McpAddRequestSchema = request(
  "integration.mcp.add.request",
  z.object({ agentId: AgentIdSchema, name: IntegrationIdSchema, url: z.string().url() }).strict()
)
export const McpSetEnabledRequestSchema = request("integration.mcp.set-enabled.request", setEnabled)
export const McpLoginRequestSchema = request("integration.mcp.login.request", providerItem)
export const PluginListRequestSchema = request(
  "integration.plugin.list.request",
  agentListInput.extend({ cwd: z.string().min(1).optional() }).strict()
)
export const PluginReadRequestSchema = request("integration.plugin.read.request", pluginLocator)
export const PluginInstallRequestSchema = request(
  "integration.plugin.install.request",
  pluginLocator
)
export const PluginUninstallRequestSchema = request(
  "integration.plugin.uninstall.request",
  providerItem
)
export const PluginSetEnabledRequestSchema = request(
  "integration.plugin.set-enabled.request",
  setEnabled
)
export const MarketplaceAddRequestSchema = request(
  "integration.marketplace.add.request",
  z
    .object({
      agentId: AgentIdSchema,
      refName: z.string().min(1).optional(),
      source: z.string().min(1),
      sparsePaths: z.array(z.string().min(1)).optional(),
    })
    .strict()
)
export const MarketplaceUpgradeRequestSchema = request(
  "integration.marketplace.upgrade.request",
  z.object({ agentId: AgentIdSchema, marketplaceName: z.string().min(1).optional() }).strict()
)
export const MarketplaceRemoveRequestSchema = request(
  "integration.marketplace.remove.request",
  z.object({ agentId: AgentIdSchema, marketplaceName: z.string().min(1) }).strict()
)
export const CodexAppListRequestSchema = request(
  "integration.codex.app.list.request",
  z.object({ forceRefresh: z.boolean().optional() }).strict()
)
export const CodexAppSetEnabledRequestSchema = request(
  "integration.codex.app.set-enabled.request",
  z.object({ appId: IntegrationIdSchema, enabled: z.boolean() }).strict()
)
export const CodexAppConnectRequestSchema = request(
  "integration.codex.app.connect.request",
  z.object({ appId: IntegrationIdSchema }).strict()
)

const mutation = z.object({ succeeded: z.literal(true) }).strict()
export const SkillListResponseSchema = response(
  "integration.skill.list.response",
  z
    .object({
      errors: z.array(z.object({ message: z.string(), path: z.string().nullable() }).strict()),
      skills: z.array(SkillViewSchema),
    })
    .strict()
)
export const SkillSetEnabledResponseSchema = response(
  "integration.skill.set-enabled.response",
  mutation
)
export const McpListResponseSchema = response(
  "integration.mcp.list.response",
  z.object({ servers: z.array(McpServerViewSchema) }).strict()
)
export const McpAddResponseSchema = response("integration.mcp.add.response", mutation)
export const McpSetEnabledResponseSchema = response(
  "integration.mcp.set-enabled.response",
  mutation
)
export const McpLoginResponseSchema = response(
  "integration.mcp.login.response",
  z.object({ authorizationUrl: z.string().url() }).strict()
)
export const PluginListResponseSchema = response(
  "integration.plugin.list.response",
  z
    .object({
      errors: z.array(z.object({ message: z.string(), path: z.string() }).strict()),
      marketplaces: z.array(MarketplaceViewSchema),
    })
    .strict()
)
export const PluginReadResponseSchema = response(
  "integration.plugin.read.response",
  PluginDetailViewSchema
)
export const PluginInstallResponseSchema = response(
  "integration.plugin.install.response",
  z.object({ appsNeedingAuth: z.array(z.string()), installed: z.literal(true) }).strict()
)
export const PluginUninstallResponseSchema = response(
  "integration.plugin.uninstall.response",
  mutation
)
export const PluginSetEnabledResponseSchema = response(
  "integration.plugin.set-enabled.response",
  mutation
)
export const MarketplaceAddResponseSchema = response(
  "integration.marketplace.add.response",
  z.object({ marketplaceName: z.string().nullable(), succeeded: z.literal(true) }).strict()
)
export const MarketplaceUpgradeResponseSchema = response(
  "integration.marketplace.upgrade.response",
  mutation
)
export const MarketplaceRemoveResponseSchema = response(
  "integration.marketplace.remove.response",
  mutation
)
export const CodexAppListResponseSchema = response(
  "integration.codex.app.list.response",
  z.object({ apps: z.array(CodexAppViewSchema), runtimeError: z.string().nullable() }).strict()
)
export const CodexAppSetEnabledResponseSchema = response(
  "integration.codex.app.set-enabled.response",
  mutation
)
export const CodexAppConnectResponseSchema = response(
  "integration.codex.app.connect.response",
  z.object({ url: z.string().url() }).strict()
)

export const INTEGRATION_CLIENT_SCHEMAS = [
  SkillListRequestSchema,
  SkillSetEnabledRequestSchema,
  McpListRequestSchema,
  McpAddRequestSchema,
  McpSetEnabledRequestSchema,
  McpLoginRequestSchema,
  PluginListRequestSchema,
  PluginReadRequestSchema,
  PluginInstallRequestSchema,
  PluginUninstallRequestSchema,
  PluginSetEnabledRequestSchema,
  MarketplaceAddRequestSchema,
  MarketplaceUpgradeRequestSchema,
  MarketplaceRemoveRequestSchema,
  CodexAppListRequestSchema,
  CodexAppSetEnabledRequestSchema,
  CodexAppConnectRequestSchema,
] as const
export const INTEGRATION_SERVER_SCHEMAS = [
  SkillListResponseSchema,
  SkillSetEnabledResponseSchema,
  McpListResponseSchema,
  McpAddResponseSchema,
  McpSetEnabledResponseSchema,
  McpLoginResponseSchema,
  PluginListResponseSchema,
  PluginReadResponseSchema,
  PluginInstallResponseSchema,
  PluginUninstallResponseSchema,
  PluginSetEnabledResponseSchema,
  MarketplaceAddResponseSchema,
  MarketplaceUpgradeResponseSchema,
  MarketplaceRemoveResponseSchema,
  CodexAppListResponseSchema,
  CodexAppSetEnabledResponseSchema,
  CodexAppConnectResponseSchema,
] as const

export type IntegrationClientMessage = z.infer<(typeof INTEGRATION_CLIENT_SCHEMAS)[number]>
export type IntegrationServerMessage = z.infer<(typeof INTEGRATION_SERVER_SCHEMAS)[number]>
export const INTEGRATION_RESPONSE_TYPES = INTEGRATION_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)
