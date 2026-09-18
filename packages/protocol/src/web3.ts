import {
  chainIdentitySchema,
  nativeCurrencySchema,
  networkDefinitionSchema,
  networkExplorerSchema,
  networkIdSchema,
  networkVerificationSchema,
  rpcEndpointHealthSchema,
  rpcEndpointIdSchema,
  rpcEndpointViewSchema,
} from "@cypheria/web3/network"
import {
  SigningPolicyObjectSchema,
  SigningPolicySchema,
  signingPolicyIdSchema,
} from "@cypheria/web3/policy"
import {
  dappSessionSchema,
  walletProviderRequestSchema,
  walletProviderResponseSchema,
} from "@cypheria/web3/provider"
import {
  chainAccountIdSchema,
  chainAccountSchema,
  hexAddressSchema,
  signingIntentSchema,
  walletAccountIdSchema,
  walletIdSchema,
  walletModes,
  walletViewSchema,
} from "@cypheria/web3/wallet"
import { z } from "zod"

import { RequestIdSchema } from "./request-id.ts"

const nameSchema = z.string().trim().min(1).max(128)
const privateKeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/u)
const emptySchema = z.object({}).strict()
const completedSchema = z.object({ completed: z.literal(true) }).strict()
const dappUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (
    !url.username &&
    !url.password &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(url.hostname)))
  )
}, "dApp URLs must use HTTPS, except for loopback development origins")

export const Web3NetworkViewSchema = z
  .object({ network: networkDefinitionSchema, endpoints: z.array(rpcEndpointViewSchema) })
  .strict()
export type Web3NetworkView = z.infer<typeof Web3NetworkViewSchema>

export const Web3CreateRpcEndpointInputSchema = z
  .object({
    enabled: z.boolean().default(true),
    headers: z.record(z.string().min(1), z.string()).optional(),
    label: z.string().trim().min(1).max(80),
    localDevelopment: z.boolean().default(false),
    transport: z.enum(["http", "websocket"]),
    url: z.url(),
  })
  .strict()

export const Web3CreateNetworkInputSchema = z
  .object({
    chain: chainIdentitySchema,
    enabled: z.boolean().default(true),
    endpoints: z.array(Web3CreateRpcEndpointInputSchema).min(1),
    explorers: z.array(networkExplorerSchema).max(8),
    name: z.string().trim().min(1).max(80),
    nativeCurrency: nativeCurrencySchema,
    testnet: z.boolean(),
    verification: networkVerificationSchema,
  })
  .strict()

export const Web3WalletActiveContextSchema = z
  .object({
    chainAccount: chainAccountSchema.optional(),
    mode: z.enum(walletModes),
    network: networkDefinitionSchema.optional(),
    wallet: walletViewSchema.optional(),
    walletAccount: z
      .object({
        account: z.object({ id: z.string(), name: z.string(), walletId: z.string() }).loose(),
        chainAccounts: z.array(z.unknown()),
      })
      .loose()
      .optional(),
  })
  .loose()
export type Web3WalletActiveContext = z.infer<typeof Web3WalletActiveContextSchema>

