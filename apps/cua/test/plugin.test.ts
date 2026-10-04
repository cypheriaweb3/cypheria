import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import { cuaReplEnvironment } from "../src/launcher/launch.ts"
import { cuaReplLaunch, cuaReplServerConfig, generateCuaPlugin } from "../src/plugin/index.ts"
import { diffLines, SnapshotHistory } from "../src/runtime/diff.ts"
import { parseTabMention } from "../src/runtime/mentions.ts"
import { parseSurfaces } from "../src/surfaces.ts"

const root = fileURLToPath(new URL("../", import.meta.url))
const output = mkdtempSync(join(tmpdir(), "cua-plugin-"))
afterAll(() => rmSync(output, { force: true, recursive: true }))

const launch = cuaReplLaunch({
  nodePath: "/usr/bin/node",
  nodeReplPath: "/opt/node_repl",
  root,
  surfaces: ["computer", "iab"],
})

describe("cua plugin", () => {
  it("generates the hidden plugin from the template with turn-end hooks", async () => {
    const directory = join(output, "cua")
    const generated = await generateCuaPlugin({ directory, launch, root })
    const codex = JSON.parse(readFileSync(join(directory, ".codex-plugin", "plugin.json"), "utf8"))
    const mcp = JSON.parse(readFileSync(join(directory, ".mcp.json"), "utf8"))
    expect(codex.name).toBe("cua")
    expect(codex.version).toBe(generated.version)
    expect(codex.hooks.hooks.Stop[0].hooks[0]).toMatchObject({
      server: "cua_repl",
      tool: "turn_ended",
    })
    expect(mcp.mcpServers.cua_repl).toMatchObject({
      args: [join(root, "dist/cua-repl.mjs")],
      command: "/usr/bin/node",
      enabled: false,
      enabled_tools: ["js", "js_reset", "turn_ended"],
      omit_tools_from: ["code_mode", "deferred"],
    })
    expect(mcp.mcpServers.cua_repl.env.CUA_REPL_ENABLED_SURFACES).toBe("iab,computer")
    const again = await generateCuaPlugin({ directory, launch, root })
    expect(again.version).toBe(generated.version)
  })

  it("enables the server per Thread with the Thread's environment", async () => {
    const config = await cuaReplServerConfig(
      root,
      cuaReplLaunch({
        env: { NODE_REPL_HOST_SERVICES_PIPE_PATH: "/tmp/thread.sock" },
        nodePath: "/usr/bin/node",
        nodeReplPath: "/opt/node_repl",
        root,
        surfaces: ["browsers"],
      })
    )
    expect(config.enabled).toBe(true)
    expect(config.env).toMatchObject({
      CUA_REPL_ENABLED_SURFACES: "browsers",
      NODE_REPL_HOST_SERVICES_PIPE_PATH: "/tmp/thread.sock",
    })
  })

  it("describes the enabled surfaces in the launcher environment", () => {
    const env = cuaReplEnvironment(root, { CUA_REPL_ENABLED_SURFACES: "computer" }, "linux")
    const overrides = JSON.parse(env.NODE_REPL_TOOL_OVERRIDES as string)
    expect(overrides.tools.js.description).toContain("cua.getApp({ windowId: 123 })")
    expect(overrides.tools.js.description).toContain("the built-in browser (`cua.iab`)")
    expect(env.NODE_REPL_JS_BANNER).toContain("dist/runtime.mjs")
    expect(env.NODE_REPL_UNTRUSTED_ENV_ALLOWLIST).toBe(
      "CUA_REPL_ENABLED_SURFACES,CUA_REPL_PLATFORM"
    )
    expect(() => parseSurfaces("browser")).toThrow(/unknown/)
    expect(() => parseSurfaces(undefined)).toThrow(/required/)
  })
})

describe("runtime helpers", () => {
  it("diffs snapshots by line", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual(["+ x", "- b"])
    const history = new SnapshotHistory()
    const big = Array.from({ length: 30 }, (_, index) => `row ${index}`)
    expect(history.render("k", "tab", big.join("\n"))).toBe(big.join("\n"))
    const changed = [...big.slice(0, 29), "row new"].join("\n")
    expect(history.render("k", "tab", changed)).toContain("+ row new")
    expect(history.render("k", "tab", changed)).toContain("No changes")
    expect(history.render("k", "tab", changed, true)).toBe(changed)
  })

  it("parses tab mentions strictly", () => {
    expect(
      parseTabMention(
        "plugin://chrome@cypheria-bundled?mention=tab-v1&browserId=edge&tabId=T1&title=Inbox&url=https%3A%2F%2Fmail.example"
      )
    ).toEqual({
      browserId: "edge",
      plugin: "chrome",
      tabId: "T1",
      title: "Inbox",
      url: "https://mail.example",
    })
    expect(() =>
      parseTabMention(
        "plugin://chrome@openai-bundled?mention=tab-v1&browserId=x&tabId=1&title=&url="
      )
    ).toThrow(/Invalid tab mention URL/)
    expect(() =>
      parseTabMention("plugin://chrome@cypheria-bundled?mention=tab-v1&tabId=1&title=&url=")
    ).toThrow(/fields/)
  })
})
