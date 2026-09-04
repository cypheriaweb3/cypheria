import {
  type SolanaSigningAccountRef,
  solanaSigningAccountRefSchema,
  type WalletId,
  type WalletMode,
  walletIdSchema,
  walletModes,
} from "@cypheria/wallet-core"
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionInput,
  SolanaSignMessage,
  type SolanaSignMessageInput,
  SolanaSignTransaction,
  type SolanaSignTransactionInput,
  type SolanaTransactionVersion,
} from "@solana/wallet-standard-features"
import type { IdentifierString, Wallet, WalletAccount, WalletIcon } from "@wallet-standard/base"
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardEventsChangeProperties,
} from "@wallet-standard/features"
import { ReadonlyWalletAccount, registerWallet } from "@wallet-standard/wallet"
import bs58 from "bs58"
import { z } from "zod"

import { base64Schema, base64ToBytes, bytesToBase64, jsonRpcValueSchema } from "./json-rpc.js"
import {
  createDappSessionKey,
  type DappSessionKey,
  dappSessionKeySchema,
  normalizeDappOrigin,
} from "./session.js"

export {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
}

export const solanaWalletFeatureNames = [
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
] as const

export type SolanaWalletAccountDescriptor = {
  readonly address: string
  readonly chains: readonly IdentifierString[]
  readonly features: readonly IdentifierString[]
  readonly icon?: WalletIcon
  readonly label?: string
  readonly publicKey: string
}

const identifierSchema = z
  .string()
  .regex(/^[a-z0-9]+:[A-Za-z0-9][A-Za-z0-9._-]*$/u)
  .transform((value) => value as IdentifierString)
const walletIconSchema = z
  .string()
  .max(350_000)
  .regex(/^data:image\/(?:webp|png|gif);base64,[A-Za-z0-9+/]+={0,2}$/u)
export const solanaWalletAccountDescriptorSchema = z
  .object({
    address: z.string().min(32).max(44),
    chains: z.array(identifierSchema).min(1).max(32),
    features: z.array(identifierSchema).min(1).max(32),
    icon: walletIconSchema.optional(),
    label: z.string().min(1).max(128).optional(),
    publicKey: base64Schema,
  })
  .strict()
  .superRefine((account, context) => {
    if (new Set(account.chains).size !== account.chains.length) {
      context.addIssue({ code: "custom", message: "Solana account chains must be unique." })
    }
    if (new Set(account.features).size !== account.features.length) {
      context.addIssue({ code: "custom", message: "Solana account features must be unique." })
    }
    try {
      const publicKey = base64ToBytes(account.publicKey)
      if (publicKey.length !== 32 || bs58.encode(publicKey) !== account.address) {
        context.addIssue({
          code: "custom",
          message: "The Solana account address does not match its 32-byte public key.",
        })
      }
    } catch {
      context.addIssue({ code: "custom", message: "The Solana account public key is invalid." })
    }
  })

const accountDescriptorSchema = solanaWalletAccountDescriptorSchema

export type SolanaProviderPermissionBinding = {
  readonly account: SolanaWalletAccountDescriptor
  readonly mode: WalletMode
  readonly signingAccount: SolanaSigningAccountRef
}

export type SolanaProviderPermissionRecord = {
  readonly bindings: readonly SolanaProviderPermissionBinding[]
  readonly createdAt: string
  readonly expiresAt?: string
  readonly id: string
  readonly origin: string
  readonly sessionKey: DappSessionKey
  readonly updatedAt: string
  readonly walletId: WalletId
}

const solanaProviderPermissionBindingSchema = z
  .object({
    account: accountDescriptorSchema,
    mode: z.enum(walletModes),
    signingAccount: solanaSigningAccountRefSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      binding.account.address !== binding.signingAccount.address ||
      binding.account.publicKey !== binding.signingAccount.publicKey ||
      !binding.account.chains.includes(binding.signingAccount.chainKey as IdentifierString)
    ) {
      context.addIssue({
        code: "custom",
        message: "The Solana permission binding is inconsistent.",
      })
    }
  })

