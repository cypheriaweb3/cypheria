import { z } from "zod"

/** What `getAuthStatus { includeToken: true }` returns when Codex is signed in with ChatGPT. */
const AuthStatusSchema = z.object({
  authMethod: z.enum(["chatgpt", "chatgptAuthTokens"]),
  authToken: z.string().min(1),
})

const AuthClaimsSchema = z.object({
  exp: z.number().int().positive(),
  "https://api.openai.com/auth": z.object({
    account_id: z.string().min(1).optional(),
    chatgpt_account_id: z.string().min(1).optional(),
    chatgpt_account_is_fedramp: z.boolean().optional(),
    chatgpt_user_id: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
  }),
})

/** The ChatGPT user and workspace an access token speaks for. */
export type ChatGptPrincipal = {
  readonly accountId: string
  readonly userId: string
  readonly isFedramp: boolean
}

export const chatGptPrincipal = (token: string): ChatGptPrincipal | null => {
  const encoded = token.split(".", 3)[1]
  if (!encoded) return null
  try {
    const claims = AuthClaimsSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    )["https://api.openai.com/auth"]
    const accountId = claims.chatgpt_account_id ?? claims.account_id
    const userId = claims.user_id ?? claims.chatgpt_user_id
    return accountId && userId
      ? { accountId, isFedramp: claims.chatgpt_account_is_fedramp === true, userId }
      : null
  } catch {
    return null
  }
}

/** Reads Codex's sign-in through App Server; `refresh` asks Codex to refresh the token first. */
export type CodexAuthStatusReader = (refresh: boolean) => Promise<unknown>

export class ChatGptSignInError extends Error {
  constructor(message = "Sign in to Codex with ChatGPT to use Code Review.") {
    super(message)
    this.name = "ChatGptSignInError"
  }
}

type Session = { readonly headers: Record<string, string>; readonly principal: ChatGptPrincipal }

/**
 * The signed-in ChatGPT session Code Review calls the OpenAI backend with. The token comes from the
 * Codex App Server Cypheria manages, so it follows the user's Codex sign-in and is never stored.
 * Every request names the user and workspace it expects, and a refresh that lands on another user
 * or workspace fails instead of silently acting for a different account.
 */
export class ChatGptSession {
  readonly #read: CodexAuthStatusReader
  #session: Promise<Session> | null = null

  constructor(read: CodexAuthStatusReader) {
    this.#read = read
  }

  /** Headers for one backend request: the bearer token, its workspace, and the expected principal. */
  async headers(refresh = false): Promise<Record<string, string>> {
    if (!refresh) {
      const session = await this.#current()
      return session.headers
    }
    const previous = await this.#current().catch(() => null)
    const next = this.#load(true)
    this.#session = next
    const session = await next
    if (
      previous &&
      (previous.principal.accountId !== session.principal.accountId ||
        previous.principal.userId !== session.principal.userId)
    ) {
      throw new ChatGptSignInError("The Codex account changed. Reopen Code Review.")
    }
    return session.headers
  }

  /** The principal of the current session, or null while Codex is not signed in with ChatGPT. */
  async principal(): Promise<ChatGptPrincipal | null> {
    try {
      return (await this.#current()).principal
    } catch (error) {
      if (error instanceof ChatGptSignInError) return null
      throw error
    }
  }

  /** Sends `send` with session headers, retrying once with a refreshed token after a 401. */
  async request(
    send: (headers: Record<string, string>) => Promise<Response>,
    signal?: AbortSignal
  ): Promise<Response> {
    signal?.throwIfAborted()
    const first = await send(await this.headers(false))
    if (first.status !== 401) return first
    await first.body?.cancel().catch(() => undefined)
    signal?.throwIfAborted()
    return send(await this.headers(true))
  }

  /** Forgets the cached token, so the next request reads Codex's sign-in again. */
  reset(): void {
    this.#session = null
  }

  #current(): Promise<Session> {
    if (!this.#session) {
      const pending = this.#load(false)
      this.#session = pending
      pending.catch(() => {
        if (this.#session === pending) this.#session = null
      })
    }
    return this.#session
  }

  async #load(refresh: boolean): Promise<Session> {
    let status: unknown
    try {
      status = await this.#read(refresh)
    } catch {
      throw new ChatGptSignInError("Codex could not provide a signed-in session.")
    }
    const auth = AuthStatusSchema.safeParse(status)
    if (!auth.success) throw new ChatGptSignInError()
    const principal = chatGptPrincipal(auth.data.authToken)
    if (!principal) throw new ChatGptSignInError("The Codex session has no selected workspace.")
    return {
      headers: {
        Authorization: `Bearer ${auth.data.authToken}`,
        "ChatGPT-Account-ID": principal.accountId,
        originator: "Codex Code Review",
        "X-Codex-Expected-Account-Id": principal.accountId,
        "X-Codex-Expected-User-Id": principal.userId,
        ...(principal.isFedramp ? { "X-OpenAI-Fedramp": "true" } : {}),
      },
      principal,
    }
  }
}
