import {
  parseServerMessageText,
  type ServerDiagnostics,
  type ServerIdentity,
  type ServerInfo,
} from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { ClientSession, type SessionHost, type SessionTransport } from "./client-session.js"

const identity: ServerIdentity = {
  hostname: "test",
  id: "srv_test",
  protocolVersion: 1,
  startedAt: "2026-01-01T00:00:00.000Z",
  version: "0.0.0",
}

const createFixture = () => {
  const sent: unknown[] = []
  const transport: SessionTransport = {
    close: vi.fn(),
    send: (data) => sent.push(parseServerMessageText(data)),
  }
  const info: ServerInfo = {
    ...identity,
    connections: 1,
    runtimeState: "ready",
    webApp: { enabled: true },
  }
  const diagnostics: ServerDiagnostics = {
    collectedAt: "2026-01-01T00:00:00.000Z",
    connections: { acceptedTotal: 1, active: 1, rejectedTotal: 0 },
    memory: { arrayBuffers: 0, external: 0, heapTotal: 0, heapUsed: 0, rss: 0 },
    process: { pid: 1, uptimeSeconds: 1 },
    runtimeState: "ready",
  }
  const host: SessionHost = {
    getDiagnostics: () => diagnostics,
    getIdentity: () => identity,
    getInfo: () => info,
    requestLifecycle: vi.fn(),
    requestRuntime: vi.fn(async () => ({ ok: true })),
  }
  return { host, sent, session: new ClientSession({ helloTimeoutMs: 1000, host, transport }) }
}

describe("ClientSession", () => {
  it("requires a compatible hello before handling requests", async () => {
    const fixture = createFixture()
    await fixture.session.receive(
      JSON.stringify({
        payload: {
          capabilities: [],
          client: { id: "web-1", kind: "web" },
          protocolVersion: 1,
        },
        requestId: "hello-1",
        type: "session.hello",
      })
    )
    await fixture.session.receive(
      JSON.stringify({
        payload: { method: "runtime.info" },
        requestId: "runtime-1",
        type: "runtime.request",
      })
    )

    expect(fixture.sent).toMatchObject([
      { requestId: "hello-1", type: "session.ready" },
      { payload: { result: { ok: true } }, requestId: "runtime-1", type: "runtime.response" },
    ])
    fixture.session.close()
  })

  it("rejects messages sent before hello", async () => {
    const fixture = createFixture()
    await fixture.session.receive(JSON.stringify({ requestId: "info-1", type: "server.info" }))
    expect(fixture.sent[0]).toMatchObject({
      payload: { code: "NOT_READY" },
      requestId: "info-1",
      type: "server.error",
    })
  })

  it("sends bigint runtime results through the protocol codec", async () => {
    const fixture = createFixture()
    fixture.host.requestRuntime = vi.fn(async () => ({ value: 18_446_744_073_709_551_615n }))
    await fixture.session.receive(
      JSON.stringify({
        payload: {
          capabilities: [],
          client: { id: "web-1", kind: "web" },
          protocolVersion: 1,
        },
        requestId: "hello-bigint",
        type: "session.hello",
      })
    )
    await fixture.session.receive(
      JSON.stringify({
        payload: { method: "wallet.balance" },
        requestId: "runtime-bigint",
        type: "runtime.request",
      })
    )

    expect(fixture.sent[1]).toEqual({
      payload: { result: { value: 18_446_744_073_709_551_615n } },
      requestId: "runtime-bigint",
      type: "runtime.response",
    })
    fixture.session.close()
  })
})