export const Web3SigningPolicyRecordSchema = z
  .object({
    createdAt: z.iso.datetime(),
    policy: SigningPolicySchema,
    revision: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
export type Web3SigningPolicyRecord = z.infer<typeof Web3SigningPolicyRecordSchema>

export const Web3ApprovalStatusSchema = z.enum(["approved", "expired", "pending", "rejected"])
export const Web3SigningIntentRecordSchema = z
  .object({
    approvalId: z.string().min(1).optional(),
    decision: z.enum(["allow", "deny", "require-human-approval"]),
    decisionId: z.string().min(1),
    expiresAt: z.iso.datetime(),
    intent: signingIntentSchema,
    matchedPolicyId: z.string().min(1).optional(),
    mode: z.enum(walletModes),
    payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    revision: z.number().int().positive(),
    source: z.enum(["agent", "dapp", "schedule"]),
    status: z.enum(["approved", "expired", "pending-approval", "rejected"]),
    updatedAt: z.iso.datetime(),
  })
  .strict()
export const Web3ApprovalRequestSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    id: z.string().regex(/^approval_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    intentId: z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    requestedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().optional(),
    reviewer: z.string().min(1).optional(),
    revision: z.number().int().positive(),
    status: Web3ApprovalStatusSchema,
  })
  .strict()
export const Web3ApprovalViewSchema = z
  .object({ approval: Web3ApprovalRequestSchema, intent: Web3SigningIntentRecordSchema })
  .strict()
export type Web3ApprovalView = z.infer<typeof Web3ApprovalViewSchema>

export const Web3AuditRecordSchema = z
  .object({
    actor: z.string(),
    correlationId: z.string().nullable(),
    createdAt: z.iso.datetime(),
    eventType: z.string(),
    id: z.string(),
    payloadHash: z.string().nullable(),
    payloadSummary: z.string().nullable(),
    source: z.string(),
  })
  .strict()
export type Web3AuditRecord = z.infer<typeof Web3AuditRecordSchema>

const request = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) })
const result = <S extends z.ZodType>(value: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ error: z.object({ code: z.string(), message: z.string() }), ok: z.literal(false) }),
  ])
const response = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z.object({ payload: result(value), requestId: RequestIdSchema, type: z.literal(type) })

export const Web3NetworkListRequestSchema = request("web3.network.list.request", emptySchema)
export const Web3NetworkCreateRequestSchema = request(
  "web3.network.create.request",
  Web3CreateNetworkInputSchema
)
export const Web3NetworkSetEnabledRequestSchema = request(
  "web3.network.set-enabled.request",
  z
    .object({
      enabled: z.boolean(),
      expectedRevision: z.number().int().positive(),
      networkId: networkIdSchema,
    })
    .strict()
)
export const Web3NetworkRemoveRequestSchema = request(
  "web3.network.remove.request",
  z.object({ confirmed: z.boolean(), networkId: networkIdSchema }).strict()
)
export const Web3NetworkReorderRequestSchema = request(
  "web3.network.reorder.request",
  z.object({ networkIds: z.array(networkIdSchema) }).strict()
)
export const Web3EndpointAddRequestSchema = request(
  "web3.endpoint.add.request",
  z.object({ endpoint: Web3CreateRpcEndpointInputSchema, networkId: networkIdSchema }).strict()
)
export const Web3EndpointProbeRequestSchema = request(
  "web3.endpoint.probe.request",
  z.object({ endpointId: rpcEndpointIdSchema }).strict()
)
export const Web3EndpointSetEnabledRequestSchema = request(
  "web3.endpoint.set-enabled.request",
  z
    .object({
      enabled: z.boolean(),
      endpointId: rpcEndpointIdSchema,
      expectedRevision: z.number().int().positive(),
    })
    .strict()
)
export const Web3EndpointRemoveRequestSchema = request(
  "web3.endpoint.remove.request",
  z.object({ endpointId: rpcEndpointIdSchema }).strict()
)
export const Web3EndpointReorderRequestSchema = request(
  "web3.endpoint.reorder.request",
  z.object({ endpointIds: z.array(rpcEndpointIdSchema), networkId: networkIdSchema }).strict()
)

