import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  applyConnectionProxyToSession,
  buildConnectionProxyEnvironment,
  getConnectionProxyConfigPath,
  readConnectionProxySettings,
  testConnectionProxy,
  toConnectionProxyUrl,
  writeConnectionProxySettings,
} from "./connection-proxy.js"

const manualSettings = {
  bypass: "example.test",
  host: "127.0.0.1",
  mode: "manual" as const,
  password: "p@ss",
  port: 7890,
  protocol: "http" as const,
  username: "user",
}

describe("connection proxy settings", () => {
  it("stores and reads the full manual proxy configuration", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cypheria-proxy-test-"))
    try {
      await expect(readConnectionProxySettings(configDir)).resolves.toEqual({ mode: "system" })
      await writeConnectionProxySettings(configDir, manualSettings)
      await expect(readConnectionProxySettings(configDir)).resolves.toEqual(manualSettings)
      await expect(readFile(getConnectionProxyConfigPath(configDir), "utf8")).resolves.toContain(
        '"password": "p@ss"'
      )
    } finally {
      await rm(configDir, { force: true, recursive: true })
    }
  })

  it("creates authenticated proxy URLs and child-process environment variables", () => {
    expect(toConnectionProxyUrl(manualSettings)).toBe("http://user:p%40ss@127.0.0.1:7890")
    expect(
      buildConnectionProxyEnvironment(
        { HTTPS_PROXY: "http://old.proxy", KEEP_ME: "yes" },
        manualSettings
      )
    ).toMatchObject({
      ALL_PROXY: "http://user:p%40ss@127.0.0.1:7890",
      HTTP_PROXY: "http://user:p%40ss@127.0.0.1:7890",
      HTTPS_PROXY: "http://user:p%40ss@127.0.0.1:7890",
      KEEP_ME: "yes",
      NO_PROXY: "localhost,127.0.0.1,::1,example.test",
    })
    expect(
      buildConnectionProxyEnvironment(
        { ALL_PROXY: "socks5://old.proxy", KEEP_ME: "yes" },
        { mode: "direct" }
      )
    ).toEqual({ KEEP_ME: "yes" })
  })

  it("applies the selected route and recognizes an OpenAI response", async () => {
    const configs: unknown[] = []
    const proxySession = {
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "Missing bearer token." } }), {
          status: 401,
        }),
      setProxy: async (config: unknown) => {
        configs.push(config)
      },
    }
    await applyConnectionProxyToSession(proxySession, manualSettings)
    expect(configs.at(-1)).toEqual({
      bypassRules: "localhost,127.0.0.1,::1,example.test",
      mode: "fixed_servers",
      proxyRules: "http://127.0.0.1:7890",
    })
    await expect(testConnectionProxy(proxySession, manualSettings)).resolves.toMatchObject({
      message: "Connected to OpenAI successfully.",
      ok: true,
      statusCode: 401,
    })
  })
})
