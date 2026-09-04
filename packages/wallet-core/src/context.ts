import {
  type ChainKey,
  type NetworkDefinition,
  type NetworkId,
  toChainKey,
} from "@cypheria/network-core"
import { z } from "zod"

import {
  type ChainAccount,
  chainAccountSchema,
  type WalletAccount,
  walletAccountSchema,
} from "./account.js"
import type { WalletAccountId, WalletId } from "./primitives.js"
import type { WalletMode } from "./signing.js"
import { type Wallet, walletSchema } from "./wallet.js"

/** Renderer-safe logical account together with its chain-specific identities. */
export const walletAccountViewSchema = z
  .object({
    account: walletAccountSchema,
    chainAccounts: z.array(chainAccountSchema),
  })
  .strict()
export type WalletAccountView = z.infer<typeof walletAccountViewSchema>

/** Renderer-safe wallet graph containing public data only. */
export const walletViewSchema = z
  .object({
    wallet: walletSchema,
    accounts: z.array(walletAccountViewSchema),
  })
  .strict()
export type WalletView = z.infer<typeof walletViewSchema>

/**
 * Builds a deterministic public projection. Unrelated records are ignored, account
 * ordering follows the persisted display index, and chain identities sort by canonical key.
 */
export const toWalletView = (
  wallet: Wallet,
  accounts: readonly WalletAccount[],
  chainAccounts: readonly ChainAccount[]
): WalletView =>
  // Re-parsing rejects accidental secret or otherwise unknown properties before IPC.
  walletViewSchema.parse({
    wallet,
    accounts: accounts
      .filter((account) => account.walletId === wallet.id)
      .sort((left, right) => left.index - right.index)
      .map((account) => ({
        account,
        chainAccounts: chainAccounts
          .filter((chainAccount) => chainAccount.walletAccountId === account.id)
          .sort((left, right) => toChainKey(left.chain).localeCompare(toChainKey(right.chain))),
      })),
  })

/**
 * Current user selection. Related entities are optional so an empty selection and
 * partially unavailable chain configuration can be represented without fake IDs.
 */
export type ActiveWalletContext = {
  readonly wallet?: WalletView
  readonly walletAccount?: WalletAccountView
  readonly network?: NetworkDefinition
  readonly chainAccount?: ChainAccount
  readonly mode: WalletMode
}

/** Ethereum methods that may be granted to a dApp origin. */
export const walletPermissionMethods = [
  "eth_accounts",
  "eth_chainId",
  "eth_requestAccounts",
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "personal_sign",
  "wallet_addEthereumChain",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
] as const
export type WalletPermissionMethod = (typeof walletPermissionMethods)[number]

/**
 * Origin-scoped authorization metadata. A permission never bypasses signing policy;
 * it only records which wallet methods and public account may be requested.
 */
export type WalletPermission = {
  readonly id: string
  readonly origin: string
  readonly walletId: WalletId
  readonly accountId: WalletAccountId
  readonly chainKey: ChainKey
  readonly networkId: NetworkId
  readonly methods: readonly WalletPermissionMethod[]
  readonly mode: WalletMode
  readonly expiresAt?: string
}
