import type { ConnectionOfferV2 } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"
import {
  createClientChannel,
  createServerChannel,
  decrypt,
  deriveDirectionalKeys,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
  resolveClientRelayWebSocketUrl,
  type Transport,
  type TransportMessage,
} from "./index.ts"

class MemoryTransport implements Transport {
  onclose: ((code: number, reason: string) => void) | null = null
  onerror: ((error: Error) => void) | null = null
  onmessage: ((message: TransportMessage) => void) | null = null
  peer: MemoryTransport | undefined

  send(data: string | ArrayBuffer): void {
    const copied = data instanceof ArrayBuffer ? data.slice(0) : data
    queueMicrotask(() =>
      this.peer?.onmessage?.({ data: copied, isBinary: copied instanceof ArrayBuffer })
    )
  }

  close(code = 1000, reason = "Normal closure"): void {
    queueMicrotask(() => {
      this.onclose?.(code, reason)
      this.peer?.onclose?.(code, reason)
    })
  }
}

const createTransportPair = (): [MemoryTransport, MemoryTransport] => {
  const left = new MemoryTransport()
  const right = new MemoryTransport()
  left.peer = right
  right.peer = left
  return [left, right]
}

describe("relay crypto", () => {
  it("derives identical keys and authenticates ciphertext", () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const aliceKey = deriveSharedKey(alice.secretKey, bob.publicKey)
    const bobKey = deriveSharedKey(bob.secretKey, alice.publicKey)
    const encrypted = encrypt(aliceKey, "secret")
    expect(new TextDecoder().decode(decrypt(bobKey, encrypted))).toBe("secret")
    expect(exportPublicKey(importPublicKey(exportPublicKey(alice.publicKey)))).toBe(
      exportPublicKey(alice.publicKey)
    )

    const directional = deriveDirectionalKeys(aliceKey)
    const clientFrame = encrypt(directional.clientToServer, "direction-bound")
    expect(new TextDecoder().decode(decrypt(directional.clientToServer, clientFrame))).toBe(
      "direction-bound"
    )
    expect(() => decrypt(directional.serverToClient, clientFrame)).toThrow("Decryption failed")
  })

  it("rejects an all-zero peer public key", () => {
    expect(() => deriveSharedKey(generateKeyPair().secretKey, new Uint8Array(32))).toThrow(
      "Invalid peer public key"
    )
  })
})

describe("encrypted channel", () => {
  it("handshakes and exchanges encrypted text", async () => {
    const [clientTransport, serverTransport] = createTransportPair()
    const serverKeyPair = generateKeyPair()
    let serverMessage: string | ArrayBuffer | undefined
    let clientMessage: string | ArrayBuffer | undefined
    const serverPromise = createServerChannel(serverTransport, serverKeyPair, {
      onmessage: (message) => {
        serverMessage = message
      },
    })
    const client = await createClientChannel(
      clientTransport,
      exportPublicKey(serverKeyPair.publicKey),
      {
        onmessage: (message) => {
          clientMessage = message
        },
      }
    )
    const server = await serverPromise
    await new Promise((resolve) => setTimeout(resolve, 0))
    await client.send("hello server")
    await server.send("hello client")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(serverMessage).toBe("hello server")
    expect(clientMessage).toBe("hello client")
  })

  it("closes a server-side handshake that never receives a hello", async () => {
    const [clientTransport, serverTransport] = createTransportPair()
    const closed = new Promise<number>((resolve) => {
      clientTransport.onclose = (code) => resolve(code)
    })
    await expect(
      createServerChannel(serverTransport, generateKeyPair(), {}, { handshakeTimeoutMs: 5 })
    ).rejects.toThrow("Timed out waiting for E2EE hello")
    await expect(closed).resolves.toBe(1008)
  })
})

describe("relay URLs", () => {
  it("builds the v2 client URL without credentials", () => {
    const offer: ConnectionOfferV2 = {
      relay: { endpoint: "relay.example.test/base?tenant=cypheria", useTls: true },
      serverId: "srv_test",
      serverPublicKeyB64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      v: 2,
    }
    const url = new URL(resolveClientRelayWebSocketUrl(offer))
    expect(url.protocol).toBe("wss:")
    expect(url.searchParams.get("serverId")).toBe("srv_test")
    expect(url.searchParams.get("role")).toBe("client")
    expect(url.searchParams.get("v")).toBe("2")
    expect(url.searchParams.has("token")).toBe(false)
  })
})
