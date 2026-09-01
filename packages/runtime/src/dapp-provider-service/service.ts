import { createHash, randomUUID } from "node:crypto"

import type { AuditLogService, SigningIntentRecord } from "@cypheria/db"
import type { SigningAccountRef, WalletMode } from "@cypheria/wallet-core"
import {
  DappSessionError,
  type DappSessionManager,
  dappPermissionRecordSchema,
  type EthereumProviderPermissionRecord,
  type EthereumProviderPersistence,
  ethereumReadOnlyMethods,
  type ProviderError,
  type ProviderMethod,
  type ProviderRequest,
  type ProviderResponse,
  providerRequestSchema,
} from "@cypheria/wallet-provider"
import { z } from "zod"

import type { RuntimeService } from "../index.js"
import type { SigningIntentRuntimeService } from "../signing-intent-service/index.js"

export type EthereumPermissionGrant = {
  readonly accountAddresses: EthereumProviderPermissionRecord["accountAddresses"]
  readonly chainId: EthereumProviderPermissionRecord["chainId"]
  readonly expiresAt?: string
  readonly methods: readonly ProviderMethod[]
  readonly walletId: EthereumProviderPermissionRecord["walletId"]
}

/** @deprecated Use EthereumPermissionGrant. */
export type DappPermissionGrant = EthereumPermissionGrant

export type EthereumPermissionAuthorizer = (input: {
  readonly request: ProviderRequest<"eth_requestAccounts" | "wallet_requestPermissions">
  readonly requestedMethods: readonly ProviderMethod[]
}) => Promise<EthereumPermissionGrant | undefined> | EthereumPermissionGrant | undefined

/** @deprecated Use EthereumPermissionAuthorizer. */
export type DappPermissionAuthorizer = EthereumPermissionAuthorizer

export type ActiveEthereumSigningContext = {
  readonly account: SigningAccountRef
  readonly mode: WalletMode
}

/** @deprecated Use ActiveEthereumSigningContext. */
export type ActiveDappSigningContext = ActiveEthereumSigningContext

export type EthereumProviderRuntimeServiceOptions = {
  readonly audit: Pick<AuditLogService, "append">
  readonly dispatch: (
    request: ProviderRequest,
    permission?: EthereumProviderPermissionRecord
  ) => Promise<unknown> | unknown
  readonly executeSigningIntent: (intent: SigningIntentRecord) => Promise<unknown>
  readonly getActiveSigningContext: () => Promise<ActiveEthereumSigningContext | undefined>
  readonly idFactory?: { readonly permissionId: () => string }
  readonly now?: () => string
  readonly permissionAuthorizer: EthereumPermissionAuthorizer
  readonly persistence: Pick<EthereumProviderPersistence, "listPermissions" | "savePermission">
  readonly sessions: Pick<DappSessionManager, "validateRequest">
  readonly signingIntents: Pick<SigningIntentRuntimeService, "create">
}

/** @deprecated Use EthereumProviderRuntimeServiceOptions. */
export type DappProviderRuntimeServiceOptions = EthereumProviderRuntimeServiceOptions

export type EthereumProviderRuntimeService = RuntimeService & {
  readonly handle: (request: unknown) => Promise<ProviderResponse>
}

/** @deprecated Use EthereumProviderRuntimeService. */
export type DappProviderRuntimeService = EthereumProviderRuntimeService

class DappProviderError extends Error {
  readonly error: ProviderError

  constructor(error: ProviderError) {
    super(error.message)
    this.name = "DappProviderError"
    this.error = error
  }
}

const denied = (message: string): DappProviderError =>
  new DappProviderError({ code: 4100, message })

const invalidParams = (message: string): DappProviderError =>
  new DappProviderError({ code: -32602, message })

const isExpired = (permission: EthereumProviderPermissionRecord, now: string): boolean =>
  permission.expiresAt ? Date.parse(permission.expiresAt) <= Date.parse(now) : false

const requestedPermissionMethods = (request: ProviderRequest): ProviderMethod[] => {
  if (request.method === "eth_requestAccounts") {
    return ["eth_accounts", "eth_requestAccounts"]
  }
  const [capabilities] = z
    .tuple([z.record(z.string(), z.unknown())])
    .rest(z.never())
    .parse(request.params)
  const grantableMethods = new Set<string>([
    "eth_accounts",
    "eth_sendTransaction",
    "eth_signTypedData_v4",
    "personal_sign",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ])
  const keys = Object.keys(capabilities)
  if (keys.some((method) => !grantableMethods.has(method))) {
    throw invalidParams("An unsupported wallet permission was requested.")
  }
  const methods = keys as ProviderMethod[]
  if (methods.length === 0) throw invalidParams("No supported wallet permission was requested.")
  return methods
}

const parseHexQuantity = (value: unknown, field: string): bigint | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value)) {
    throw invalidParams(`${field} must be a canonical hexadecimal quantity.`)
  }
  return BigInt(value)
}

