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
const harness = z.object({ agentId: AgentIdSchema, nativeId: z.string().nullable() }).strict()

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
    harness,
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
    harness,
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
    tools: z.array(
      z
        .object({
          description: z.string().nullable(),
          name: z.string(),
          appScope: z
            .object({ connectorId: z.string(), accountLinkId: z.string(), resourceUri: z.string() })
            .strict()
            .nullable(),
        })
        .strict()
    ),
  })
  .strict()
export type McpServerView = z.infer<typeof McpServerViewSchema>

export const HookTrustStatusSchema = z.enum(["managed", "untrusted", "trusted", "modified"])
export type HookTrustStatus = z.infer<typeof HookTrustStatusSchema>

export const HookHandlerTypeSchema = z.enum(["command", "mcpTool", "prompt", "agent"])
export type HookHandlerType = z.infer<typeof HookHandlerTypeSchema>

export const HookSourceSchema = z.enum([
  "system",
  "user",
  "project",
  "mdm",
  "sessionFlags",
  "plugin",
  "cloudRequirements",
  "cloudManagedConfig",
  "legacyManagedConfigFile",
  "legacyManagedConfigMdm",
  "unknown",
])
export type HookSource = z.infer<typeof HookSourceSchema>

export const HookViewSchema = z
  .object({
    additionalContextLimit: z.number().int().nonnegative().nullable(),
    async: z.boolean().nullable(),
    command: z.string().nullable(),
    currentHash: z.string(),
    cwd: z.string(),
    displayOrder: z.number(),
    enabled: z.boolean(),
    eventName: z.string().min(1),
    handlerType: HookHandlerTypeSchema,
    harness,
    isManaged: z.boolean(),
    key: z.string().min(1),
    matcher: z.string().nullable(),
    mcpServer: z.string().nullable(),
    mcpTool: z.string().nullable(),
    pluginId: z.string().nullable(),
    source: HookSourceSchema,
    sourcePath: z.string().min(1),
    statusMessage: z.string().nullable(),
    timeoutSec: z.number().int().nonnegative(),
    trustStatus: HookTrustStatusSchema,
  })
  .strict()
export type HookView = z.infer<typeof HookViewSchema>

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
    installedScopes: z.array(z.enum(["user", "project", "local"])),
    installPolicy: z.enum(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]),
    logoUrl: z.string().nullable(),
    marketplaceName: z.string().min(1),
    marketplacePath: z.string().nullable(),
    name: z.string().min(1),
    harness,
    sourceType: z.enum(["local", "git", "npm", "remote", "archive", "command"]),
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

export const PluginTokenCostSchema = z
  .object({
    alwaysOn: z.number().nonnegative(),
    components: z.array(
      z
        .object({
          alwaysOn: z.number().nonnegative(),
          name: z.string(),
          onInvoke: z.number().nonnegative(),
        })
        .strict()
    ),
  })
  .strict()
export type PluginTokenCost = z.infer<typeof PluginTokenCostSchema>

export const PluginScopeSchema = z.enum(["user", "project", "local"])
export type PluginScope = z.infer<typeof PluginScopeSchema>

export const PluginCapabilitiesSchema = z
  .object({
    addMarketplace: z.boolean(),
    configure: z.boolean(),
    install: z.boolean(),
    readDetail: z.boolean(),
    removeMarketplace: z.boolean(),
    scopes: z.array(PluginScopeSchema),
    setEnabled: z.boolean(),
    uninstall: z.boolean(),
    upgradeMarketplace: z.boolean(),
  })
  .strict()
