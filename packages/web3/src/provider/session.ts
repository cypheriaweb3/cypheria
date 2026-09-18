import { z } from "zod"

export type DappSessionKey = `cypheria:dapp:${string}`

export type DappSession = {
  readonly createdAt: string
  readonly key: DappSessionKey
  readonly lastUsedAt?: string
  readonly origin: string
  readonly partition: string
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

export const createDappSessionKey = (origin: string): DappSessionKey =>
  `cypheria:dapp:${normalizeDappOrigin(origin)}`

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

export const createDappSession = (
  origin: string,
  createdAt = new Date().toISOString()
): DappSession => {
  const normalizedOrigin = normalizeDappOrigin(origin)
  const key = createDappSessionKey(normalizedOrigin)
  return { createdAt, key, origin: normalizedOrigin, partition: `persist:${key}` }
}

export type DappSessionPersistence = {
  readonly getSession: (origin: string) => Promise<DappSession | undefined>
  readonly saveSession: (session: DappSession) => Promise<DappSession>
}

export type DappSessionManager = {
  readonly get: (origin: string) => Promise<DappSession | undefined>
  readonly open: (url: string) => Promise<DappSession>
  readonly validateRequest: <
    TRequest extends {
      readonly origin: string
      readonly sessionKey: DappSessionKey
    },
  >(
    request: TRequest
  ) => Promise<DappSession>
  readonly validateScope: (origin: string, sessionKey: DappSessionKey) => Promise<DappSession>
}

export class DappSessionError extends Error {
  readonly code: "INVALID_REQUEST_SCOPE" | "SESSION_NOT_FOUND"

  constructor(code: DappSessionError["code"], message: string) {
    super(message)
    this.name = "DappSessionError"
    this.code = code
  }
}

export const createDappSessionManager = (options: {
  readonly now?: () => string
  readonly persistence: DappSessionPersistence
}): DappSessionManager => {
  const now = options.now ?? (() => new Date().toISOString())
  const validateScope = async (originValue: string, sessionKey: DappSessionKey) => {
    const origin = normalizeDappOrigin(originValue)
    const session = await options.persistence.getSession(origin)
    if (!session)
      throw new DappSessionError("SESSION_NOT_FOUND", "The dApp session does not exist.")
    if (session.key !== sessionKey || session.origin !== origin) {
      throw new DappSessionError(
        "INVALID_REQUEST_SCOPE",
        "The provider request does not belong to its dApp session."
      )
    }
    return session
  }
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
    validateRequest: (request) => validateScope(request.origin, request.sessionKey),
    validateScope,
  }
}
