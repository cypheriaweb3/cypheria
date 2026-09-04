import { createHash, randomUUID } from "node:crypto"

import type { AuditLogService, SigningIntentRecord } from "@cypheria/db"
import type { WalletId } from "@cypheria/wallet-core"
import {
  DappSessionError,
  type DappSessionManager,
  type SolanaProviderPermissionBinding,
  type SolanaProviderPermissionRecord,
  type SolanaProviderPersistence,
  type SolanaProviderRequest,
  type SolanaProviderResponse,
  solanaProviderPermissionRecordSchema,
  solanaProviderRequestSchema,
} from "@cypheria/wallet-provider"

import type { RuntimeService } from "../index.js"
import type { SigningIntentRuntimeService } from "../signing-intent-service/index.js"

export type SolanaPermissionGrant = {
  readonly bindings: readonly SolanaProviderPermissionBinding[]
  readonly expiresAt?: string
  readonly walletId: WalletId
}

export type SolanaPermissionAuthorizer = (input: {
  readonly request: SolanaProviderRequest & { readonly method: "standard:connect" }
}) => Promise<SolanaPermissionGrant | undefined> | SolanaPermissionGrant | undefined

export type SolanaProviderRuntimeServiceOptions = {
  readonly audit: Pick<AuditLogService, "append">
  readonly executeSigningIntent: (intent: SigningIntentRecord) => Promise<unknown>
  readonly idFactory?: { readonly permissionId: () => string }
  readonly now?: () => string
  readonly permissionAuthorizer: SolanaPermissionAuthorizer
  readonly persistence: Pick<
    SolanaProviderPersistence,
    "listSolanaPermissions" | "saveSolanaPermission"
  >
  readonly sessions: Pick<DappSessionManager, "validateRequest">
  readonly signingIntents: Pick<SigningIntentRuntimeService, "create">
}

export type SolanaProviderRuntimeService = RuntimeService & {
  readonly handle: (request: unknown) => Promise<SolanaProviderResponse>
}

class SolanaProviderRuntimeError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = "SolanaProviderRuntimeError"
    this.code = code
  }
}

const isExpired = (permission: SolanaProviderPermissionRecord, now: string): boolean =>
  permission.expiresAt ? Date.parse(permission.expiresAt) <= Date.parse(now) : false

const accountsFromPermissions = (
  permissions: readonly SolanaProviderPermissionRecord[]
): SolanaProviderPermissionRecord["bindings"][number]["account"][] => {
  const accounts = new Map<string, SolanaProviderPermissionBinding["account"]>()
  for (const { account } of permissions.flatMap((permission) => permission.bindings)) {
    accounts.set(`${account.address}:${account.publicKey}`, account)
  }
  return [...accounts.values()]
}

const methodToIntentKind = (
  method: SolanaProviderRequest["method"]
): "solana-sign-and-send-transaction" | "solana-sign-message" | "solana-sign-transaction" => {
  if (method === "solana:signMessage") return "solana-sign-message"
  if (method === "solana:signTransaction") return "solana-sign-transaction"
  if (method === "solana:signAndSendTransaction") return "solana-sign-and-send-transaction"
  throw new SolanaProviderRuntimeError(4200, `Unsupported Solana signing method: ${method}`)
}

