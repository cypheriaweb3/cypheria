import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Documentation } from "../src/runtime/docs.ts"

describe("Documentation", () => {
  let written: string[]
  beforeEach(() => {
    written = []
    Reflect.set(globalThis, "nodeRepl", { write: (text: string) => written.push(text) })
  })
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "nodeRepl")
  })

  it("serves every reference document the browser guide names", () => {
    const docs = new Documentation("darwin")
    const guide = docs.get("browser")
    for (const name of [
      "browser-troubleshooting",
      "chrome-troubleshooting",
      "file-uploads",
      "local-web-development",
      "screenshots",
    ]) {
      expect(guide).toContain(`\`${name}\``)
      expect(docs.get(name)).toMatch(/^## /u)
    }
    expect(() => docs.get("history")).toThrow(/No document history/u)
  })

  it("shows a capability's guide once, the first time it is used", () => {
    const docs = new Documentation("darwin")
    docs.enterCapability("browser", "viewport")
    docs.enterCapability("browser", "viewport")
    docs.enterCapability("browser", "unknown")
    expect(written).toHaveLength(1)
    expect(written[0]).toContain("Browser capability: `viewport`")
  })
})
