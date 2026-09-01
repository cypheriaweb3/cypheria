import type { ChainId, HexAddress, WalletId, WalletPermissionMethod } from "@cypheria/wallet-core"
import { chainIdSchema, hexAddressSchema, walletIdSchema } from "@cypheria/wallet-core"
import { z } from "zod"

export type DappSessionKey = `cypheria:dapp:${string}`

export const providerMethods = [
  "eth_accounts",
  "eth_chainId",
  "eth_requestAccounts",
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "personal_sign",
  "wallet_addEthereumChain",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
] as const satisfies readonly WalletPermissionMethod[]

export type ProviderMethod = (typeof providerMethods)[number]

export type DappSession = {
  readonly createdAt: string
  readonly key: DappSessionKey
  readonly lastUsedAt?: string
  readonly origin: string
  readonly partition: string
}

export type DappPermissionRecord = {
  readonly accountAddresses: readonly HexAddress[]
  readonly chainId: ChainId
  readonly createdAt: string
  readonly expiresAt?: string
  readonly id: string
  readonly methods: readonly ProviderMethod[]
  readonly origin: string
  readonly sessionKey: DappSessionKey
  readonly updatedAt: string
  readonly walletId: WalletId
}

export type ProviderRequestId = number | string

export type ProviderRequest<TMethod extends ProviderMethod = ProviderMethod, TParams = unknown> = {
  readonly chainId?: ChainId
  readonly id: ProviderRequestId
  readonly method: TMethod
  readonly origin: string
  readonly params?: TParams
  readonly sessionKey: DappSessionKey
}

export type ProviderSuccessResponse<TResult = unknown> = {
  readonly id: ProviderRequestId
  readonly result: TResult
}

export type ProviderError = {
  readonly code: number
  readonly data?: unknown
  readonly message: string
}

export type ProviderErrorResponse = {
  readonly error: ProviderError
  readonly id: ProviderRequestId
}

export type ProviderResponse<TResult = unknown> =
  | ProviderErrorResponse
  | ProviderSuccessResponse<TResult>

export type ProviderBridgeRequestArguments<TMethod extends string = string, TParams = unknown> = {
  readonly method: TMethod
  readonly params?: TParams
}

export type ProviderBridgeTransport = (
  request: ProviderRequest
) => Promise<ProviderResponse> | ProviderResponse

export type ProviderBridgeOptions = {
  readonly chainId?: ChainId
  readonly origin: string
  readonly sessionKey?: DappSessionKey
  readonly transport: ProviderBridgeTransport
}

export type ProviderBridge = {
  readonly request: <TResult = unknown>(args: ProviderBridgeRequestArguments) => Promise<TResult>
}

export const normalizeDappOrigin = (value: string): string => {
  const url = new URL(value)
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("A dApp origin must be an HTTP(S) URL without credentials.")
  }
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"])
  if (url.protocol === "http:" && !loopbackHosts.has(url.hostname)) {
    throw new Error("A remote dApp origin must use HTTPS.")
  }
  return url.origin
}

export const dappSessionKeySchema = z.string().refine((value): value is DappSessionKey => {
  if (!value.startsWith("cypheria:dapp:")) return false
  try {
    return createDappSessionKey(value.slice("cypheria:dapp:".length)) === value
  } catch {
    return false
  }
}, "Invalid dApp session key.")

export const dappSessionSchema = z
  .object({
    createdAt: z.iso.datetime(),
    key: dappSessionKeySchema,
    lastUsedAt: z.iso.datetime().optional(),
    origin: z.string().transform(normalizeDappOrigin),
    partition: z.string().min(1),
  })
  .strict()
  .superRefine((session, context) => {
    if (
      session.key !== createDappSessionKey(session.origin) ||
      session.partition !== `persist:${session.key}`
    ) {
      context.addIssue({ code: "custom", message: "The dApp session scope is inconsistent." })
    }
  })

export const providerMethodSchema = z.enum(providerMethods)

const isJsonRpcValue = (root: unknown): boolean => {
  const pending = [root]
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const value = pending.pop()
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      continue
    }
    if (!value || typeof value !== "object" || seen.has(value)) return false
    seen.add(value)
    if (Array.isArray(value)) {
      pending.push(...value)
      continue
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    pending.push(...Object.values(value))
  }
  return true
}

