import { describe, expect, it } from "vitest"

import { buildDesktopAppPaths } from "./app-paths.js"

describe("buildDesktopAppPaths", () => {
  it("uses the dedicated Cypheria home for browser and Codex state", () => {
    expect(buildDesktopAppPaths({ CYPHERIA_HOME: "/var/tmp/cypheria" }, "/home/user")).toEqual({
      browserDir: "/var/tmp/cypheria/browser",
      codexHome: "/var/tmp/cypheria/codex",
      configDir: "/var/tmp/cypheria/config",
      cypheriaHome: "/var/tmp/cypheria",
    })
  })

  it("defaults to a .cypheria directory without reading Codex home", () => {
    expect(
      buildDesktopAppPaths({ CODEX_HOME: "/should/not/be/used" }, "/home/user").cypheriaHome
    ).toBe("/home/user/.cypheria")
  })
})
