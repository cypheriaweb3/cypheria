import { describe, expect, it } from "vitest"

import { activeMention, insertMention } from "./mention-textarea.js"

describe("activeMention", () => {
  it("finds the mention ending at the caret", () => {
    expect(activeMention("Thanks @oc", 10)).toEqual({ query: "oc", start: 7 })
    expect(activeMention("@", 1)).toEqual({ query: "", start: 0 })
    expect(activeMention("cc (@a-b", 8)).toEqual({ query: "a-b", start: 4 })
  })

  it("ignores emails, finished mentions, and code", () => {
    expect(activeMention("me@example", 10)).toBeNull()
    expect(activeMention("@done ", 6)).toBeNull()
    expect(activeMention("`@code", 6)).toBeNull()
  })
})

describe("insertMention", () => {
  it("replaces the typed query with the login and a space", () => {
    expect(insertMention("Hi @oc there", { query: "oc", start: 3 }, "octocat")).toEqual({
      caret: 12,
      text: "Hi @octocat  there",
    })
  })
})
