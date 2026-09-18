import { z } from "zod"
import { REGISTRY_AGENT_IDS } from "../generated/acp/agent-ids.ts"

export { REGISTRY_AGENT_IDS } from "../generated/acp/agent-ids.ts"

export const NATIVE_AGENT_IDS = ["codex", "claude", "pi", "opencode"] as const
export const NativeAgentIdSchema = z.enum(NATIVE_AGENT_IDS)
export type NativeAgentId = z.infer<typeof NativeAgentIdSchema>

export const RegistryAgentIdSchema = z.enum(REGISTRY_AGENT_IDS)
export type RegistryAgentId = z.infer<typeof RegistryAgentIdSchema>

export const AgentIdSchema = z.union([NativeAgentIdSchema, RegistryAgentIdSchema])
export type AgentId = z.infer<typeof AgentIdSchema>

/** Stable compatibility buckets used by integrations exposed to more than one agent runtime. */
export const AgentCompatibilityTagSchema = z.enum(["codex", "claude", "pi", "opencode", "acp"])
export type AgentCompatibilityTag = z.infer<typeof AgentCompatibilityTagSchema>

export const compatibilityTagForAgent = (agentId: AgentId): AgentCompatibilityTag =>
  NativeAgentIdSchema.safeParse(agentId).success ? (agentId as NativeAgentId) : "acp"

export const AgentRegistryPlatformSchema = z.enum([
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-aarch64",
  "linux-x86_64",
  "windows-aarch64",
  "windows-x86_64",
])
export type AgentRegistryPlatform = z.infer<typeof AgentRegistryPlatformSchema>

const DistributionEnvironmentSchema = z.record(z.string(), z.string())
const PackageDistributionSchema = z
  .object({
    args: z.array(z.string()).optional(),
    env: DistributionEnvironmentSchema.optional(),
    package: z.string().min(1),
  })
  .strict()

export const AgentBinaryDistributionSchema = z
  .object({
    archive: z.string().url(),
    args: z.array(z.string()).optional(),
    cmd: z.string(),
    env: DistributionEnvironmentSchema.optional(),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
  })
  .strict()

const BinaryDistributionsSchema = z
  .partialRecord(AgentRegistryPlatformSchema, AgentBinaryDistributionSchema)
  .refine((value) => Object.keys(value).length > 0, {
    message: "Binary distribution must define at least one platform",
  })

export const AgentDistributionSchema = z
  .object({
    binary: BinaryDistributionsSchema.optional(),
    npx: PackageDistributionSchema.optional(),
    uvx: PackageDistributionSchema.optional(),
  })
  .strict()
  .refine((value) => value.binary || value.npx || value.uvx, {
    message: "Agent distribution must define binary, npx, or uvx",
  })

const AgentPreviewDistributionSchema = z
  .object({
    npx: PackageDistributionSchema.optional(),
    uvx: PackageDistributionSchema.optional(),
  })
  .strict()
  .refine((value) => value.npx || value.uvx, {
    message: "Preview distribution must define npx or uvx",
  })

const AgentPreviewSchema = z
  .object({
    distribution: AgentPreviewDistributionSchema,
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-preview\.[0-9]+)?$/),
  })
  .strict()

export const AgentRegistryEntrySchema = z
  .object({
    authors: z.array(z.string()).optional(),
    description: z.string().min(1),
    distribution: AgentDistributionSchema,
    icon: z.string().optional(),
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    license: z.string().optional(),
    license_url: z.string().url().optional(),
    name: z.string().min(1),
    preview: AgentPreviewSchema.optional(),
    repository: z.string().url().optional(),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    website: z.string().url().optional(),
  })
  .passthrough()
  .superRefine((agent, context) => {
    if (agent.id !== "dimcode" && !agent.license_url) {
      context.addIssue({
        code: "custom",
        message: "license_url is required for all agents except dimcode",
        path: ["license_url"],
      })
    }
  })

export const AgentRegistryDocumentSchema = z
  .object({
    agents: z.array(AgentRegistryEntrySchema),
    // The published ACP registry currently reserves this top-level collection
    // and emits it as an empty array even though FORMAT.md only documents agents.
    extensions: z.array(z.never()).optional(),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+/),
  })
  .strict()
  .superRefine(({ agents }, context) => {
    const ids = new Set<string>()
    for (const [index, agent] of agents.entries()) {
      if (ids.has(agent.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate agent id: ${agent.id}`,
          path: ["agents", index, "id"],
        })
      }
      ids.add(agent.id)
    }
  })

export type AgentRegistryDocument = z.infer<typeof AgentRegistryDocumentSchema>
export type AgentRegistryEntry = z.infer<typeof AgentRegistryEntrySchema>
export type AgentDistribution = z.infer<typeof AgentDistributionSchema>

export const isNativeAgentId = (value: string): value is NativeAgentId =>
  NativeAgentIdSchema.safeParse(value).success

export const isRegistryAgentId = (value: string): value is RegistryAgentId =>
  RegistryAgentIdSchema.safeParse(value).success
