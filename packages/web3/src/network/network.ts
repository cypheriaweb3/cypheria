import { z } from "zod"
import { chainIdentitySchema, chainKeySchema, toChainKey } from "./chain.js"
import {
  networkCredentialRefSchema,
  networkIdSchema,
  rpcEndpointIdSchema,
  timestampSchema,
} from "./primitives.js"
import { isLoopbackHostname } from "./url.js"

export const networkExplorerSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: z.url({ protocol: /^https$/u }),
  })
  .strict()

export const nativeCurrencySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    symbol: z.string().trim().min(1).max(16),
    decimals: z.number().int().min(0).max(255),
  })
  .strict()

export const networkVerificationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("evm-chain-id") }).strict(),
  z
    .object({
      kind: z.literal("solana-genesis-hash"),
      genesisHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/u),
    })
    .strict(),
])

export const networkDefinitionSchema = z
  .object({
    id: networkIdSchema,
    chain: chainIdentitySchema,
    name: z.string().trim().min(1).max(80),
    nativeCurrency: nativeCurrencySchema,
    explorers: z.array(networkExplorerSchema).max(8),
    verification: networkVerificationSchema,
    testnet: z.boolean(),
    source: z.enum(["builtin", "custom"]),
    catalogKey: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/u)
      .optional(),
    enabled: z.boolean(),
    deprecated: z.boolean(),
    position: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((network, context) => {
    if ((network.source === "builtin") !== (network.catalogKey !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Built-in networks require a catalog key and custom networks must not have one.",
        path: ["catalogKey"],
      })
    }
    if ((network.chain.namespace === "eip155") !== (network.verification.kind === "evm-chain-id")) {
      context.addIssue({
        code: "custom",
        message: "Network verification must match its chain namespace.",
        path: ["verification"],
      })
    }
  })

const publicConnectionSchema = z.object({ kind: z.literal("public"), url: z.url() }).strict()

const protectedConnectionSchema = z
  .object({
    kind: z.literal("protected"),
    displayUrl: z.url(),
    credentialRef: networkCredentialRefSchema,
  })
  .strict()

export const rpcConnectionSchema = z.discriminatedUnion("kind", [
  publicConnectionSchema,
  protectedConnectionSchema,
])

export const rpcEndpointSchema = z
  .object({
    id: rpcEndpointIdSchema,
    networkId: networkIdSchema,
    label: z.string().trim().min(1).max(80),
    transport: z.enum(["http", "websocket"]),
    connection: rpcConnectionSchema,
    source: z.enum(["builtin", "custom"]),
    localDevelopment: z.boolean(),
    enabled: z.boolean(),
    deprecated: z.boolean(),
    position: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((endpoint, context) => {
    const url = new URL(
      endpoint.connection.kind === "public"
        ? endpoint.connection.url
        : endpoint.connection.displayUrl
    )
    const expectedProtocols =
      endpoint.transport === "http" ? new Set(["http:", "https:"]) : new Set(["ws:", "wss:"])
    if (!expectedProtocols.has(url.protocol)) {
      context.addIssue({
        code: "custom",
        message: "RPC URL protocol does not match its transport.",
        path: ["connection"],
      })
    }
    if (url.username || url.password || url.hash) {
      context.addIssue({
        code: "custom",
        message: "RPC endpoint projections must not contain user info or fragments.",
        path: ["connection"],
      })
    }
    if (
      endpoint.localDevelopment
        ? endpoint.source !== "custom" || !isLoopbackHostname(url.hostname)
        : !new Set(["https:", "wss:"]).has(url.protocol)
    ) {
      context.addIssue({
        code: "custom",
        message: "Insecure RPC URLs are allowed only for explicit custom loopback development.",
        path: ["localDevelopment"],
      })
    }
  })

export const rpcEndpointHealthSchema = z
  .object({
    state: z.enum(["unknown", "healthy", "degraded", "cooldown"]),
    observedChainKey: chainKeySchema.optional(),
    latencyMs: z.number().nonnegative().optional(),
    lastSuccessAt: timestampSchema.optional(),
    lastFailureAt: timestampSchema.optional(),
    consecutiveFailures: z.number().int().nonnegative(),
  })
  .strict()

export const rpcEndpointViewSchema = z
  .object({
    id: rpcEndpointIdSchema,
    networkId: networkIdSchema,
    label: z.string().trim().min(1).max(80),
    transport: z.enum(["http", "websocket"]),
    connection: z.object({ kind: z.enum(["public", "protected"]), displayUrl: z.url() }).strict(),
    source: z.enum(["builtin", "custom"]),
    localDevelopment: z.boolean(),
    enabled: z.boolean(),
    deprecated: z.boolean(),
    position: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    health: rpcEndpointHealthSchema.optional(),
  })
  .strict()

export type NetworkExplorer = z.infer<typeof networkExplorerSchema>
export type NativeCurrency = z.infer<typeof nativeCurrencySchema>
export type NetworkVerification = z.infer<typeof networkVerificationSchema>
export type NetworkDefinition = z.infer<typeof networkDefinitionSchema>
export type RpcConnection = z.infer<typeof rpcConnectionSchema>
export type RpcEndpoint = z.infer<typeof rpcEndpointSchema>
export type RpcEndpointHealth = z.infer<typeof rpcEndpointHealthSchema>
export type RpcEndpointView = z.infer<typeof rpcEndpointViewSchema>

export const projectRpcEndpoint = (
  endpoint: RpcEndpoint,
  health?: RpcEndpointHealth
): RpcEndpointView =>
  rpcEndpointViewSchema.parse({
    ...endpoint,
    connection: {
      kind: endpoint.connection.kind,
      displayUrl:
        endpoint.connection.kind === "public"
          ? endpoint.connection.url
          : endpoint.connection.displayUrl,
    },
    health,
  })

export const networkChainKey = (network: NetworkDefinition) => toChainKey(network.chain)
