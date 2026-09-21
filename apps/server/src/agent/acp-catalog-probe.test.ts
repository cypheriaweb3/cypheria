import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import {
  authenticateAcp,
  discoverAcpAuth,
  logoutAcp,
  probeAcpCatalog,
} from "./acp-catalog-probe.js"
import type { AgentInstallReceipt } from "./agent-installer.js"

const receiptFor = (script: string): AgentInstallReceipt => ({
  agentId: "cline",
  args: ["--input-type=module", "-e", script],
  command: process.execPath,
  installedAt: new Date().toISOString(),
  integrity: "not-applicable",
  kind: "npx",
  source: "cline",
  version: "0.0.0-test",
})

const optionsFor = (script: string) => ({
  receipt: receiptFor(script),
  signal: new AbortController().signal,
  toolchains: { environment: () => process.env } as never,
})

describe("ACP discovery", () => {
  it("prefers v2 and discovers authentication without creating a session", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          const capabilities = message.params.capabilities;
          const valid = message.params.protocolVersion === 2 && capabilities.auth?.terminal != null && message.params.info?.name === "cypheria";
          send({ id: message.id, jsonrpc: "2.0", result: {
            capabilities: { session: {} },
            authMethods: valid ? [{ methodId: "terminal", name: "Terminal", type: "terminal", env: [{ name: "LOGIN", value: "1" }] }] : [],
            info: { name: "test", version: "1" },
            protocolVersion: 2
          } });
        } else if (message.method === "session/new") {
          send({ error: { code: -32600, message: "Unexpected session/new" }, id: message.id, jsonrpc: "2.0" });
        }
      });
    `

    await expect(discoverAcpAuth(optionsFor(script))).resolves.toEqual({
      authMethods: [
        {
          args: [],
          description: null,
          env: { LOGIN: "1" },
          id: "terminal",
          name: "Terminal",
          type: "terminal",
        },
      ],
      logoutSupported: true,
      protocolVersion: 2,
    })
  })

  it("returns authentication-required as a normal catalog state", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          send({ id: message.id, jsonrpc: "2.0", result: { capabilities: { session: {} }, authMethods: [{ methodId: "cline-account", name: "Cline account", type: "agent" }], info: { name: "test", version: "1" }, protocolVersion: 2 } });
        } else if (message.method === "session/new") {
          send({ error: { code: -32000, message: "Authentication required" }, id: message.id, jsonrpc: "2.0" });
        }
      });
    `

    await expect(probeAcpCatalog(optionsFor(script))).resolves.toMatchObject({
      authMethods: [{ id: "cline-account" }],
      configOptions: [],
      modes: [],
      sessionId: null,
      status: "authentication-required",
    })
  })

  it("uses the v1 surface after an agent downgrades the handshake", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          if (message.params.protocolVersion !== 2) process.exit(2);
          send({ id: message.id, jsonrpc: "2.0", result: { agentCapabilities: { auth: { logout: {} } }, authMethods: [{ id: "cline-account", name: "Cline account", type: "agent" }], agentInfo: { name: "test", version: "1" }, protocolVersion: 1 } });
        } else if (message.method === "authenticate") {
          send({ id: message.id, jsonrpc: "2.0", result: {} });
        } else if (message.method === "auth/login") {
          send({ error: { code: -32600, message: "Unexpected v2 auth/login" }, id: message.id, jsonrpc: "2.0" });
        } else if (message.method === "session/new") {
          send({ error: { code: -32600, message: "Unexpected session/new" }, id: message.id, jsonrpc: "2.0" });
        }
      });
    `

    await expect(
      authenticateAcp({ ...optionsFor(script), methodId: "cline-account" })
    ).resolves.toMatchObject({
      authMethods: [{ id: "cline-account" }],
      protocolVersion: 1,
    })
  })

  it("restarts with v1 when an agent claims v2 but returns the v1 initialize shape", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method !== "initialize") return;
        if (message.params.protocolVersion === 2) {
          send({ id: message.id, jsonrpc: "2.0", result: {
            agentCapabilities: { auth: { logout: {} }, sessionCapabilities: {} },
            agentInfo: { name: "hybrid-agent", version: "1" },
            authMethods: [{ id: "account", name: "Account" }],
            protocolVersion: 2
          } });
          return;
        }
        const validV1 = message.params.protocolVersion === 1 && message.params.clientInfo?.name === "cypheria" && !("info" in message.params);
        send({ id: message.id, jsonrpc: "2.0", result: {
          agentCapabilities: { auth: { logout: {} }, sessionCapabilities: {} },
          agentInfo: { name: validV1 ? "v1-agent" : "invalid", version: "1" },
          authMethods: [{ id: "account", name: "Account" }],
          protocolVersion: 1
        } });
      });
    `

    await expect(discoverAcpAuth(optionsFor(script))).resolves.toMatchObject({
      authMethods: [{ id: "account", name: "Account", type: "agent" }],
      logoutSupported: true,
      protocolVersion: 1,
    })
  })

  it("uses auth/login after negotiating v2", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          send({ id: message.id, jsonrpc: "2.0", result: {
            capabilities: { session: {} },
            authMethods: [{ methodId: "cline-account", name: "Cline account", type: "agent" }],
            info: { name: "test", version: "1" },
            protocolVersion: 2
          } });
        } else if (message.method === "auth/login") {
          send({ id: message.id, jsonrpc: "2.0", result: null });
        } else {
          send({ error: { code: -32600, message: "Unexpected method: " + message.method }, id: message.id, jsonrpc: "2.0" });
        }
      });
    `

    await expect(
      authenticateAcp({ ...optionsFor(script), methodId: "cline-account" })
    ).resolves.toMatchObject({ protocolVersion: 2 })
  })

  it("does not call logout unless the agent advertises the capability", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          send({ id: message.id, jsonrpc: "2.0", result: { capabilities: { session: {} }, authMethods: [], info: { name: "test", version: "1" }, protocolVersion: 2 } });
        } else if (message.method === "auth/logout") {
          send({ error: { code: -32600, message: "Unexpected logout" }, id: message.id, jsonrpc: "2.0" });
        }
      });
    `

    await expect(logoutAcp(optionsFor(script))).rejects.toThrow("ACP agent does not support logout")
  })

  it("does not delete a temporary session unless the agent advertises the capability", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-acp-probe-"))
    const marker = join(directory, "unexpected-delete")
    const script = `
      import { writeFileSync } from "node:fs";
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          send({ id: message.id, jsonrpc: "2.0", result: { capabilities: { session: {} }, authMethods: [], info: { name: "test", version: "1" }, protocolVersion: 2 } });
        } else if (message.method === "session/new") {
          send({ id: message.id, jsonrpc: "2.0", result: { sessionId: "temporary" } });
        } else if (message.method === "session/delete") {
          writeFileSync(${JSON.stringify(marker)}, "called");
          send({ id: message.id, jsonrpc: "2.0", result: {} });
        }
      });
    `

    try {
      await expect(probeAcpCatalog(optionsFor(script))).resolves.toMatchObject({ status: "ready" })
      await expect(access(marker)).rejects.toBeDefined()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
