import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import type { AgentInstallReceipt } from "./agent-installer.js"
import { CodexRuntime } from "./codex-runtime.js"

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("CodexRuntime", () => {
  it("initializes the app server before sending account requests", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-codex-runtime-"))
    homes.push(home)
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      let initialized = false;
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          send({ id: message.id, jsonrpc: "2.0", result: { codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "linux", userAgent: "test" } });
        } else if (message.method === "initialized") {
          initialized = true;
        } else if (message.method === "account/read") {
          if (!initialized) send({ error: { code: -32000, message: "Not initialized" }, id: message.id, jsonrpc: "2.0" });
          else send({ id: message.id, jsonrpc: "2.0", result: { account: null, requiresOpenaiAuth: true } });
        }
      });
    `
    const receipt: AgentInstallReceipt = {
      agentId: "codex",
      args: ["--input-type=module", "-e", script],
      command: process.execPath,
      installedAt: new Date().toISOString(),
      integrity: "not-applicable",
      kind: "npx",
      source: "@openai/codex",
      version: "0.0.0-test",
    }
    const runtime = new CodexRuntime({
      codexHome: home,
      receipt,
      toolchains: { environment: () => process.env } as never,
    })
    try {
      await expect(runtime.request("account/read", { refreshToken: false })).resolves.toEqual({
        account: null,
        requiresOpenaiAuth: true,
      })
    } finally {
      await runtime.stop()
    }
  })
})
