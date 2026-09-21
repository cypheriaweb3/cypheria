import {
  AgentAcpClientMessageSchema,
  type AgentAcpServerMessage,
} from "@cypheria/protocol/acp-adapter"
import { describe, expect, it } from "vitest"
import { ACP_V1_FALLBACK_REQUIRED_CODE } from "./acp-negotiation.js"
import { AcpSessionRuntime } from "./acp-session-runtime.js"
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

describe("AcpSessionRuntime", () => {
  it("switches the connection to v1 when a v1-only agent answers a v2 handshake", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          if (message.params.protocolVersion !== 2) process.exit(2);
          send({ id: message.id, jsonrpc: "2.0", result: {
            agentCapabilities: { sessionCapabilities: {} },
            agentInfo: { name: "v1-test", version: "1" },
            authMethods: [],
            protocolVersion: 1
          } });
        } else if (message.method === "session/new") {
          if (message.params.cwd !== "/repo" || "payload" in message.params) process.exit(3);
          send({ id: message.id, jsonrpc: "2.0", result: { sessionId: "v1-session" } });
        }
      });
    `
    const messages: AgentAcpServerMessage[] = []
    let wake: (() => void) | undefined
    const nextMessage = async (): Promise<AgentAcpServerMessage> => {
      while (messages.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      return messages.shift() as AgentAcpServerMessage
    }
    const runtime = new AcpSessionRuntime({
      agent: "cline",
      receipt: receiptFor(script),
      send: (message) => {
        messages.push(message)
        wake?.()
        wake = undefined
      },
      toolchains: { environment: () => process.env } as never,
    })

    try {
      runtime.send(
        AgentAcpClientMessageSchema.parse({
          agent: "cline",
          payload: {
            capabilities: { auth: { terminal: {} } },
            info: { name: "cypheria", title: "Cypheria", version: "1" },
          },
          protocolVersion: 2,
          requestId: "initialize",
          type: "agent.acp.initialize.request",
        })
      )
      await expect(nextMessage()).resolves.toMatchObject({
        payload: { result: { protocolVersion: 1 } },
        protocolVersion: 1,
        type: "agent.acp.initialize.response",
      })

      runtime.send(
        AgentAcpClientMessageSchema.parse({
          agent: "cline",
          payload: { cwd: "/repo", mcpServers: [] },
          protocolVersion: 1,
          requestId: "session-new",
          type: "agent.acp.session.new.request",
        })
      )
      await expect(nextMessage()).resolves.toMatchObject({
        payload: { result: { sessionId: "v1-session" } },
        protocolVersion: 1,
        type: "agent.acp.session.new.response",
      })
    } finally {
      await runtime.stop()
    }
  })

  it("disconnects when the agent negotiates an unsupported version", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        process.stdout.write(JSON.stringify({ id: message.id, jsonrpc: "2.0", result: {
          capabilities: {}, info: { name: "future", version: "1" }, protocolVersion: 3
        } }) + "\\n");
      });
    `
    let resolveMessage: ((message: AgentAcpServerMessage) => void) | undefined
    const received = new Promise<AgentAcpServerMessage>((resolve) => {
      resolveMessage = resolve
    })
    const runtime = new AcpSessionRuntime({
      agent: "cline",
      receipt: receiptFor(script),
      send: (message) => resolveMessage?.(message),
      toolchains: { environment: () => process.env } as never,
    })

    try {
      runtime.send(
        AgentAcpClientMessageSchema.parse({
          agent: "cline",
          payload: { capabilities: {}, info: { name: "cypheria", version: "1" } },
          protocolVersion: 2,
          requestId: "initialize",
          type: "agent.acp.initialize.request",
        })
      )
      await expect(received).resolves.toMatchObject({
        payload: {
          error: { message: "Unsupported ACP protocol version negotiated: 3" },
        },
        protocolVersion: 2,
      })
    } finally {
      await runtime.stop()
    }
  })

  it("requests a fresh v1 connection for a v2 response with v1 fields", async () => {
    const script = `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        process.stdout.write(JSON.stringify({ id: message.id, jsonrpc: "2.0", result: {
          agentCapabilities: { sessionCapabilities: {} },
          agentInfo: { name: "hybrid", version: "1" },
          authMethods: [],
          protocolVersion: 2
        } }) + "\\n");
      });
    `
    let resolveMessage: ((message: AgentAcpServerMessage) => void) | undefined
    const received = new Promise<AgentAcpServerMessage>((resolve) => {
      resolveMessage = resolve
    })
    const runtime = new AcpSessionRuntime({
      agent: "cline",
      receipt: receiptFor(script),
      send: (message) => resolveMessage?.(message),
      toolchains: { environment: () => process.env } as never,
    })

    try {
      runtime.send(
        AgentAcpClientMessageSchema.parse({
          agent: "cline",
          payload: { capabilities: {}, info: { name: "cypheria", version: "1" } },
          protocolVersion: 2,
          requestId: "initialize",
          type: "agent.acp.initialize.request",
        })
      )
      await expect(received).resolves.toMatchObject({
        payload: { error: { code: ACP_V1_FALLBACK_REQUIRED_CODE } },
        protocolVersion: 2,
      })
    } finally {
      await runtime.stop()
    }
  })
})
