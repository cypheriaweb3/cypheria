import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Who an app tools bearer token speaks for. A Claude session holds a token bound to its Thread. The
 * Codex app-server holds one token for the whole process, because every Codex Thread shares it; the
 * calling Thread then comes from the turn metadata Codex attaches to each MCP call.
 */
export type AppToolGrant =
  | { readonly kind: "codex" }
  | { readonly kind: "thread"; readonly threadId: string }
  /** A private Code Review's Codex process, which may only read its own review's context. */
  | { readonly kind: "review"; readonly runId: string }

const THREAD_PREFIX = "cat1.t."
const REVIEW_PREFIX = "cat1.r."
const CODEX_TOKEN_BODY = "cat1.codex"

/**
 * Bearer tokens for the `cypheria-app-tools` plugin. They are derived from a secret that lives only
 * in this Server process, so nothing is stored, and the Agent processes that receive them stop with
 * the Server. A token never grants the Server's own bearer token rights.
 */
export class AppToolGrants {
  readonly #secret: Buffer

  constructor(secret: Buffer = randomBytes(32)) {
    this.#secret = secret
  }

  #sign(body: string): string {
    return createHmac("sha256", this.#secret).update(body).digest("base64url")
  }

  forThread(threadId: string): string {
    const body = `${THREAD_PREFIX}${Buffer.from(threadId).toString("base64url")}`
    return `${body}.${this.#sign(body)}`
  }

  forReview(runId: string): string {
    const body = `${REVIEW_PREFIX}${Buffer.from(runId).toString("base64url")}`
    return `${body}.${this.#sign(body)}`
  }

  forCodex(): string {
    return `${CODEX_TOKEN_BODY}.${this.#sign(CODEX_TOKEN_BODY)}`
  }

  verify(token: string | undefined): AppToolGrant | null {
    if (!token) return null
    const separator = token.lastIndexOf(".")
    if (separator <= 0) return null
    const body = token.slice(0, separator)
    const expected = Buffer.from(this.#sign(body))
    const provided = Buffer.from(token.slice(separator + 1))
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null
    if (body === CODEX_TOKEN_BODY) return { kind: "codex" }
    if (body.startsWith(REVIEW_PREFIX)) {
      const runId = Buffer.from(body.slice(REVIEW_PREFIX.length), "base64url").toString()
      return runId ? { kind: "review", runId } : null
    }
    if (!body.startsWith(THREAD_PREFIX)) return null
    const threadId = Buffer.from(body.slice(THREAD_PREFIX.length), "base64url").toString()
    return threadId ? { kind: "thread", threadId } : null
  }
}

/**
 * The Codex session ids that may identify the caller of an MCP call, most specific first, from the
 * `x-codex-turn-metadata` value Codex attaches to the call's `_meta`.
 */
export const codexCallerSessionIds = (metadata: unknown): string[] => {
  let value = metadata
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  return ["thread_id", "parent_thread_id", "session_id"].flatMap((key) => {
    const id = record[key]
    return typeof id === "string" && id.trim() ? [id] : []
  })
}
