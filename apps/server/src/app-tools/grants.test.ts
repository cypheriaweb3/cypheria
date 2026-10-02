import { describe, expect, it } from "vitest"

import { AppToolGrants, codexCallerSessionIds } from "./grants.js"

describe("AppToolGrants", () => {
  it("binds a token to one Thread or to the Codex app-server", () => {
    const grants = new AppToolGrants()
    expect(grants.verify(grants.forThread("thread.with.dots"))).toEqual({
      kind: "thread",
      threadId: "thread.with.dots",
    })
    expect(grants.verify(grants.forCodex())).toEqual({ kind: "codex" })
  })

  it("rejects a token that was altered or signed by another Server", () => {
    const grants = new AppToolGrants()
    const token = grants.forThread("a")
    const forged = token.replace(
      /^cat1\.t\.[^.]+/u,
      `cat1.t.${Buffer.from("b").toString("base64url")}`
    )
    expect(grants.verify(forged)).toBeNull()
    expect(new AppToolGrants().verify(token)).toBeNull()
    expect(grants.verify(undefined)).toBeNull()
    expect(grants.verify("not-a-token")).toBeNull()
  })
})

describe("codexCallerSessionIds", () => {
  it("reads the calling thread, then its parent, then the session from turn metadata", () => {
    expect(
      codexCallerSessionIds({ parent_thread_id: "parent", session_id: "root", thread_id: "child" })
    ).toEqual(["child", "parent", "root"])
    expect(codexCallerSessionIds(JSON.stringify({ thread_id: "t" }))).toEqual(["t"])
  })

  it("ignores metadata it cannot read", () => {
    expect(codexCallerSessionIds(undefined)).toEqual([])
    expect(codexCallerSessionIds("{")).toEqual([])
    expect(codexCallerSessionIds({ thread_id: 7 })).toEqual([])
  })
})