const parseNonce = (value: unknown): number | undefined => {
  const quantity = parseHexQuantity(value, "nonce")
  if (quantity === undefined) return undefined
  const nonce = Number(quantity)
  if (!Number.isSafeInteger(nonce)) throw invalidParams("nonce is too large.")
  return nonce
}

const createSigningDraft = (request: ProviderRequest, context: ActiveDappSigningContext) => {
  const base = {
    account: context.account,
    correlationId: String(request.id),
    origin: request.origin,
  }
  if (request.method === "personal_sign") {
    const [message, address] = z.tuple([z.string(), z.string()]).parse(request.params)
    if (address.toLowerCase() !== context.account.address.toLowerCase()) {
      throw denied("The requested signing account is not active.")
    }
    return { ...base, kind: "personal-sign" as const, message }
  }
  if (request.method === "eth_signTypedData_v4") {
    const [address, serialized] = z.tuple([z.string(), z.string()]).parse(request.params)
    if (address.toLowerCase() !== context.account.address.toLowerCase()) {
      throw denied("The requested signing account is not active.")
    }
    const typedData = z
      .object({
        domain: z.unknown(),
        message: z.unknown(),
        primaryType: z.string().min(1),
        types: z.unknown(),
      })
      .parse(JSON.parse(serialized) as unknown)
    return { ...base, ...typedData, kind: "typed-data" as const }
  }
  if (request.method === "eth_sendTransaction") {
    const [transaction] = z
      .tuple([
        z
          .object({
            data: z
              .string()
              .regex(/^0x[0-9a-f]*$/iu)
              .optional(),
            from: z.string(),
            gas: z.unknown().optional(),
            maxFeePerGas: z.unknown().optional(),
            maxPriorityFeePerGas: z.unknown().optional(),
            nonce: z.unknown().optional(),
            to: z
              .string()
              .regex(/^0x[0-9a-f]{40}$/iu)
              .optional(),
            value: z.unknown().optional(),
          })
          .strict(),
      ])
      .parse(request.params)
    if (transaction.from.toLowerCase() !== context.account.address.toLowerCase()) {
      throw denied("The requested transaction account is not active.")
    }
    return {
      ...base,
      kind: "send-transaction" as const,
      transaction: {
        chainId: context.account.chainId,
        ...(transaction.data ? { data: transaction.data } : {}),
        ...(transaction.gas === undefined ? {} : { gas: parseHexQuantity(transaction.gas, "gas") }),
        ...(transaction.maxFeePerGas === undefined
          ? {}
          : { maxFeePerGas: parseHexQuantity(transaction.maxFeePerGas, "maxFeePerGas") }),
        ...(transaction.maxPriorityFeePerGas === undefined
          ? {}
          : {
              maxPriorityFeePerGas: parseHexQuantity(
                transaction.maxPriorityFeePerGas,
                "maxPriorityFeePerGas"
              ),
            }),
        ...(transaction.nonce === undefined ? {} : { nonce: parseNonce(transaction.nonce) }),
        ...(transaction.to ? { to: transaction.to } : {}),
        ...(transaction.value === undefined
          ? {}
          : { value: parseHexQuantity(transaction.value, "value") }),
      },
    }
  }
  throw new DappProviderError({
    code: 4200,
    message: `Unsupported signing method: ${request.method}`,
  })
}

const signingMethods = new Set<ProviderMethod>([
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "personal_sign",
])

