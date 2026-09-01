import { createHash } from "node:crypto"

import type {
  AuditLogService,
  WalletPublicState,
  WalletPublicStatePersistenceService,
} from "@cypheria/db"
import type { PolicyDecision } from "@cypheria/policy-engine"
import {
  type PersonalSignIntent,
  parseSigningIntent,
  type SigningAccountRef,
  type SigningIntent,
  type SolanaSigningIntent,
  serializeSigningIntent,
  signingAccountRefSchema,
  type TransactionIntent,
  type TypedDataSignIntent,
} from "@cypheria/wallet-core"
import { entropyToMnemonic } from "@scure/bip39"
import { wordlist as english } from "@scure/bip39/wordlists/english"
import {
  getAddress,
  type Hex,
  hexToBytes,
  isHex,
  recoverTransactionAddress,
  type TransactionSerialized,
  verifyMessage,
  verifyTypedData,
} from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { z } from "zod"

import { type WalletVaultController, WalletVaultError } from "../wallet-vault/index.js"

const authorizationSchema = z
  .object({
    approvalId: z.string().min(1).optional(),
    approved: z.boolean(),
    decision: z.enum(["allow", "deny", "require-human-approval"]),
    decisionId: z.string().min(1),
    matchedPolicyId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((authorization, context) => {
    if (authorization.decision === "deny" && authorization.approved) {
      context.addIssue({ code: "custom", message: "A denied request cannot be approved." })
    }
    if (
      authorization.approved &&
      authorization.decision === "require-human-approval" &&
      !authorization.approvalId
    ) {
      context.addIssue({
        code: "custom",
        message: "Human approval requires an approval identifier.",
      })
    }
  })

export type SigningAuthorization = {
  readonly approvalId?: string
  readonly approved: boolean
  readonly decision: PolicyDecision
  readonly decisionId: string
  readonly matchedPolicyId?: string
}

export type SigningIntentAuthorizer = (
  intent: SigningIntent
) => Promise<SigningAuthorization> | SigningAuthorization

export type SigningIntentReplayGuard = {
  readonly claim: (intentId: string, payloadHash: string) => Promise<boolean> | boolean
}

export type WalletSigningCapability = {
  readonly account: SigningAccountRef
  readonly signMessage: (intent: PersonalSignIntent) => Promise<Hex>
  readonly signTransaction: (
    intent: TransactionIntent & { readonly kind: "sign-transaction" }
  ) => Promise<Hex>
  readonly signTypedData: (intent: TypedDataSignIntent) => Promise<Hex>
}

export type WalletSigningService = {
  readonly createCapability: (account: SigningAccountRef) => Promise<WalletSigningCapability>
}

export type WalletSigningServiceOptions = {
  readonly audit: Pick<AuditLogService, "append">
  readonly authorize: SigningIntentAuthorizer
  readonly persistence: Pick<WalletPublicStatePersistenceService, "get">
  readonly replayGuard: SigningIntentReplayGuard
  readonly vault: Pick<WalletVaultController, "isUnlocked" | "useAccountSecret">
}

export type WalletSigningErrorCode =
  | "ACCOUNT_MISMATCH"
  | "ADDRESS_MISMATCH"
  | "INTENT_REPLAY"
  | "INVALID_INTENT"
  | "POLICY_REJECTED"
  | "SIGNING_FAILED"
  | "VAULT_LOCKED"
  | "WALLET_NOT_FOUND"
  | "WALLET_NOT_READY"
  | "WATCH_ONLY"

export class WalletSigningError extends Error {
  readonly code: WalletSigningErrorCode

  constructor(code: WalletSigningErrorCode, message: string) {
    super(message)
    this.name = "WalletSigningError"
    this.code = code
  }
}

export const createMemorySigningIntentReplayGuard = (): SigningIntentReplayGuard => {
  const claimed = new Map<string, string>()
  return {
    claim: (intentId, payloadHash) => {
      if (claimed.has(intentId)) {
        return false
      }
      claimed.set(intentId, payloadHash)
      return true
    },
  }
}

const hashIntent = (intent: SigningIntent): string =>
  `sha256:${createHash("sha256").update(serializeSigningIntent(intent)).digest("hex")}`

const isSolanaSigningIntent = (intent: SigningIntent): intent is SolanaSigningIntent =>
  intent.kind === "solana-sign-message" ||
  intent.kind === "solana-sign-transaction" ||
  intent.kind === "solana-sign-and-send-transaction"

const accountMatches = (left: SigningAccountRef, right: SigningAccountRef): boolean =>
  left.walletId === right.walletId &&
  left.walletAccountId === right.walletAccountId &&
  left.chainAccountId === right.chainAccountId &&
  left.chainId === right.chainId &&
  getAddress(left.address) === getAddress(right.address)

const resolveAccount = (
  state: WalletPublicState,
  account: SigningAccountRef
): { chainAccount: WalletPublicState["chainAccounts"][number] } => {
  const walletAccount = state.accounts.find((item) => item.id === account.walletAccountId)
  const chainAccount = state.chainAccounts.find((item) => item.id === account.chainAccountId)
  if (
    !walletAccount ||
    walletAccount.walletId !== state.wallet.id ||
    !chainAccount ||
    chainAccount.walletAccountId !== walletAccount.id ||
    chainAccount.chainId !== account.chainId ||
    getAddress(chainAccount.address) !== getAddress(account.address)
  ) {
    throw new WalletSigningError("ACCOUNT_MISMATCH", "The signing account does not match.")
  }
  return { chainAccount }
}

export const createWalletSigningService = (
  options: WalletSigningServiceOptions
): WalletSigningService => {
  const replayGuard = options.replayGuard

  const loadLocalAccount = async (account: SigningAccountRef) => {
    const state = await options.persistence.get(account.walletId)
    if (!state) {
      throw new WalletSigningError("WALLET_NOT_FOUND", "The wallet does not exist.")
    }
    if (state.wallet.status !== "ready") {
      throw new WalletSigningError("WALLET_NOT_READY", "The wallet is not ready.")
    }
    if (!("vaultId" in state.wallet)) {
      throw new WalletSigningError("WATCH_ONLY", "A watch wallet cannot sign.")
    }
    const { chainAccount } = resolveAccount(state, account)
    return { chainAccount, state, vaultId: state.wallet.vaultId }
  }

  const appendAudit = async (
    eventType: string,
    intent: SigningIntent,
    payloadHash: string,
    summary: string
  ): Promise<void> => {
    await options.audit.append({
      actor: intent.origin ?? "runtime",
      correlationId: intent.correlationId,
      createdAt: new Date().toISOString(),
      eventType,
      payloadHash,
      payloadSummary: summary,
      source: "runtime.wallet-signing",
    })
  }

  const execute = async (boundAccount: SigningAccountRef, intentValue: unknown): Promise<Hex> => {
    let intent: PersonalSignIntent | TransactionIntent | TypedDataSignIntent
    try {
      const parsed = parseSigningIntent(intentValue)
      if (isSolanaSigningIntent(parsed)) {
        throw new WalletSigningError(
          "INVALID_INTENT",
          "The EVM wallet signing service cannot execute a Solana signing intent."
        )
      }
      intent = parsed
    } catch {
      throw new WalletSigningError("INVALID_INTENT", "The signing intent is invalid.")
    }
    if (!accountMatches(boundAccount, intent.account)) {
      throw new WalletSigningError(
        "ACCOUNT_MISMATCH",
        "The signing intent targets another account."
      )
    }

    const { chainAccount, vaultId } = await loadLocalAccount(boundAccount)
    if (!options.vault.isUnlocked(vaultId)) {
      throw new WalletSigningError("VAULT_LOCKED", "The wallet vault is locked.")
    }
    if (intent.kind === "send-transaction") {
      throw new WalletSigningError(
        "INVALID_INTENT",
        "Sending a transaction requires a separate broadcast capability."
      )
    }
    if (intent.kind === "sign-transaction" && intent.transaction.chainId !== boundAccount.chainId) {
      throw new WalletSigningError("ACCOUNT_MISMATCH", "The transaction targets another chain.")
    }

    const payloadHash = hashIntent(intent)
    let authorization: SigningAuthorization
    try {
      authorization = authorizationSchema.parse(await options.authorize(intent))
    } catch {
      await appendAudit(
        "policy.decision.failed",
        intent,
        payloadHash,
        `Policy evaluation failed for signing intent ${intent.id}.`
      )
      throw new WalletSigningError("POLICY_REJECTED", "The signing intent was not approved.")
    }
    await appendAudit(
      "policy.decision",
      intent,
      payloadHash,
      `Policy decision ${authorization.decisionId} recorded for signing intent ${intent.id}.`
    )
    if (!authorization.approved) {
      await appendAudit(
        "wallet.signature.rejected",
        intent,
        payloadHash,
        `Rejected signing intent ${intent.id}.`
      )
      throw new WalletSigningError("POLICY_REJECTED", "The signing intent was not approved.")
    }
    if (!(await replayGuard.claim(intent.id, payloadHash))) {
      throw new WalletSigningError("INTENT_REPLAY", "The signing intent was already consumed.")
    }

    try {
      const signed = await options.vault.useAccountSecret(
        vaultId,
        boundAccount.walletAccountId,
        async (secret) => {
          const localAccount =
            secret.kind === "private-key"
              ? privateKeyToAccount(secret.privateKey as Hex)
              : mnemonicToAccount(entropyToMnemonic(hexToBytes(secret.entropy as Hex), english), {
                  passphrase: secret.passphrase,
                  path: chainAccount.derivationPath as `m/44'/60'/${string}`,
                })
          if (getAddress(localAccount.address) !== getAddress(chainAccount.address)) {
            throw new WalletSigningError(
              "ADDRESS_MISMATCH",
              "The wallet secret does not match its persisted address."
            )
          }

          if (intent.kind === "personal-sign") {
            const message = isHex(intent.message) ? { raw: intent.message } : intent.message
            const signature = await localAccount.signMessage({ message })
            if (!(await verifyMessage({ address: localAccount.address, message, signature }))) {
              throw new Error("Message signature verification failed.")
            }
            return signature
          }
          if (intent.kind === "typed-data") {
            const parameters = {
              domain: intent.domain,
              message: intent.message,
              primaryType: intent.primaryType,
              types: intent.types,
            } as never
            const signature = await localAccount.signTypedData(parameters)
            if (
              !(await verifyTypedData({
                ...(parameters as object),
                address: localAccount.address,
                signature,
              } as never))
            ) {
              throw new Error("Typed-data signature verification failed.")
            }
            return signature
          }

          const serializedTransaction = await localAccount.signTransaction(intent.transaction)
          const recoveredAddress = await recoverTransactionAddress({
            serializedTransaction: serializedTransaction as TransactionSerialized,
          })
          if (getAddress(recoveredAddress) !== getAddress(localAccount.address)) {
            throw new Error("Transaction signature verification failed.")
          }
          return serializedTransaction
        }
      )
      await appendAudit(
        "wallet.signature.created",
        intent,
        payloadHash,
        `Created ${intent.kind} signature for signing intent ${intent.id}.`
      )
      return signed
    } catch (error) {
      await appendAudit(
        "wallet.signature.failed",
        intent,
        payloadHash,
        `Failed signing intent ${intent.id}.`
      ).catch(() => undefined)
      if (error instanceof WalletSigningError) {
        throw error
      }
      if (error instanceof WalletVaultError && error.code === "VAULT_LOCKED") {
        throw new WalletSigningError("VAULT_LOCKED", "The wallet vault is locked.")
      }
      throw new WalletSigningError("SIGNING_FAILED", "The signing operation failed.")
    }
  }

  return {
    createCapability: async (accountValue) => {
      const account = signingAccountRefSchema.parse(accountValue) as SigningAccountRef
      await loadLocalAccount(account)
      return {
        account,
        signMessage: (intent) => execute(account, intent),
        signTransaction: (intent) => execute(account, intent),
        signTypedData: (intent) => execute(account, intent),
      }
    },
  }
}
