import {
  SigningPolicyObjectSchema,
  SigningPolicySchema,
  signingPolicyIdSchema,
} from "@cypheria/policy-engine"
import {
  chainAccountIdSchema,
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
export const WalletIdInputSchema = z.object({ walletId: walletIdSchema }).strict()
export const WalletGenerateHdInputSchema = z
  .object({
    accountName: nameSchema.optional(),
    name: nameSchema,
    passphrase: z.string().max(1024).optional(),
    strength: z.union([z.literal(128), z.literal(256)]).optional(),
  })
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
export const WalletActiveContextSchema = z
  .object({
    chainAccount: z
      .object({
        address: z.string(),
        chainId: z.union([z.number(), z.string()]),
        id: z.string(),
        namespace: z.string(),
        walletAccountId: z.string(),
      })
      .loose()
      .optional(),
    mode: z.enum(walletModes),
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
