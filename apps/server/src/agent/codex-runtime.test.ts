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
  it("drains app-server diagnostics without blocking account requests", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-codex-runtime-"))
    homes.push(home)
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          process.stderr.write("diagnostic ".repeat(200000), () =>
            send({ id: message.id, jsonrpc: "2.0", result: { codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "linux", userAgent: "test" } })
          );
        } else if (message.method === "account/read") {
          send({ id: message.id, jsonrpc: "2.0", result: { account: null, requiresOpenaiAuth: true } });
        }
      });
    `
    const runtime = new CodexRuntime({
      codexHome: home,
      receipt: {
        agentId: "codex",
        args: ["--input-type=module", "-e", script],
        command: process.execPath,
        installedAt: new Date().toISOString(),
        integrity: "not-applicable",
        kind: "npx",
        source: "@openai/codex",
        version: "0.0.0-test",
      },
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

  it("declares MCP extensions and keeps hidden Threads away from every session", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-codex-runtime-"))
    homes.push(home)
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      let extensions = null;
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          extensions = message.params.capabilities.extensions;
          send({ id: message.id, jsonrpc: "2.0", result: { codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "linux", userAgent: "test" } });
        } else if (message.method === "thread/start") {
          send({ jsonrpc: "2.0", method: "thread/started", params: { thread: { id: "hidden", threadSource: "mcp_extension_host" } } });
          send({ id: message.id, jsonrpc: "2.0", result: { thread: { id: "hidden" }, extensions } });
        } else if (message.method === "account/read") {
          send({ jsonrpc: "2.0", method: "thread/status/changed", params: { threadId: "hidden", status: { type: "idle" } } });
          send({ id: 77, jsonrpc: "2.0", method: "mcpServer/elicitation/request", params: { threadId: "hidden", serverName: "bits", mode: "form", message: "Pick", requestedSchema: { type: "object", properties: {} }, turnId: null, _meta: null } });
        } else if (message.id === 77) {
          send({ id: message.id + 1000, jsonrpc: "2.0", method: "never" });
          send({ jsonrpc: "2.0", method: "thread/name/updated", params: { threadId: "visible", threadName: JSON.stringify(message.result) } });
        }
      });
    `
    const runtime = new CodexRuntime({
      codexHome: home,
      receipt: {
        agentId: "codex",
        args: ["--input-type=module", "-e", script],
        command: process.execPath,
        installedAt: new Date().toISOString(),
        integrity: "not-applicable",
        kind: "npx",
        source: "@openai/codex",
        version: "0.0.0-test",
      },
      toolchains: { environment: () => process.env } as never,
    })
    const received: { type: string; payload?: unknown }[] = []
    try {
      const started = await runtime.request("thread/start", {})
      expect(started.extensions).toEqual({
        "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
        "openai/elicitation": { form: {} },
      })
      runtime.hideThread("hidden", {
        request: async (method, params) => ({
          method,
          server: (params as { serverName: string }).serverName,
        }),
      })
      await runtime.send("session", (message) => received.push(message as never), {
        requestId: "r1",
        type: "agent.codex.account.read.request",
      } as never)
      await expect
        .poll(() => received.find((message) => message.type.includes("thread.name.updated")))
        .toBeTruthy()
      expect(received.map((message) => message.type)).toEqual([
        "agent.codex.thread.name.updated.notification",
      ])
      expect((received[0]?.payload as { threadName: string } | undefined)?.threadName).toBe(
        JSON.stringify({ method: "mcpServer/elicitation/request", server: "bits" })
      )
    } finally {
      await runtime.stop()
    }
  })
})