export const Web3WalletListRequestSchema = request("web3.wallet.list.request", emptySchema)
export const Web3WalletGenerateRequestSchema = request(
  "web3.wallet.generate.request",
  z
    .object({
      accountName: nameSchema.optional(),
      name: nameSchema,
      passphrase: z.string().max(1024).optional(),
      strength: z.union([z.literal(128), z.literal(256)]).optional(),
    })
    .strict()
)
export const Web3WalletDeriveRequestSchema = request(
  "web3.wallet.derive.request",
  z.object({ name: nameSchema.optional(), walletId: walletIdSchema }).strict()
)
export const Web3WalletImportHdRequestSchema = request(
  "web3.wallet.import-hd.request",
  z
    .object({
      accountName: nameSchema.optional(),
      expectedAddress: hexAddressSchema.optional(),
      mnemonic: z.string().trim().min(1),
      name: nameSchema,
      passphrase: z.string().max(1024).optional(),
    })
    .strict()
)
export const Web3WalletImportPrivateKeyRequestSchema = request(
  "web3.wallet.import-private-key.request",
  z
    .object({
      accountName: nameSchema.optional(),
      expectedAddress: hexAddressSchema.optional(),
      name: nameSchema,
      privateKey: privateKeySchema,
    })
    .strict()
)
export const Web3WalletAddWatchRequestSchema = request(
  "web3.wallet.add-watch.request",
  z
    .object({ accountName: nameSchema.optional(), address: hexAddressSchema, name: nameSchema })
    .strict()
)
export const Web3WalletRenameRequestSchema = request(
  "web3.wallet.rename.request",
  z.object({ name: nameSchema, walletId: walletIdSchema }).strict()
)
export const Web3WalletReorderRequestSchema = request(
  "web3.wallet.reorder.request",
  z.object({ walletIds: z.array(walletIdSchema) }).strict()
)
export const Web3WalletReorderAccountsRequestSchema = request(
  "web3.wallet.reorder-accounts.request",
  z.object({ walletAccountIds: z.array(walletAccountIdSchema), walletId: walletIdSchema }).strict()
)
export const Web3WalletDeleteRequestSchema = request(
  "web3.wallet.delete.request",
  z.object({ walletId: walletIdSchema }).strict()
)
export const Web3WalletActiveGetRequestSchema = request(
  "web3.wallet.active.get.request",
  emptySchema
)
export const Web3WalletActiveSetRequestSchema = request(
  "web3.wallet.active.set.request",
  z
    .object({
      chainAccountId: chainAccountIdSchema,
      mode: z.enum(walletModes),
      networkId: networkIdSchema,
      walletAccountId: walletAccountIdSchema,
      walletId: walletIdSchema,
    })
    .strict()
)
export const Web3WalletActiveClearRequestSchema = request(
  "web3.wallet.active.clear.request",
  emptySchema
)
export const Web3WalletLockRequestSchema = request(
  "web3.wallet.lock.request",
  z.object({ walletId: walletIdSchema }).strict()
)
export const Web3WalletUnlockRequestSchema = request(
  "web3.wallet.unlock.request",
  z.object({ walletId: walletIdSchema }).strict()
)