export type PluginCapabilities = z.infer<typeof PluginCapabilitiesSchema>

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
    detailAvailable: z.boolean(),
    mcpServers: z.array(z.string()),
    /**
     * The skill the plugin's manifest names in `extensions["com.openai"].onboardingSkill`, which
     * Set up runs in a new chat. Reported by Agents that read it.
     */
    onboardingSkill: z
      .object({ name: z.string(), path: z.string() })
      .strict()
      .nullable()
      .optional(),
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
    tokenCost: PluginTokenCostSchema.optional(),
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
const harnessItem = z.object({ agentId: AgentIdSchema, id: z.string().min(1) }).strict()
const setEnabled = harnessItem.extend({ enabled: z.boolean() }).strict()
const pluginLocator = z
  .object({
    agentId: AgentIdSchema,
    marketplaceName: z.string().min(1),
    marketplacePath: z.string().nullable(),
    pluginName: z.string().min(1),
    scope: PluginScopeSchema.optional(),
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
export const HookListRequestSchema = request(
  "integration.hook.list.request",
  agentListInput.extend({ cwd: z.string().min(1).optional() }).strict()
)
export const HookSetEnabledRequestSchema = request(
  "integration.hook.set-enabled.request",
  z
    .object({
      agentId: AgentIdSchema,
      enabled: z.boolean(),
      key: z.string().min(1),
    })
    .strict()
)
export const HookTrustRequestSchema = request(
  "integration.hook.trust.request",
  z
    .object({
      agentId: AgentIdSchema,
      key: z.string().min(1),
      trustedHash: z.string().min(1),
    })
    .strict()
)
export const McpListRequestSchema = request("integration.mcp.list.request", agentListInput)
export const McpAddRequestSchema = request(
  "integration.mcp.add.request",
  z.object({ agentId: AgentIdSchema, name: IntegrationIdSchema, url: z.string().url() }).strict()
)
export const McpSetEnabledRequestSchema = request("integration.mcp.set-enabled.request", setEnabled)
export const McpLoginRequestSchema = request("integration.mcp.login.request", harnessItem)
export const PluginListRequestSchema = request(
  "integration.plugin.list.request",
  agentListInput.extend({ cwd: z.string().min(1).optional() }).strict()
)
export const PluginReadRequestSchema = request("integration.plugin.read.request", pluginLocator)
const pluginIdentity = z
  .object({ marketplaceName: z.string().min(1), pluginName: z.string().min(1) })
  .strict()
const commandSha256 = z.string().length(64)
// Installing offers a plugin to every Agent whose marketplace lists it and
// enables it in each; `agentIds` limits a retry to the Agents that still need one.
export const PluginInstallRequestSchema = request(
  "integration.plugin.install.request",
  pluginIdentity
    .extend({
      acceptCommands: z.record(z.string(), commandSha256).optional(),
      agentIds: z.array(AgentIdSchema).min(1).optional(),
      scope: PluginScopeSchema.optional(),
    })
    .strict()
)
export const PluginUninstallRequestSchema = request(
  "integration.plugin.uninstall.request",
  pluginIdentity.extend({ keepData: z.boolean().optional() }).strict()
)
// Enablement is per Agent. Enabling in an Agent that does not hold the plugin yet installs it there first.
export const PluginSetEnabledRequestSchema = request(
  "integration.plugin.set-enabled.request",
  pluginIdentity
    .extend({
      acceptCommandSha256: commandSha256.optional(),
      agentId: AgentIdSchema,
      enabled: z.boolean(),
      scope: PluginScopeSchema.optional(),
    })
    .strict()
)
export const PluginSetGlobalEnabledRequestSchema = request(
  "integration.plugin.set-global-enabled.request",
  z.object({ agentId: AgentIdSchema, enabled: z.boolean() }).strict()
)
export const MarketplaceAddRequestSchema = request(
  "integration.marketplace.add.request",
  z
    .object({
      refName: z.string().min(1).optional(),
      source: z.string().min(1),
      sparsePaths: z.array(z.string().min(1)).optional(),
    })
    .strict()
)
export const MarketplaceUpgradeRequestSchema = request(
  "integration.marketplace.upgrade.request",
  z.object({ marketplaceName: z.string().min(1).optional() }).strict()
)
export const MarketplaceRemoveRequestSchema = request(
  "integration.marketplace.remove.request",
  z
    .object({
      confirmUninstall: z.boolean().optional(),
      marketplaceName: z.string().min(1),
    })
    .strict()
)
export const PluginAgentsRequestSchema = request(
  "integration.plugin.agents.request",
  z.object({ marketplaceName: z.string().min(1), pluginName: z.string().min(1) }).strict()
)
export const PluginConfigReadRequestSchema = request(
  "integration.plugin.config.read.request",
  harnessItem
)
export const PluginConfigWriteRequestSchema = request(
  "integration.plugin.config.write.request",
  harnessItem.extend({ values: z.record(z.string(), z.string()) }).strict()
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
export const HookListResponseSchema = response(
  "integration.hook.list.response",
  z
    .object({
      errors: z.array(z.object({ message: z.string(), path: z.string().nullable() }).strict()),
      hooks: z.array(HookViewSchema),
      warnings: z.array(z.string()),
    })
    .strict()
)
export const HookSetEnabledResponseSchema = response(
  "integration.hook.set-enabled.response",
  mutation
)
export const HookTrustResponseSchema = response("integration.hook.trust.response", mutation)
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
      capabilities: PluginCapabilitiesSchema,
      errors: z.array(z.object({ message: z.string(), path: z.string() }).strict()),
      marketplaces: z.array(MarketplaceViewSchema),
    })
    .strict()
)
export const PluginReadResponseSchema = response(
  "integration.plugin.read.response",
  PluginDetailViewSchema
)
export const PluginCommandConfirmationSchema = z
  .object({
    command: z.string(),
    pluginId: z.string(),
    sha256: commandSha256,
  })
  .strict()
