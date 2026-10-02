import { describe, expect, it, vi } from "vitest"

import { CodeReviewBackend, CodeReviewError, codeReviewBackendUrl } from "./backend.js"
import { ChatGptSession, chatGptPrincipal } from "./chatgpt-session.js"

const token = (claims: Record<string, unknown>) =>
  [
    "header",
    Buffer.from(JSON.stringify({ exp: 4_000_000_000, ...claims })).toString("base64url"),
    "signature",
  ].join(".")

const signedIn = (userId = "user-1", accountId = "account-1") =>
  token({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId, chatgpt_user_id: userId },
  })

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" }, ...init })

describe("ChatGPT session", () => {
  it("reads the principal from the access token claims", () => {
    expect(chatGptPrincipal(signedIn())).toEqual({
      accountId: "account-1",
      isFedramp: false,
      userId: "user-1",
    })
    expect(chatGptPrincipal("not-a-token")).toBeNull()
  })

  it("sends the token with the workspace and principal it expects", async () => {
    const session = new ChatGptSession(async () => ({
      authMethod: "chatgpt",
      authToken: signedIn(),
    }))
    expect(await session.headers()).toMatchObject({
      Authorization: `Bearer ${signedIn()}`,
      "ChatGPT-Account-ID": "account-1",
      "X-Codex-Expected-Account-Id": "account-1",
      "X-Codex-Expected-User-Id": "user-1",
    })
  })

  it("requires a ChatGPT sign-in", async () => {
    const session = new ChatGptSession(async () => ({ authMethod: "apikey", authToken: "sk" }))
    await expect(session.headers()).rejects.toThrow("Sign in to Codex with ChatGPT")
    expect(await session.principal()).toBeNull()
  })

  it("refreshes once after a 401 and rejects a refresh onto another account", async () => {
    let user = "user-1"
    const read = vi.fn(async () => ({ authMethod: "chatgpt", authToken: signedIn(user) }))
    const session = new ChatGptSession(read)
    const send = vi
      .fn<(headers: Record<string, string>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json({ ok: true }))
    expect((await session.request(send)).status).toBe(200)
    expect(read).toHaveBeenLastCalledWith(true)
    user = "user-2"
    await expect(session.headers(true)).rejects.toThrow("The Codex account changed")
  })
})

describe("Code Review backend", () => {
  const backend = (fetch: typeof globalThis.fetch, now = () => 1_000) =>
    new CodeReviewBackend(
      new ChatGptSession(async () => ({ authMethod: "chatgpt", authToken: signedIn() })),
      { fetch, now }
    )

  it("accepts only ChatGPT over HTTPS or loopback HTTP", () => {
    expect(codeReviewBackendUrl(undefined).href).toBe("https://chatgpt.com/backend-api")
    expect(codeReviewBackendUrl("http://localhost:8000/api").host).toBe("localhost:8000")
    expect(() => codeReviewBackendUrl("https://example.com/api")).toThrow()
    expect(() => codeReviewBackendUrl("http://chatgpt.com/backend-api")).toThrow()
  })

  it("posts operations to wham with the session headers", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json({ status: "success", body: "x" })
    )
    const value = await backend(fetch as typeof globalThis.fetch).github("gh-pr-body", {
      account: { hostname: "github.com", login: "octo" },
    })
    expect(value).toEqual({ body: "x", status: "success" })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(String(url)).toBe("https://chatgpt.com/backend-api/wham/github/operations/gh-pr-body")
    expect(init?.method).toBe("POST")
    expect((init?.headers as Record<string, string>)["X-Codex-Expected-User-Id"]).toBe("user-1")
  })

  it("remembers a rate limit until it resets", async () => {
    const fetch = vi.fn(async () => json({}, { headers: { "retry-after": "30" }, status: 429 }))
    const client = backend(fetch as typeof globalThis.fetch)
    const first = await client
      .github("gh-pr-search", { account: { hostname: "github.com" } })
      .catch((error) => error)
    expect(first).toBeInstanceOf(CodeReviewError)
    expect(first).toMatchObject({ kind: "rate-limit", retryAt: 31_000 })
    await expect(
      client.github("gh-pr-search", { account: { hostname: "github.com" } })
    ).rejects.toMatchObject({
      kind: "rate-limit",
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("classifies access failures", async () => {
    const fetch = vi.fn(async () => json({ detail: "nope" }, { status: 403 }))
    await expect(
      backend(fetch as typeof globalThis.fetch).gitlab("read-checks", {})
    ).rejects.toMatchObject({
      kind: "access",
      message: "GitLab access is denied for this workspace",
    })
  })

  it("caches a signed-in account and reads again when asked for a fresh one", async () => {
    const fetch = vi.fn(async () =>
      json({
        currentUser: { account: { hostname: "github.com", login: "octo" }, status: "success" },
      })
    )
    const client = backend(fetch as typeof globalThis.fetch)
    await client.githubAccount("github.com", undefined)
    await client.githubAccount("github.com", undefined)
    expect(fetch).toHaveBeenCalledTimes(1)
    await client.githubAccount("github.com", undefined, true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("rejects operation names that are not plain words", async () => {
    await expect(backend(vi.fn() as never).github("../account", {})).rejects.toThrow()
  })
})