export const solanaProviderPermissionRecordSchema = z
  .object({
    bindings: z.array(solanaProviderPermissionBindingSchema).min(1).max(32),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().optional(),
    id: z
      .string()
      .max(128)
      .regex(/^solana_permission_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    origin: z.string().transform(normalizeDappOrigin),
    sessionKey: dappSessionKeySchema,
    updatedAt: z.iso.datetime(),
    walletId: walletIdSchema,
  })
  .strict()
  .superRefine((permission, context) => {
    if (permission.sessionKey !== createDappSessionKey(permission.origin)) {
      context.addIssue({ code: "custom", message: "The permission session scope is inconsistent." })
    }
    if (
      permission.bindings.some((binding) => binding.signingAccount.walletId !== permission.walletId)
    ) {
      context.addIssue({ code: "custom", message: "The Solana permission wallet is inconsistent." })
    }
    const keys = permission.bindings.map(
      (binding) => `${binding.account.address}:${binding.signingAccount.chainKey}`
    )
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Solana permission bindings must be unique." })
    }
  })

export type SolanaProviderPersistence = {
  readonly deleteSolanaPermission: (permissionId: string) => Promise<boolean>
  readonly listSolanaPermissions: (origin: string) => Promise<SolanaProviderPermissionRecord[]>
  readonly saveSolanaPermission: (
    permission: SolanaProviderPermissionRecord
  ) => Promise<SolanaProviderPermissionRecord>
}

const nonEmptyBase64Schema = base64Schema.refine(
  (value) => base64ToBytes(value).length > 0,
  "Encoded bytes must not be empty."
)
const transactionBase64Schema = nonEmptyBase64Schema.refine(
  (value) => base64ToBytes(value).length <= 1232,
  "A serialized Solana transaction must not exceed 1232 bytes."
)
const messageBase64Schema = nonEmptyBase64Schema.refine(
  (value) => base64ToBytes(value).length <= 65_536,
  "A Solana message must not exceed 65536 bytes."
)
const signatureBase64Schema = base64Schema.refine(
  (value) => base64ToBytes(value).length === 64,
  "An Ed25519 signature must be exactly 64 bytes."
)

const parseAccount = (
  value: SolanaWalletAccountDescriptor,
  walletChains: readonly IdentifierString[]
): ReadonlyWalletAccount => {
  const descriptor = accountDescriptorSchema.parse(value) as SolanaWalletAccountDescriptor
  const publicKey = base64ToBytes(descriptor.publicKey)
  if (publicKey.length !== 32 || bs58.encode(publicKey) !== descriptor.address) {
    throw new TypeError("The Solana account address does not match its 32-byte public key.")
  }
  if (descriptor.chains.some((chain) => !walletChains.includes(chain))) {
    throw new TypeError("A Solana account declares a chain unsupported by the wallet.")
  }
  if (descriptor.features.some((feature) => !solanaWalletFeatureNames.includes(feature as never))) {
    throw new TypeError("A Solana account declares an unsupported feature.")
  }
  return new ReadonlyWalletAccount({
    ...descriptor,
    icon: descriptor.icon as WalletIcon | undefined,
    publicKey,
  })
}

const accountToDescriptor = (account: WalletAccount): SolanaWalletAccountDescriptor => ({
  address: account.address,
  chains: account.chains,
  features: account.features,
  ...(account.icon ? { icon: account.icon } : {}),
  ...(account.label ? { label: account.label } : {}),
  publicKey: bytesToBase64(account.publicKey),
})

const transactionOptionsSchema = z
  .object({
    minContextSlot: z.number().int().nonnegative().optional(),
    preflightCommitment: z.enum(["processed", "confirmed", "finalized"]).optional(),
  })
  .strict()

const signAndSendOptionsSchema = transactionOptionsSchema.extend({
  commitment: z.enum(["processed", "confirmed", "finalized"]).optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  skipPreflight: z.boolean().optional(),
})

const requestBase = {
  id: z.string().min(1).max(128),
  origin: z.string().transform(normalizeDappOrigin),
  sessionKey: dappSessionKeySchema,
}