export type PluginCommandConfirmation = z.infer<typeof PluginCommandConfirmationSchema>

export const PluginAgentResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      agentId: AgentIdSchema,
      appsNeedingAuth: z.array(z.string()),
      reloadPending: z.boolean(),
      status: z.literal("done"),
    })
    .strict(),
  z
    .object({
      agentId: AgentIdSchema,
      confirmation: PluginCommandConfirmationSchema,
      status: z.literal("confirmation_required"),
    })
    .strict(),
  z.object({ agentId: AgentIdSchema, message: z.string(), status: z.literal("failed") }).strict(),
])
export type PluginAgentResult = z.infer<typeof PluginAgentResultSchema>

export const PluginInstallResponseSchema = response(
  "integration.plugin.install.response",
  z.object({ results: z.array(PluginAgentResultSchema) }).strict()
)
export const PluginUninstallResponseSchema = response(
  "integration.plugin.uninstall.response",
  z.object({ agentIds: z.array(AgentIdSchema), succeeded: z.literal(true) }).strict()
)
export const PluginSetEnabledResponseSchema = response(
  "integration.plugin.set-enabled.response",
  PluginAgentResultSchema
)
export const PluginSetGlobalEnabledResponseSchema = response(
  "integration.plugin.set-global-enabled.response",
  mutation
)
export const MarketplaceAddResponseSchema = response(
  "integration.marketplace.add.response",
  z
    .object({
      agents: z.array(
        z
          .object({
            added: z.boolean(),
            agentId: AgentIdSchema,
            message: z.string().nullable(),
          })
          .strict()
      ),
      marketplaceName: z.string().nullable(),
      succeeded: z.literal(true),
    })
    .strict()
)
// After an update, Agents that gained support for the marketplace are added
// and Agents that lost it are removed, so it lists exactly where it is offered.
export const MarketplaceUpgradeResponseSchema = response(
  "integration.marketplace.upgrade.response",
  z
    .object({
      added: z.array(z.object({ agentId: AgentIdSchema, marketplaceName: z.string() }).strict()),
      errors: z.array(z.object({ agentId: AgentIdSchema, message: z.string() }).strict()),
      removed: z.array(z.object({ agentId: AgentIdSchema, marketplaceName: z.string() }).strict()),
      succeeded: z.literal(true),
    })
    .strict()
)
export const MarketplaceRemoveResponseSchema = response(
  "integration.marketplace.remove.response",
  z.discriminatedUnion("succeeded", [
    z.object({ succeeded: z.literal(true), uninstalledPlugins: z.array(z.string()) }).strict(),
    z.object({ affectedPlugins: z.array(z.string()), succeeded: z.literal(false) }).strict(),
  ])
)
export const PluginAgentStateSchema = z
  .object({
    agentId: AgentIdSchema,
    enabled: z.boolean(),
    id: z.string().min(1),
    installed: z.boolean(),
    installedScopes: z.array(PluginScopeSchema),
    marketplacePath: z.string().nullable(),
  })
  .strict()