export const jsonRpcValueSchema = z.unknown().refine(isJsonRpcValue, "Invalid JSON-RPC value.")
export const jsonRpcParamsSchema = z
  .unknown()
  .refine(
    (value) =>
      (Array.isArray(value) ||
        (Boolean(value) &&
          typeof value === "object" &&
          (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null))) &&
      isJsonRpcValue(value),
    "Invalid JSON-RPC parameters."
  )

export const dappPermissionRecordSchema = z
  .object({
    accountAddresses: z.array(hexAddressSchema).min(1),
    chainId: chainIdSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().optional(),
    id: z.string().regex(/^dapp_permission_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    methods: z.array(providerMethodSchema).min(1),
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
    if (new Set(permission.accountAddresses).size !== permission.accountAddresses.length) {
      context.addIssue({ code: "custom", message: "Permission accounts must be unique." })
    }
    if (new Set(permission.methods).size !== permission.methods.length) {
      context.addIssue({ code: "custom", message: "Permission methods must be unique." })
    }
  })

export const providerRequestSchema = z
  .object({
    chainId: chainIdSchema.optional(),
    id: z.union([z.number().finite(), z.string().min(1)]),
    method: providerMethodSchema,
    origin: z.string().transform(normalizeDappOrigin),
    params: jsonRpcParamsSchema.optional(),
    sessionKey: dappSessionKeySchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sessionKey !== createDappSessionKey(request.origin)) {
      context.addIssue({ code: "custom", message: "The provider request scope is inconsistent." })
    }
  })

export const providerErrorSchema = z
  .object({
    code: z.number().int(),
    data: jsonRpcValueSchema.optional(),
    message: z.string().min(1),
  })
  .strict()

export const providerResponseSchema = z.union([
  z.object({ error: providerErrorSchema, id: z.union([z.number(), z.string()]) }).strict(),
  z.object({ id: z.union([z.number(), z.string()]), result: jsonRpcValueSchema }).strict(),
])

export type DappBrowserPersistence = {
  readonly deletePermission: (permissionId: string) => Promise<boolean>
  readonly getSession: (origin: string) => Promise<DappSession | undefined>
  readonly listPermissions: (origin: string) => Promise<DappPermissionRecord[]>
  readonly savePermission: (permission: DappPermissionRecord) => Promise<DappPermissionRecord>
  readonly saveSession: (session: DappSession) => Promise<DappSession>
}

export type DappSessionManager = {
  readonly get: (origin: string) => Promise<DappSession | undefined>
  readonly open: (url: string) => Promise<DappSession>
  readonly validateRequest: (request: ProviderRequest) => Promise<DappSession>
}

export type DappSessionManagerOptions = {
  readonly now?: () => string
  readonly persistence: Pick<DappBrowserPersistence, "getSession" | "saveSession">
}

export class DappSessionError extends Error {
  readonly code: "INVALID_REQUEST_SCOPE" | "SESSION_NOT_FOUND"

  constructor(code: DappSessionError["code"], message: string) {
    super(message)
    this.name = "DappSessionError"
    this.code = code
  }
}

export const createDappSessionManager = (
  options: DappSessionManagerOptions
): DappSessionManager => {
  const now = options.now ?? (() => new Date().toISOString())
  return {
    get: (origin) => options.persistence.getSession(normalizeDappOrigin(origin)),
    open: async (url) => {
      const origin = normalizeDappOrigin(url)
      const existing = await options.persistence.getSession(origin)
      const usedAt = now()
      const session = existing
        ? dappSessionSchema.parse({ ...existing, lastUsedAt: usedAt })
        : createDappSession(origin, usedAt)
      return options.persistence.saveSession(session)
    },
    validateRequest: async (requestValue) => {
      const request = providerRequestSchema.parse(requestValue) as ProviderRequest
      const session = await options.persistence.getSession(request.origin)
      if (!session) {
        throw new DappSessionError("SESSION_NOT_FOUND", "The dApp session does not exist.")
      }
      if (session.key !== request.sessionKey || session.origin !== request.origin) {
        throw new DappSessionError(
          "INVALID_REQUEST_SCOPE",
          "The provider request does not belong to its dApp session."
        )
      }
      return session
    },
  }
}