export const solanaProviderRequestSchema = z
  .discriminatedUnion("method", [
    z
      .object({
        ...requestBase,
        input: z.object({ silent: z.boolean().optional() }).strict(),
        method: z.literal(StandardConnect),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        input: z.object({}).strict(),
        method: z.literal(StandardDisconnect),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        input: z
          .array(
            z.object({ account: accountDescriptorSchema, message: messageBase64Schema }).strict()
          )
          .min(1)
          .max(32),
        method: z.literal(SolanaSignMessage),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        input: z
          .array(
            z
              .object({
                account: accountDescriptorSchema,
                chain: identifierSchema.optional(),
                options: transactionOptionsSchema.optional(),
                transaction: transactionBase64Schema,
              })
              .strict()
          )
          .min(1)
          .max(32),
        method: z.literal(SolanaSignTransaction),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        input: z
          .array(
            z
              .object({
                account: accountDescriptorSchema,
                chain: identifierSchema,
                options: signAndSendOptionsSchema.optional(),
                transaction: transactionBase64Schema,
              })
              .strict()
          )
          .min(1)
          .max(32),
        method: z.literal(SolanaSignAndSendTransaction),
      })
      .strict(),
  ])
  .superRefine((request, context) => {
    if (request.sessionKey !== createDappSessionKey(request.origin)) {
      context.addIssue({ code: "custom", message: "The provider request scope is inconsistent." })
    }
  })

export type SolanaProviderRequest = z.output<typeof solanaProviderRequestSchema>

export const solanaProviderResponseSchema = z.union([
  z
    .object({
      error: z
        .object({
          code: z.number().int(),
          data: jsonRpcValueSchema.optional(),
          message: z.string().min(1).max(1024),
        })
        .strict(),
      id: z.string().min(1).max(128),
    })
    .strict(),
  z.object({ id: z.string().min(1).max(128), result: jsonRpcValueSchema }).strict(),
])
export type SolanaProviderResponse = z.output<typeof solanaProviderResponseSchema>
export type SolanaProviderTransport = (
  request: SolanaProviderRequest
) => Promise<SolanaProviderResponse> | SolanaProviderResponse

export class SolanaWalletProviderError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(error: { readonly code: number; readonly data?: unknown; readonly message: string }) {
    super(error.message)
    this.name = "SolanaWalletProviderError"
    this.code = error.code
    this.data = error.data
  }
}

type SolanaWalletFeatures = {
  readonly [StandardConnect]: {
    readonly connect: (input?: {
      readonly silent?: boolean
    }) => Promise<{ readonly accounts: readonly WalletAccount[] }>
    readonly version: "1.0.0"
  }
  readonly [StandardDisconnect]: {
    readonly disconnect: () => Promise<void>
    readonly version: "1.0.0"
  }
  readonly [StandardEvents]: {
    readonly on: (
      event: "change",
      listener: (properties: StandardEventsChangeProperties) => void
    ) => () => void
    readonly version: "1.0.0"
  }
  readonly [SolanaSignMessage]: {
    readonly signMessage: (...inputs: readonly SolanaSignMessageInput[]) => Promise<
      readonly {
        readonly signature: Uint8Array
        readonly signedMessage: Uint8Array
        readonly signatureType?: "ed25519"
      }[]
    >
    readonly version: "1.1.0"
  }
  readonly [SolanaSignTransaction]: {
    readonly signTransaction: (
      ...inputs: readonly SolanaSignTransactionInput[]
    ) => Promise<readonly { readonly signedTransaction: Uint8Array }[]>
    readonly supportedTransactionVersions: readonly SolanaTransactionVersion[]
    readonly version: "1.0.0"
  }
  readonly [SolanaSignAndSendTransaction]: {
    readonly signAndSendTransaction: (
      ...inputs: readonly SolanaSignAndSendTransactionInput[]
    ) => Promise<readonly { readonly signature: Uint8Array }[]>
    readonly supportedTransactionVersions: readonly SolanaTransactionVersion[]
    readonly version: "1.0.0"
  }
}