export type PluginAgentState = z.infer<typeof PluginAgentStateSchema>

export const PluginAgentsResponseSchema = response(
  "integration.plugin.agents.response",
  z.object({ agents: z.array(PluginAgentStateSchema) }).strict()
)
export const PluginConfigOptionSchema = z
  .object({
    configured: z.boolean(),
    default: z.string().nullable(),
    description: z.string(),
    key: z.string().min(1),
    multiple: z.boolean(),
    options: z.array(z.string()).nullable(),
    required: z.boolean(),
    sensitive: z.boolean(),
    title: z.string(),
    type: z.enum(["string", "number", "boolean", "directory", "file"]),
    value: z.string().nullable(),
  })
  .strict()
export type PluginConfigOption = z.infer<typeof PluginConfigOptionSchema>

export const PluginConfigReadResponseSchema = response(
  "integration.plugin.config.read.response",
  z.object({ options: z.array(PluginConfigOptionSchema) }).strict()
)
export const PluginConfigWriteResponseSchema = response(
  "integration.plugin.config.write.response",
  z.object({ saved: z.array(z.string()), unconfigured: z.array(z.string()) }).strict()
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
  HookListRequestSchema,
  HookSetEnabledRequestSchema,
  HookTrustRequestSchema,
  McpListRequestSchema,
  McpAddRequestSchema,
  McpSetEnabledRequestSchema,
  McpLoginRequestSchema,
  PluginListRequestSchema,
  PluginReadRequestSchema,
  PluginInstallRequestSchema,
  PluginUninstallRequestSchema,
  PluginSetEnabledRequestSchema,
  PluginSetGlobalEnabledRequestSchema,
  MarketplaceAddRequestSchema,
  MarketplaceUpgradeRequestSchema,
  MarketplaceRemoveRequestSchema,
  PluginAgentsRequestSchema,
  PluginConfigReadRequestSchema,
  PluginConfigWriteRequestSchema,
  CodexAppListRequestSchema,
  CodexAppSetEnabledRequestSchema,
  CodexAppConnectRequestSchema,
] as const
export const INTEGRATION_SERVER_SCHEMAS = [
  SkillListResponseSchema,
  SkillSetEnabledResponseSchema,
  HookListResponseSchema,
  HookSetEnabledResponseSchema,
  HookTrustResponseSchema,
  McpListResponseSchema,
  McpAddResponseSchema,
  McpSetEnabledResponseSchema,
  McpLoginResponseSchema,
  PluginListResponseSchema,
  PluginReadResponseSchema,
  PluginInstallResponseSchema,
  PluginUninstallResponseSchema,
  PluginSetEnabledResponseSchema,
  PluginSetGlobalEnabledResponseSchema,
  MarketplaceAddResponseSchema,
  MarketplaceUpgradeResponseSchema,
  MarketplaceRemoveResponseSchema,
  PluginAgentsResponseSchema,
  PluginConfigReadResponseSchema,
  PluginConfigWriteResponseSchema,
  CodexAppListResponseSchema,
  CodexAppSetEnabledResponseSchema,
  CodexAppConnectResponseSchema,
] as const

export type IntegrationClientMessage = z.infer<(typeof INTEGRATION_CLIENT_SCHEMAS)[number]>
export type IntegrationServerMessage = z.infer<(typeof INTEGRATION_SERVER_SCHEMAS)[number]>
export const INTEGRATION_RESPONSE_TYPES = INTEGRATION_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)