export const createSolanaProviderRuntimeService = (
  options: SolanaProviderRuntimeServiceOptions
): SolanaProviderRuntimeService => {
  const now = options.now ?? (() => new Date().toISOString())
  const permissionId =
    options.idFactory?.permissionId ?? (() => `solana_permission_${randomUUID()}`)
  const connectedSessions = new Set<string>()

  const audit = async (
    eventType: string,
    request: SolanaProviderRequest,
    outcome: string
  ): Promise<void> => {
    await options.audit.append({
      actor: request.origin,
      correlationId: request.id,
      createdAt: now(),
      eventType,
      payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`,
      payloadSummary: `${request.method}: ${outcome}.`,
      source: "runtime.solana-provider-service",
    })
  }

  const process = async (request: SolanaProviderRequest): Promise<unknown> => {
    try {
      await options.sessions.validateRequest(request)
    } catch (error) {
      if (error instanceof DappSessionError) {
        throw new SolanaProviderRuntimeError(
          4100,
          "The provider request does not belong to an active dApp session."
        )
      }
      throw error
    }
    const permissions = (await options.persistence.listSolanaPermissions(request.origin)).filter(
      (permission) => permission.sessionKey === request.sessionKey && !isExpired(permission, now())
    )

    if (request.method === "standard:connect") {
      if (permissions.length > 0) {
        connectedSessions.add(request.sessionKey)
        return { accounts: accountsFromPermissions(permissions) }
      }
      if (request.input.silent) return { accounts: [] }
      const grant = await options.permissionAuthorizer({
        request: request as SolanaProviderRequest & { readonly method: "standard:connect" },
      })
      if (!grant) throw new SolanaProviderRuntimeError(4001, "User rejected the request.")
      const timestamp = now()
      const permission = solanaProviderPermissionRecordSchema.parse({
        ...grant,
        createdAt: timestamp,
        id: permissionId(),
        origin: request.origin,
        sessionKey: request.sessionKey,
        updatedAt: timestamp,
      }) as SolanaProviderPermissionRecord
      const saved = await options.persistence.saveSolanaPermission(permission)
      connectedSessions.add(request.sessionKey)
      await audit("dapp.solana.permission.granted", request, saved.id)
      return { accounts: accountsFromPermissions([saved]) }
    }

    if (request.method === "standard:disconnect") {
      connectedSessions.delete(request.sessionKey)
      return null
    }

    if (!connectedSessions.has(request.sessionKey)) {
      throw new SolanaProviderRuntimeError(4100, "The Solana wallet is not connected.")
    }

    const results: unknown[] = []
    for (const input of request.input) {
      const requestedChain = "chain" in input ? input.chain : undefined
      const binding = permissions
        .flatMap((permission) => permission.bindings)
        .find(
          (candidate) =>
            candidate.account.address === input.account.address &&
            candidate.account.publicKey === input.account.publicKey &&
            candidate.account.features.includes(request.method) &&
            (!requestedChain || candidate.signingAccount.chainKey === requestedChain)
        )
      if (!binding) {
        throw new SolanaProviderRuntimeError(4100, "The Solana signing account is not permitted.")
      }
      const payload = "message" in input ? input.message : input.transaction
      const intent = await options.signingIntents.create({
        intent: {
          account: binding.signingAccount,
          chainKey: binding.signingAccount.chainKey,
          correlationId: request.id,
          kind: methodToIntentKind(request.method),
          origin: request.origin,
          payload,
        },
        mode: binding.mode,
        source: "dapp",
      })
      if (intent.status === "rejected") {
        throw new SolanaProviderRuntimeError(4100, "Signing policy rejected the request.")
      }
      results.push(await options.executeSigningIntent(intent))
    }
    return results
  }

  const handle = async (requestValue: unknown): Promise<SolanaProviderResponse> => {
    let request: SolanaProviderRequest
    try {
      request = solanaProviderRequestSchema.parse(requestValue) as SolanaProviderRequest
    } catch {
      const id =
        requestValue && typeof requestValue === "object" && "id" in requestValue
          ? (requestValue as { readonly id?: unknown }).id
          : "invalid"
      return {
        error: { code: -32602, message: "Invalid Solana provider request." },
        id: typeof id === "string" ? id : "invalid",
      }
    }
    try {
      const result = await process(request)
      await audit("dapp.solana.provider.request", request, "succeeded")
      return { id: request.id, result: result as never }
    } catch (error) {
      const providerError =
        error instanceof SolanaProviderRuntimeError
          ? { code: error.code, message: error.message }
          : { code: -32603, message: "Internal Solana provider error." }
      await audit("dapp.solana.provider.request", request, `failed (${providerError.code})`).catch(
        () => undefined
      )
      return { error: providerError, id: request.id }
    }
  }

  return {
    handle,
    handlers: [{ handler: handle, method: "dapp.solana-provider-request" }],
    name: "solana-provider",
    namespace: "dapp",
  }
}