export type CypheriaSolanaWallet = Omit<Wallet, "features"> & {
  readonly features: SolanaWalletFeatures
}

export type SolanaWalletController = {
  readonly setAccounts: (accounts: readonly SolanaWalletAccountDescriptor[]) => void
  readonly wallet: CypheriaSolanaWallet
}

export type SolanaWalletOptions = {
  readonly accounts?: readonly SolanaWalletAccountDescriptor[]
  readonly chains: readonly IdentifierString[]
  readonly icon: WalletIcon
  readonly name: string
  readonly origin: string
  readonly sessionKey?: DappSessionKey
  readonly supportedTransactionVersions?: readonly SolanaTransactionVersion[]
  readonly transport: SolanaProviderTransport
}

export const createSolanaWallet = (options: SolanaWalletOptions): SolanaWalletController => {
  if (!options.name.trim()) throw new TypeError("Wallet name must not be empty.")
  walletIconSchema.parse(options.icon)
  const chains = Object.freeze([
    ...new Set(options.chains.map((chain) => identifierSchema.parse(chain))),
  ])
  if (chains.length === 0 || chains.some((chain) => !chain.startsWith("solana:"))) {
    throw new TypeError("A Solana wallet must declare at least one solana: chain.")
  }
  const origin = normalizeDappOrigin(options.origin)
  const sessionKey = options.sessionKey ?? createDappSessionKey(origin)
  const versions = Object.freeze(
    z
      .array(z.union([z.literal("legacy"), z.literal(0)]))
      .min(1)
      .refine(
        (value) => new Set(value).size === value.length,
        "Transaction versions must be unique."
      )
      .parse(options.supportedTransactionVersions ?? ["legacy", 0])
  )
  let accounts = Object.freeze(
    (options.accounts ?? []).map((account) => parseAccount(account, chains))
  )
  const listeners = new Set<(properties: StandardEventsChangeProperties) => void>()
  let nextId = 1

  const invoke = async (
    method: SolanaProviderRequest["method"],
    input: unknown
  ): Promise<unknown> => {
    const request = solanaProviderRequestSchema.parse({
      id: `solana_provider_${nextId++}`,
      input,
      method,
      origin,
      sessionKey,
    }) as SolanaProviderRequest
    const response = solanaProviderResponseSchema.parse(await options.transport(request))
    if (response.id !== request.id) {
      throw new SolanaWalletProviderError({
        code: -32603,
        message: "Provider response ID mismatch.",
      })
    }
    if ("error" in response) throw new SolanaWalletProviderError(response.error)
    return response.result
  }

  const resolveAccount = (
    account: WalletAccount,
    feature: IdentifierString,
    chain?: IdentifierString
  ): WalletAccount => {
    const authorized = accounts.find(
      (candidate) =>
        candidate.address === account.address &&
        bytesToBase64(candidate.publicKey) === bytesToBase64(account.publicKey)
    )
    if (!authorized) {
      throw new SolanaWalletProviderError({ code: 4100, message: "Unauthorized Solana account." })
    }
    if (!authorized.features.includes(feature)) {
      throw new SolanaWalletProviderError({
        code: 4200,
        message: `The Solana account does not support ${feature}.`,
      })
    }
    if (chain && !authorized.chains.includes(chain)) {
      throw new SolanaWalletProviderError({
        code: 4901,
        message: `The Solana account does not support ${chain}.`,
      })
    }
    return authorized
  }

  const assertOutputCount = (inputs: readonly unknown[], outputs: readonly unknown[]): void => {
    if (inputs.length !== outputs.length) {
      throw new SolanaWalletProviderError({
        code: -32603,
        message: "Solana provider output count does not match its input count.",
      })
    }
  }

  const setAccounts = (values: readonly SolanaWalletAccountDescriptor[]): void => {
    accounts = Object.freeze(values.map((account) => parseAccount(account, chains)))
    const properties = Object.freeze({ accounts })
    for (const listener of [...listeners]) listener(properties)
  }

  const features: SolanaWalletFeatures = Object.freeze({
    [StandardConnect]: Object.freeze({
      connect: async (input?: { readonly silent?: boolean }) => {
        const result = z
          .object({ accounts: z.array(accountDescriptorSchema) })
          .strict()
          .parse(
            await invoke(StandardConnect, {
              ...(input?.silent === undefined ? {} : { silent: input.silent }),
            })
          )
        setAccounts(result.accounts as SolanaWalletAccountDescriptor[])
        return { accounts }
      },
      version: "1.0.0" as const,
    }),
    [StandardDisconnect]: Object.freeze({
      disconnect: async () => {
        z.null().parse(await invoke(StandardDisconnect, {}))
        setAccounts([])
      },
      version: "1.0.0" as const,
    }),
    [StandardEvents]: Object.freeze({
      on: (event: "change", listener: (properties: StandardEventsChangeProperties) => void) => {
        if (event !== "change" || typeof listener !== "function")
          throw new TypeError("Invalid Wallet Standard event listener.")
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      version: "1.0.0" as const,
    }),
    [SolanaSignMessage]: Object.freeze({
      signMessage: async (...inputs: readonly SolanaSignMessageInput[]) => {
        const result = z
          .array(
            z
              .object({
                signature: signatureBase64Schema,
                signedMessage: messageBase64Schema,
                signatureType: z.literal("ed25519").optional(),
              })
              .strict()
          )
          .parse(
            await invoke(
              SolanaSignMessage,
              inputs.map((input) => ({
                account: accountToDescriptor(resolveAccount(input.account, SolanaSignMessage)),
                message: bytesToBase64(input.message),
              }))
            )
          )
        assertOutputCount(inputs, result)
        return result.map((output) => ({
          signature: base64ToBytes(output.signature),
          signedMessage: base64ToBytes(output.signedMessage),
          ...(output.signatureType ? { signatureType: output.signatureType } : {}),
        }))
      },
      version: "1.1.0" as const,
    }),
    [SolanaSignTransaction]: Object.freeze({
      signTransaction: async (...inputs: readonly SolanaSignTransactionInput[]) => {
        const result = z
          .array(z.object({ signedTransaction: transactionBase64Schema }).strict())
          .parse(
            await invoke(
              SolanaSignTransaction,
              inputs.map((input) => ({
                account: accountToDescriptor(
                  resolveAccount(input.account, SolanaSignTransaction, input.chain)
                ),
                ...(input.chain ? { chain: input.chain } : {}),
                ...(input.options ? { options: input.options } : {}),
                transaction: bytesToBase64(input.transaction),
              }))
            )
          )
        assertOutputCount(inputs, result)
        return result.map((output) => ({
          signedTransaction: base64ToBytes(output.signedTransaction),
        }))
      },
      supportedTransactionVersions: versions,
      version: "1.0.0" as const,
    }),
    [SolanaSignAndSendTransaction]: Object.freeze({
      signAndSendTransaction: async (...inputs: readonly SolanaSignAndSendTransactionInput[]) => {
        const result = z.array(z.object({ signature: signatureBase64Schema }).strict()).parse(
          await invoke(
            SolanaSignAndSendTransaction,
            inputs.map((input) => ({
              account: accountToDescriptor(
                resolveAccount(input.account, SolanaSignAndSendTransaction, input.chain)
              ),
              chain: input.chain,
              ...(input.options ? { options: input.options } : {}),
              transaction: bytesToBase64(input.transaction),
            }))
          )
        )
        assertOutputCount(inputs, result)
        return result.map((output) => ({ signature: base64ToBytes(output.signature) }))
      },
      supportedTransactionVersions: versions,
      version: "1.0.0" as const,
    }),
  })

  const wallet: CypheriaSolanaWallet = Object.freeze({
    get accounts() {
      return accounts
    },
    chains,
    features,
    icon: options.icon,
    name: options.name,
    version: "1.0.0" as const,
  })
  return { setAccounts, wallet }
}

export const registerSolanaWallet = (wallet: CypheriaSolanaWallet): void => registerWallet(wallet)

/**
 * Registers a context-bridged wallet in the page's main world. It is self-contained so Electron
 * can serialize it for `contextBridge.executeInMainWorld` without module closure access.
 */
export const installSolanaWalletInMainWorld = (bridgeGlobal = "cypheriaSolana"): void => {
  type PageBridge = CypheriaSolanaWallet
  const page = globalThis as typeof globalThis & Record<string, unknown>
  const bridge = page[bridgeGlobal] as PageBridge | undefined
  if (!bridge) throw new Error(`Missing injected Solana wallet bridge: ${bridgeGlobal}`)

  let accounts: readonly WalletAccount[] = Object.freeze([])
  const listeners = new Set<(properties: StandardEventsChangeProperties) => void>()
  const copyAccount = (account: WalletAccount): WalletAccount =>
    Object.freeze({
      address: account.address,
      chains: Object.freeze([...account.chains]),
      features: Object.freeze([...account.features]),
      ...(account.icon ? { icon: account.icon } : {}),
      ...(account.label ? { label: account.label } : {}),
      publicKey: new Uint8Array(account.publicKey),
    })
  const setAccounts = (values: readonly WalletAccount[]): readonly WalletAccount[] => {
    accounts = Object.freeze(values.map(copyAccount))
    const change = Object.freeze({ accounts })
    for (const listener of [...listeners]) listener(change)
    return accounts
  }
  Object.defineProperty(page, "__cypheriaSolanaSetAccounts", {
    configurable: true,
    enumerable: false,
    value: setAccounts,
    writable: false,
  })

  const features = {
    "standard:connect": Object.freeze({
      connect: async (input?: { readonly silent?: boolean }) => {
        const output = await bridge.features["standard:connect"].connect(input)
        return { accounts: setAccounts(output.accounts) }
      },
      version: "1.0.0" as const,
    }),
    "standard:disconnect": Object.freeze({
      disconnect: async () => {
        await bridge.features["standard:disconnect"].disconnect()
        setAccounts([])
      },
      version: "1.0.0" as const,
    }),
    "standard:events": Object.freeze({
      on: (event: "change", listener: (properties: StandardEventsChangeProperties) => void) => {
        if (event !== "change" || typeof listener !== "function") {
          throw new TypeError("Invalid Wallet Standard event listener.")
        }
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      version: "1.0.0" as const,
    }),
    "solana:signAndSendTransaction": bridge.features["solana:signAndSendTransaction"],
    "solana:signMessage": bridge.features["solana:signMessage"],
    "solana:signTransaction": bridge.features["solana:signTransaction"],
  }
  const wallet = Object.freeze({
    get accounts() {
      return accounts
    },
    chains: Object.freeze([...bridge.chains]),
    features: Object.freeze(features),
    icon: bridge.icon,
    name: bridge.name,
    version: "1.0.0" as const,
  })

  const callback = ({ register }: { register: (walletValue: Wallet) => () => void }): void => {
    register(wallet)
  }
  class RegisterWalletEvent extends Event {
    readonly detail = callback
    override preventDefault(): never {
      throw new Error("preventDefault cannot be called")
    }
    override stopImmediatePropagation(): never {
      throw new Error("stopImmediatePropagation cannot be called")
    }
    override stopPropagation(): never {
      throw new Error("stopPropagation cannot be called")
    }
  }
  globalThis.dispatchEvent(new RegisterWalletEvent("wallet-standard:register-wallet"))
  globalThis.addEventListener("wallet-standard:app-ready", (event) => {
    callback((event as CustomEvent<{ register: (walletValue: Wallet) => () => void }>).detail)
  })
}

/** Intended for Electron's `contextBridge.executeInMainWorld`; see the installer above. */
export const updateSolanaWalletAccountsInMainWorld = (accounts: readonly WalletAccount[]): void => {
  const page = globalThis as typeof globalThis & Record<string, unknown>
  const setAccounts = page.__cypheriaSolanaSetAccounts
  if (typeof setAccounts !== "function") {
    throw new Error("The Solana Wallet Standard main-world state is not installed.")
  }
  ;(setAccounts as (values: readonly WalletAccount[]) => void)(accounts)
}
