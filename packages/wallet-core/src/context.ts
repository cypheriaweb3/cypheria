import { z } from "zod"

import {
  type ChainAccount,
  chainAccountSchema,
  type WalletAccount,
  walletAccountSchema,
} from "./account.js"
import type { ChainId, WalletAccountId, WalletId } from "./primitives.js"
import type { WalletMode } from "./signing.js"
import { type Wallet, walletSchema } from "./wallet.js"

export type RpcEndpoint = {
  readonly chainId: ChainId
  readonly headers?: Readonly<Record<string, string>>
  readonly id: string
  readonly label?: string
  readonly url: string
}

export type ChainDefinition = {
  readonly blockExplorerUrl?: string
  readonly id: ChainId
  readonly name: string
  readonly nativeCurrency: {
    readonly decimals: number
    readonly name: string
    readonly symbol: string
  }
  readonly rpcEndpoints: readonly RpcEndpoint[]
  readonly testnet?: boolean
}

export const walletAccountViewSchema = z
  .object({
    account: walletAccountSchema,
    chainAccounts: z.array(chainAccountSchema),
  })
  .strict()
export type WalletAccountView = z.infer<typeof walletAccountViewSchema>

export const walletViewSchema = z
  .object({
    accounts: z.array(walletAccountViewSchema),
    wallet: walletSchema,
  })
  .strict()
export type WalletView = z.infer<typeof walletViewSchema>

export const toWalletView = (
  wallet: Wallet,
  accounts: readonly WalletAccount[],
  chainAccounts: readonly ChainAccount[]
): WalletView =>
  walletViewSchema.parse({
    accounts: accounts
      .filter((account) => account.walletId === wallet.id)
      .sort((left, right) => left.index - right.index)
      .map((account) => ({
        account,
        chainAccounts: chainAccounts
          .filter((chainAccount) => chainAccount.walletAccountId === account.id)
          .sort((left, right) => left.chainId - right.chainId),
      })),
    wallet,
  })

export type ActiveWalletContext = {
  readonly chain?: ChainDefinition
  readonly chainAccount?: ChainAccount
  readonly mode: WalletMode
  readonly wallet?: WalletView
  readonly walletAccount?: WalletAccountView
}

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

export type WalletPermission = {
  readonly accountId: WalletAccountId
  readonly chainId: ChainId
  readonly expiresAt?: string
  readonly id: string
  readonly methods: readonly WalletPermissionMethod[]
  readonly mode: WalletMode
  readonly origin: string
  readonly walletId: WalletId
}