export const Web3PolicyListRequestSchema = request(
  "web3.policy.list.request",
  z.object({ enabled: z.boolean().optional(), walletId: walletIdSchema.optional() }).strict()
)
export const Web3PolicyCreateRequestSchema = request(
  "web3.policy.create.request",
  SigningPolicyObjectSchema.omit({ id: true })
    .extend({ id: signingPolicyIdSchema.optional() })
    .strict()
)
export const Web3PolicyUpdateRequestSchema = request(
  "web3.policy.update.request",
  SigningPolicyObjectSchema.omit({ id: true, walletId: true })
    .partial()
    .extend({ expectedRevision: z.number().int().positive(), policyId: signingPolicyIdSchema })
    .strict()
)
export const Web3PolicyDisableRequestSchema = request(
  "web3.policy.disable.request",
  z
    .object({ expectedRevision: z.number().int().positive(), policyId: signingPolicyIdSchema })
    .strict()
)
export const Web3ApprovalListRequestSchema = request(
  "web3.approval.list.request",
  z.object({ status: Web3ApprovalStatusSchema.optional() }).strict()
)
export const Web3ApprovalDecideRequestSchema = request(
  "web3.approval.decide.request",
  z
    .object({
      approvalId: z.string().regex(/^approval_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
      decision: z.enum(["approved", "rejected"]),
      expectedRevision: z.number().int().positive(),
      reviewer: z.string().min(1).max(256),
    })
    .strict()
)
export const Web3AuditListRequestSchema = request(
  "web3.audit.list.request",
  z.object({ limit: z.number().int().min(1).max(500).optional() }).strict()
)
export const Web3DappSessionOpenRequestSchema = request(
  "web3.dapp.session.open.request",
  z.object({ url: dappUrlSchema }).strict()
)
export const Web3DappProviderRequestSchema = request(
  "web3.dapp.provider.request",
  walletProviderRequestSchema
)

export const WEB3_CLIENT_SCHEMAS = [
  Web3NetworkListRequestSchema,
  Web3NetworkCreateRequestSchema,
  Web3NetworkSetEnabledRequestSchema,
  Web3NetworkRemoveRequestSchema,
  Web3NetworkReorderRequestSchema,
  Web3EndpointAddRequestSchema,
  Web3EndpointProbeRequestSchema,
  Web3EndpointSetEnabledRequestSchema,
  Web3EndpointRemoveRequestSchema,
  Web3EndpointReorderRequestSchema,
  Web3WalletListRequestSchema,
  Web3WalletGenerateRequestSchema,
  Web3WalletDeriveRequestSchema,
  Web3WalletImportHdRequestSchema,
  Web3WalletImportPrivateKeyRequestSchema,
  Web3WalletAddWatchRequestSchema,
  Web3WalletRenameRequestSchema,
  Web3WalletReorderRequestSchema,
  Web3WalletReorderAccountsRequestSchema,
  Web3WalletDeleteRequestSchema,
  Web3WalletActiveGetRequestSchema,
  Web3WalletActiveSetRequestSchema,
  Web3WalletActiveClearRequestSchema,
  Web3WalletLockRequestSchema,
  Web3WalletUnlockRequestSchema,
  Web3PolicyListRequestSchema,
  Web3PolicyCreateRequestSchema,
  Web3PolicyUpdateRequestSchema,
  Web3PolicyDisableRequestSchema,
  Web3ApprovalListRequestSchema,
  Web3ApprovalDecideRequestSchema,
  Web3AuditListRequestSchema,
  Web3DappSessionOpenRequestSchema,
  Web3DappProviderRequestSchema,
] as const

export type Web3ClientMessage = z.infer<(typeof WEB3_CLIENT_SCHEMAS)[number]>

export const Web3NetworkListResponseSchema = response(
  "web3.network.list.response",
  z.array(Web3NetworkViewSchema)
)
export const Web3NetworkCreateResponseSchema = response(
  "web3.network.create.response",
  Web3NetworkViewSchema
)
export const Web3NetworkSetEnabledResponseSchema = response(
  "web3.network.set-enabled.response",
  networkDefinitionSchema
)
export const Web3NetworkRemoveResponseSchema = response(
  "web3.network.remove.response",
  completedSchema
)
export const Web3NetworkReorderResponseSchema = response(
  "web3.network.reorder.response",
  completedSchema
)
export const Web3EndpointAddResponseSchema = response(
  "web3.endpoint.add.response",
  rpcEndpointViewSchema
)
export const Web3EndpointProbeResponseSchema = response(
  "web3.endpoint.probe.response",
  rpcEndpointHealthSchema
)
export const Web3EndpointSetEnabledResponseSchema = response(
  "web3.endpoint.set-enabled.response",
  rpcEndpointViewSchema
)
export const Web3EndpointRemoveResponseSchema = response(
  "web3.endpoint.remove.response",
  completedSchema
)
export const Web3EndpointReorderResponseSchema = response(
  "web3.endpoint.reorder.response",
  completedSchema
)
export const Web3WalletListResponseSchema = response(
  "web3.wallet.list.response",
  z.array(walletViewSchema)
)
export const Web3WalletGenerateResponseSchema = response(
  "web3.wallet.generate.response",
  walletViewSchema
)
export const Web3WalletDeriveResponseSchema = response(
  "web3.wallet.derive.response",
  walletViewSchema
)
export const Web3WalletImportHdResponseSchema = response(
  "web3.wallet.import-hd.response",
  walletViewSchema
)
export const Web3WalletImportPrivateKeyResponseSchema = response(
  "web3.wallet.import-private-key.response",
  walletViewSchema
)
export const Web3WalletAddWatchResponseSchema = response(
  "web3.wallet.add-watch.response",
  walletViewSchema
)
export const Web3WalletRenameResponseSchema = response(
  "web3.wallet.rename.response",
  walletViewSchema
)
export const Web3WalletReorderResponseSchema = response(
  "web3.wallet.reorder.response",
  completedSchema
)
export const Web3WalletReorderAccountsResponseSchema = response(
  "web3.wallet.reorder-accounts.response",
  completedSchema
)
export const Web3WalletDeleteResponseSchema = response(
  "web3.wallet.delete.response",
  completedSchema
)
export const Web3WalletActiveGetResponseSchema = response(
  "web3.wallet.active.get.response",
  Web3WalletActiveContextSchema
)
export const Web3WalletActiveSetResponseSchema = response(
  "web3.wallet.active.set.response",
  Web3WalletActiveContextSchema
)
export const Web3WalletActiveClearResponseSchema = response(
  "web3.wallet.active.clear.response",
  completedSchema
)
export const Web3WalletLockResponseSchema = response(
  "web3.wallet.lock.response",
  z.object({ unlocked: z.literal(false), walletId: walletIdSchema }).strict()
)
export const Web3WalletUnlockResponseSchema = response(
  "web3.wallet.unlock.response",
  z.object({ unlocked: z.literal(true), walletId: walletIdSchema }).strict()
)
export const Web3PolicyListResponseSchema = response(
  "web3.policy.list.response",
  z.array(Web3SigningPolicyRecordSchema)
)
export const Web3PolicyCreateResponseSchema = response(
  "web3.policy.create.response",
  Web3SigningPolicyRecordSchema
)
export const Web3PolicyUpdateResponseSchema = response(
  "web3.policy.update.response",
  Web3SigningPolicyRecordSchema
)
export const Web3PolicyDisableResponseSchema = response(
  "web3.policy.disable.response",
  Web3SigningPolicyRecordSchema
)
export const Web3ApprovalListResponseSchema = response(
  "web3.approval.list.response",
  z.array(Web3ApprovalViewSchema)
)
export const Web3ApprovalDecideResponseSchema = response(
  "web3.approval.decide.response",
  Web3ApprovalViewSchema
)
export const Web3AuditListResponseSchema = response(
  "web3.audit.list.response",
  z.array(Web3AuditRecordSchema)
)
export const Web3DappSessionOpenResponseSchema = response(
  "web3.dapp.session.open.response",
  dappSessionSchema
)
export const Web3DappProviderResponseSchema = response(
  "web3.dapp.provider.response",
  walletProviderResponseSchema
)

export const WEB3_SERVER_SCHEMAS = [
  Web3NetworkListResponseSchema,
  Web3NetworkCreateResponseSchema,
  Web3NetworkSetEnabledResponseSchema,
  Web3NetworkRemoveResponseSchema,
  Web3NetworkReorderResponseSchema,
  Web3EndpointAddResponseSchema,
  Web3EndpointProbeResponseSchema,
  Web3EndpointSetEnabledResponseSchema,
  Web3EndpointRemoveResponseSchema,
  Web3EndpointReorderResponseSchema,
  Web3WalletListResponseSchema,
  Web3WalletGenerateResponseSchema,
  Web3WalletDeriveResponseSchema,
  Web3WalletImportHdResponseSchema,
  Web3WalletImportPrivateKeyResponseSchema,
  Web3WalletAddWatchResponseSchema,
  Web3WalletRenameResponseSchema,
  Web3WalletReorderResponseSchema,
  Web3WalletReorderAccountsResponseSchema,
  Web3WalletDeleteResponseSchema,
  Web3WalletActiveGetResponseSchema,
  Web3WalletActiveSetResponseSchema,
  Web3WalletActiveClearResponseSchema,
  Web3WalletLockResponseSchema,
  Web3WalletUnlockResponseSchema,
  Web3PolicyListResponseSchema,
  Web3PolicyCreateResponseSchema,
  Web3PolicyUpdateResponseSchema,
  Web3PolicyDisableResponseSchema,
  Web3ApprovalListResponseSchema,
  Web3ApprovalDecideResponseSchema,
  Web3AuditListResponseSchema,
  Web3DappSessionOpenResponseSchema,
  Web3DappProviderResponseSchema,
] as const

export type Web3ServerMessage = z.infer<(typeof WEB3_SERVER_SCHEMAS)[number]>
export const WEB3_RESPONSE_TYPES = WEB3_SERVER_SCHEMAS.map((schema) => schema.shape.type.value)
