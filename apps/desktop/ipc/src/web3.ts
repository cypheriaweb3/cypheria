import {
  networkDefinitionSchema,
  networkIdSchema,
  rpcEndpointHealthSchema,
  rpcEndpointIdSchema,
  rpcEndpointViewSchema,
} from "@cypheria/network-core"
import {
  SigningPolicyObjectSchema,
  SigningPolicySchema,
  signingPolicyIdSchema,
} from "@cypheria/policy-engine"
import { createNetworkInputSchema, createRpcEndpointInputSchema } from "@cypheria/runtime"
import {
  chainAccountIdSchema,
  chainAccountSchema,
  hexAddressSchema,
  walletAccountIdSchema,
  walletIdSchema,
  walletModes,
  walletViewSchema,
} from "@cypheria/wallet-core"
import { z } from "zod"

const nameSchema = z.string().trim().min(1).max(128)
const privateKeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/u)

export const WalletListSchema = z.array(walletViewSchema)
export type WalletList = z.infer<typeof WalletListSchema>
export const NetworkViewSchema = z
  .object({ network: networkDefinitionSchema, endpoints: z.array(rpcEndpointViewSchema) })
  .strict()
export const NetworkListSchema = z.array(NetworkViewSchema)
export type NetworkList = z.infer<typeof NetworkListSchema>
export const NetworkCreateInputSchema = createNetworkInputSchema
export const NetworkSetEnabledInputSchema = z
  .object({
    enabled: z.boolean(),
    expectedRevision: z.number().int().positive(),
    networkId: networkIdSchema,
  })
  .strict()
export const NetworkRemoveInputSchema = z
  .object({ confirmed: z.boolean(), networkId: networkIdSchema })
  .strict()
export const NetworkReorderInputSchema = z.object({ networkIds: z.array(networkIdSchema) }).strict()
export const NetworkEndpointAddInputSchema = z
  .object({ endpoint: createRpcEndpointInputSchema, networkId: networkIdSchema })
  .strict()
export const NetworkEndpointSetEnabledInputSchema = z
  .object({
    enabled: z.boolean(),
    endpointId: rpcEndpointIdSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict()
export const NetworkEndpointIdInputSchema = z.object({ endpointId: rpcEndpointIdSchema }).strict()
export const NetworkEndpointReorderInputSchema = z
  .object({ endpointIds: z.array(rpcEndpointIdSchema), networkId: networkIdSchema })
  .strict()
export const NetworkMutationResultSchema = z.object({ completed: z.boolean() }).strict()
export { rpcEndpointHealthSchema as NetworkEndpointHealthSchema }
export const WalletIdInputSchema = z.object({ walletId: walletIdSchema }).strict()
export const WalletGenerateHdInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    name: nameSchema,
    passphrase: z.string().max(1024).optional(),
    strength: z.union([z.literal(128), z.literal(256)]).optional(),
  })
  .strict()
export const WalletDeriveHdAccountInputSchema = z
  .object({ name: nameSchema.optional(), walletId: walletIdSchema })
  .strict()
export const WalletImportHdInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    expectedAddress: hexAddressSchema.optional(),
    mnemonic: z.string().trim().min(1),
    name: nameSchema,
    passphrase: z.string().max(1024).optional(),
  })
  .strict()
export const WalletImportPrivateKeyInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    expectedAddress: hexAddressSchema.optional(),
    name: nameSchema,
    privateKey: privateKeySchema,
  })
  .strict()
export const WalletAddWatchInputSchema = z
  .object({ accountName: nameSchema.optional(), address: hexAddressSchema, name: nameSchema })
  .strict()
export const WalletRenameInputSchema = z
  .object({ name: nameSchema, walletId: walletIdSchema })
  .strict()
export const WalletReorderInputSchema = z.object({ walletIds: z.array(walletIdSchema) }).strict()
export const WalletReorderAccountsInputSchema = z
  .object({ walletAccountIds: z.array(walletAccountIdSchema), walletId: walletIdSchema })
  .strict()
export const WalletActiveContextSchema = z
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
export type WalletActiveContext = z.infer<typeof WalletActiveContextSchema>
export const WalletSetActiveInputSchema = z
  .object({
    chainAccountId: chainAccountIdSchema,
    mode: z.enum(walletModes),
    networkId: networkIdSchema,
    walletAccountId: walletAccountIdSchema,
    walletId: walletIdSchema,
  })
  .strict()
export const WalletVaultStateSchema = z
  .object({ unlocked: z.boolean(), walletId: walletIdSchema })
  .strict()

export const SigningPolicyRecordSchema = z
  .object({
    createdAt: z.iso.datetime(),
    policy: SigningPolicySchema,
    revision: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
export type SigningPolicyRecordView = z.infer<typeof SigningPolicyRecordSchema>
export const SigningPolicyListInputSchema = z
  .object({ enabled: z.boolean().optional(), walletId: walletIdSchema.optional() })
  .strict()
export const SigningPolicyCreateInputSchema = SigningPolicyObjectSchema.omit({ id: true })
  .extend({ id: signingPolicyIdSchema.optional() })
  .strict()
export const SigningPolicyUpdateInputSchema = SigningPolicyObjectSchema.omit({
  id: true,
  walletId: true,
})
  .partial()
  .extend({ expectedRevision: z.number().int().positive(), policyId: signingPolicyIdSchema })
  .strict()
export const SigningPolicyDisableInputSchema = z
  .object({ expectedRevision: z.number().int().positive(), policyId: signingPolicyIdSchema })
  .strict()

export const AuditLogRecordSchema = z
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
export type AuditLogRecordView = z.infer<typeof AuditLogRecordSchema>
export const AuditLogListInputSchema = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict()
