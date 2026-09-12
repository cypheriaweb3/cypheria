import {
  parseServerMessageText,
  type ServerDiagnostics,
  type ServerIdentity,
  type ServerInfo,
} from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_PERSISTED_SERVER_CONFIG } from "../persisted-config.js"
import type { SessionHost, SessionTransport } from "./client-session.js"
import { ConnectionRegistry } from "./connection-registry.js"

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
    getConfig: () => ({
      config: DEFAULT_PERSISTED_SERVER_CONFIG,
      overrideControlledPaths: [],
      path: "/tmp/server.json",
      restartRequiredPaths: [],
    }),
    getDiagnostics: () => diagnostics,
    getIdentity: () => identity,
    getInfo: () => info,
    getSessionCapabilities: () => [],
    getState: () => ({
      config: { path: "/tmp/server.json", restartRequired: false },
      connections: { active: 1, retained: 0 },
      relay: { connected: false, enabled: false },
      runtimeState: "ready",
      worker: { pid: 1 },
    }),
    patchConfig: vi.fn(async () => host.getConfig()),
    reloadConfig: vi.fn(async () => host.getConfig()),
    requestLifecycle: vi.fn(),
    requestRuntime: vi.fn(async () => ({ ok: true })),
  }
  const registry = new ConnectionRegistry({
    helloTimeoutMs: 1000,
    host,
    reconnectGraceMs: 1000,
  })
  return { host, registry, sent, session: registry.accept(transport) }
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

  it("retains and resumes a logical session across transport loss", async () => {
    const fixture = createFixture()
    await fixture.session.receive(
      JSON.stringify({
        payload: {
          capabilities: [],
          client: { id: "web-resume", kind: "web" },
          protocolVersion: 1,
        },
        requestId: "hello-original",
        type: "session.hello",
      })
    )
    const ready = fixture.sent[0] as { payload: { sessionId: string } }
    fixture.session.transportClosed()
    expect(fixture.registry.diagnostics()).toMatchObject({ active: 0, retained: 1 })

    const resumedMessages: unknown[] = []
    const resumed = fixture.registry.accept({
      close: vi.fn(),
      send: (data) => resumedMessages.push(parseServerMessageText(data)),
    })
    await resumed.receive(
      JSON.stringify({
        payload: {
          capabilities: [],
          client: { id: "web-resume", kind: "web" },
          protocolVersion: 1,
          resumeSessionId: ready.payload.sessionId,
        },
        requestId: "hello-resumed",
        type: "session.hello",
      })
    )

    expect(resumedMessages[0]).toMatchObject({
      payload: { resumed: true, sessionId: ready.payload.sessionId },
      type: "session.ready",
    })
    expect(fixture.registry.diagnostics()).toMatchObject({
      active: 1,
      resumedTotal: 1,
      retained: 0,
    })
    resumed.close()
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

  it("dispatches validated config and state operations", async () => {
    const fixture = createFixture()
    await fixture.session.receive(
      JSON.stringify({
        payload: {
          capabilities: [],
          client: { id: "web-config", kind: "web" },
          protocolVersion: 1,
        },
        requestId: "hello-config",
        type: "session.hello",
      })
    )
    await fixture.session.receive(
      JSON.stringify({
        payload: { patch: { server: { listen: { port: 7788 } } } },
        requestId: "config-patch",
        type: "server.config.patch",
      })
    )
    await fixture.session.receive(JSON.stringify({ requestId: "state", type: "server.state" }))

    expect(fixture.host.patchConfig).toHaveBeenCalledWith({ server: { listen: { port: 7788 } } })
    expect(fixture.sent).toMatchObject([
      { type: "session.ready" },
      { requestId: "config-patch", type: "server.config.result" },
      { requestId: "state", type: "server.state.result" },
    ])
    fixture.session.close()
  })
})