export class ProviderRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(error: ProviderError) {
    super(error.message)
    this.name = "ProviderRpcError"
    this.code = error.code
    this.data = error.data
  }
}

export type RequestAccountsRequest = ProviderRequest<"eth_requestAccounts", readonly unknown[]>

export type SwitchEthereumChainParams = readonly [
  {
    readonly chainId: `0x${string}`
  },
]

export type SwitchEthereumChainRequest = ProviderRequest<
  "wallet_switchEthereumChain",
  SwitchEthereumChainParams
>

export type AddEthereumChainParams = readonly [
  {
    readonly blockExplorerUrls?: readonly string[]
    readonly chainId: `0x${string}`
    readonly chainName: string
    readonly nativeCurrency?: {
      readonly decimals: number
      readonly name: string
      readonly symbol: string
    }
    readonly rpcUrls: readonly string[]
  },
]

export type AddEthereumChainRequest = ProviderRequest<
  "wallet_addEthereumChain",
  AddEthereumChainParams
>

export type PersonalSignParams = readonly [string, HexAddress]
export type PersonalSignRequest = ProviderRequest<"personal_sign", PersonalSignParams>

export type SignTypedDataV4Params = readonly [HexAddress, string]
export type SignTypedDataV4Request = ProviderRequest<"eth_signTypedData_v4", SignTypedDataV4Params>

export type SendTransactionParams = readonly [
  {
    readonly data?: `0x${string}`
    readonly from: HexAddress
    readonly gas?: `0x${string}`
    readonly maxFeePerGas?: `0x${string}`
    readonly maxPriorityFeePerGas?: `0x${string}`
    readonly nonce?: `0x${string}`
    readonly to?: HexAddress
    readonly value?: `0x${string}`
  },
]

export type SendTransactionRequest = ProviderRequest<"eth_sendTransaction", SendTransactionParams>

export type KnownProviderRequest =
  | AddEthereumChainRequest
  | PersonalSignRequest
  | RequestAccountsRequest
  | SendTransactionRequest
  | SignTypedDataV4Request
  | SwitchEthereumChainRequest

export const createDappSessionKey = (origin: string): DappSessionKey =>
  `cypheria:dapp:${normalizeDappOrigin(origin)}`

export const createDappSession = (
  origin: string,
  createdAt = new Date().toISOString()
): DappSession => {
  const normalizedOrigin = normalizeDappOrigin(origin)
  const key = createDappSessionKey(normalizedOrigin)

  return {
    createdAt,
    key,
    origin: normalizedOrigin,
    partition: `persist:${key}`,
  }
}

export const isProviderMethod = (value: string): value is ProviderMethod =>
  providerMethods.includes(value as ProviderMethod)

export const createProviderRequestIdGenerator = (
  prefix = "provider"
): (() => ProviderRequestId) => {
  let nextId = 1
  return () => `${prefix}_${nextId++}`
}

export const createUnsupportedMethodError = (method: string): ProviderError => ({
  code: 4200,
  message: `Unsupported provider method: ${method}`,
})

export const createProviderBridge = (options: ProviderBridgeOptions): ProviderBridge => {
  const origin = normalizeDappOrigin(options.origin)
  const sessionKey = options.sessionKey ?? createDappSessionKey(origin)
  const nextRequestId = createProviderRequestIdGenerator()

  return {
    request: async <TResult = unknown>(args: ProviderBridgeRequestArguments): Promise<TResult> => {
      if (!isProviderMethod(args.method)) {
        throw new ProviderRpcError(createUnsupportedMethodError(args.method))
      }

      const request = providerRequestSchema.parse({
        chainId: options.chainId,
        id: nextRequestId(),
        method: args.method,
        origin,
        params: args.params,
        sessionKey,
      }) as ProviderRequest
      const response = providerResponseSchema.parse(
        await options.transport(request)
      ) as ProviderResponse

      if (response.id !== request.id) {
        throw new ProviderRpcError({ code: -32603, message: "Provider response ID mismatch." })
      }

      if ("error" in response) {
        throw new ProviderRpcError(response.error)
      }

      return response.result as TResult
    },
  }
}
