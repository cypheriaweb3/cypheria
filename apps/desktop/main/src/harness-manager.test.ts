import { delimiter, join } from "node:path"

import { describe, expect, it } from "vitest"

import { buildHarnessEnvironment } from "./harness-manager.js"

describe("managed harness environment", () => {
  it("contains Hermes installation and runtime state below CYPHERIA_HOME", () => {
    const cypheriaHome = "/tmp/cypheria-test"
    const root = join(cypheriaHome, "harnesses", "hermes")
    const env = buildHarnessEnvironment(
      cypheriaHome,
      "hermes",
      { mode: "direct" },
      { PATH: "/usr/bin", SHOULD_SURVIVE: "yes" }
    )

    expect(env).toMatchObject({
      HERMES_HOME: join(root, "home"),
      HERMES_INSTALL_DIR: join(root, "runtime", "hermes-agent"),
      HOME: join(root, "os-home"),
      SHOULD_SURVIVE: "yes",
      USERPROFILE: join(root, "os-home"),
    })
    expect(env.PATH?.split(delimiter).slice(0, 4)).toEqual([
      join(root, "runtime", "bin"),
      join(root, "runtime", "node_modules", ".bin"),
      join(root, "os-home", ".local", "bin"),
      join(root, "os-home", ".opencode", "bin"),
    ])
  })

  it("uses isolated homes for Gemini CLI and OpenCode", () => {
    const cypheriaHome = "/tmp/cypheria-test"
    const gemini = buildHarnessEnvironment(cypheriaHome, "gemini", { mode: "system" }, {})
    const opencode = buildHarnessEnvironment(cypheriaHome, "opencode", { mode: "system" }, {})

    expect(gemini.GEMINI_CLI_HOME).toBe(join(cypheriaHome, "harnesses", "gemini", "home"))
    expect(opencode.OPENCODE_CONFIG_DIR).toBe(
      join(cypheriaHome, "harnesses", "opencode", "home", "config", "opencode")
    )
    expect(opencode.OPENCODE_DISABLE_AUTOUPDATE).toBe("true")
  })
})