export const createDappProviderRuntimeService = (
  options: EthereumProviderRuntimeServiceOptions
): EthereumProviderRuntimeService => {
  const now = options.now ?? (() => new Date().toISOString())
  const permissionId = options.idFactory?.permissionId ?? (() => `dapp_permission_${randomUUID()}`)

  const appendAudit = async (
    eventType: string,
    request: ProviderRequest,
    outcome: string
  ): Promise<void> => {
    await options.audit.append({
      actor: request.origin,
      correlationId: String(request.id),
      createdAt: now(),
      eventType,
      payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`,
      payloadSummary: `${request.method}: ${outcome}.`,
      source: "runtime.dapp-provider-service",
    })
  }

  const process = async (request: ProviderRequest): Promise<unknown> => {
    try {
      await options.sessions.validateRequest(request)
    } catch (error) {
      if (error instanceof DappSessionError) {
        throw denied("The provider request does not belong to an active dApp session.")
      }
      throw error
    }
    const currentTime = now()
    const permissions = (await options.persistence.listPermissions(request.origin)).filter(
      (permission) =>
        permission.sessionKey === request.sessionKey && !isExpired(permission, currentTime)
    )

    if (request.method === "eth_accounts") {
      return [
        ...new Set(
          permissions
            .filter((permission) => permission.methods.includes("eth_accounts"))
            .flatMap((permission) => permission.accountAddresses)
        ),
      ]
    }

    if (
      request.method === "eth_requestAccounts" ||
      request.method === "wallet_requestPermissions"
    ) {
      if (request.method === "eth_requestAccounts") {
        const existingAccounts = [
          ...new Set(
            permissions
              .filter((permission) => permission.methods.includes("eth_accounts"))
              .flatMap((permission) => permission.accountAddresses)
          ),
        ]
        if (existingAccounts.length > 0) return existingAccounts
      }
      let requestedMethods: ProviderMethod[]
      try {
        requestedMethods = requestedPermissionMethods(request)
      } catch (error) {
        if (error instanceof DappProviderError) throw error
        throw invalidParams("The wallet permission request is invalid.")
      }
      const grant = await options.permissionAuthorizer({
        request: request as ProviderRequest<"eth_requestAccounts" | "wallet_requestPermissions">,
        requestedMethods,
      })
      if (!grant) throw new DappProviderError({ code: 4001, message: "User rejected the request." })
      if (grant.methods.some((method) => !requestedMethods.includes(method))) {
        throw denied("The permission grant exceeds the requested methods.")
      }
      if (
        (request.chainId !== undefined && request.chainId !== grant.chainId) ||
        (request.method === "eth_requestAccounts" && !grant.methods.includes("eth_accounts"))
      ) {
        throw denied("The permission grant does not match the requested wallet context.")
      }
      const createdAt = now()
      const existing = permissions.find(
        (permission) =>
          permission.walletId === grant.walletId && permission.chainId === grant.chainId
      )
      const permission = dappPermissionRecordSchema.parse({
        ...grant,
        accountAddresses: [
          ...new Set([...(existing?.accountAddresses ?? []), ...grant.accountAddresses]),
        ],
        createdAt: existing?.createdAt ?? createdAt,
        id: existing?.id ?? permissionId(),
        methods: [...new Set([...(existing?.methods ?? []), ...grant.methods])],
        origin: request.origin,
        sessionKey: request.sessionKey,
        updatedAt: createdAt,
      }) as EthereumProviderPermissionRecord
      const saved = await options.persistence.savePermission(permission)
      await appendAudit("dapp.permission.granted", request, saved.id)
      return request.method === "eth_requestAccounts"
        ? saved.accountAddresses
        : grant.methods.map((method) => ({ caveats: [], parentCapability: method }))
    }

    if (ethereumReadOnlyMethods.includes(request.method as never)) {
      return options.dispatch(request)
    }

    if (signingMethods.has(request.method)) {
      const context = await options.getActiveSigningContext()
      const permission = context
        ? permissions.find(
            (candidate) =>
              candidate.methods.includes(request.method) &&
              (request.chainId === undefined || request.chainId === candidate.chainId) &&
              context.account.walletId === candidate.walletId &&
              context.account.chainId === candidate.chainId &&
              candidate.accountAddresses.some(
                (address) => address.toLowerCase() === context.account.address.toLowerCase()
              )
          )
        : undefined
      if (!context || !permission) {
        throw denied("The permitted wallet account is not active.")
      }
      let draft: ReturnType<typeof createSigningDraft>
      try {
        draft = createSigningDraft(request, context)
      } catch (error) {
        if (error instanceof DappProviderError) throw error
        throw invalidParams("The signing request parameters are invalid.")
      }
      const intent = await options.signingIntents.create({
        intent: draft,
        mode: context.mode,
        source: "dapp",
      })
      if (intent.status === "rejected") throw denied("Signing policy rejected the request.")
      return options.executeSigningIntent(intent)
    }

    const permission = permissions.find(
      (candidate) =>
        candidate.methods.includes(request.method) &&
        (request.chainId === undefined || request.chainId === candidate.chainId)
    )
    if (!permission) throw denied("The dApp does not have permission for this wallet method.")
    return options.dispatch(request, permission)
  }

  const handle = async (requestValue: unknown): Promise<ProviderResponse> => {
    let request: ProviderRequest
    try {
      request = providerRequestSchema.parse(requestValue) as ProviderRequest
    } catch {
      const id =
        requestValue && typeof requestValue === "object" && "id" in requestValue
          ? (requestValue as { id?: unknown }).id
          : "invalid"
      return {
        error: { code: -32602, message: "Invalid provider request." },
        id: typeof id === "string" || typeof id === "number" ? id : "invalid",
      }
    }
    try {
      const result = await process(request)
      await appendAudit("dapp.provider.request", request, "succeeded")
      return { id: request.id, result }
    } catch (error) {
      const providerError =
        error instanceof DappProviderError
          ? error.error
          : { code: -32603, message: "Internal provider error." }
      await appendAudit("dapp.provider.request", request, `failed (${providerError.code})`).catch(
        () => undefined
      )
      return { error: providerError, id: request.id }
    }
  }

  return {
    handle,
    handlers: [{ handler: handle, method: "dapp.provider-request" }],
    name: "dapp-provider",
    namespace: "dapp",
  }
}

export const createEthereumProviderRuntimeService = createDappProviderRuntimeService
