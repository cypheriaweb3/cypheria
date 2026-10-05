import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Peer, PeerError } from "@cypheria/browser-extension/peer"
import {
  BrowserInfoSchema,
  ConnectParamsSchema,
  type Discovery,
  EXTENSION_IDS,
  PROTOCOL_VERSION,
} from "@cypheria/browser-extension/protocol"

import { ExtensionSession } from "./session.js"

/** macOS limits a Unix socket path to 104 bytes including the terminator; Linux to 108. */
const MAX_SOCKET_PATH = 100
const MAX_FRAME = 64 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000

export type ExtensionEndpointOptions = {
  readonly cypheriaHome: string
  readonly desktopVersion: string
  readonly platform?: NodeJS.Platform
  /** Called whenever an extension instance connects or disconnects. */
  readonly onChange?: () => void
  readonly log?: (message: string) => void
}

/** The discovery file the native host reads to find Desktop. */
export const discoveryPath = (cypheriaHome: string): string =>
  join(cypheriaHome, "run", "browser-extension.json")

/**
 * Splits a byte stream into frames of a 32-bit little-endian length and UTF-8 JSON, the framing
 * the native host uses on both of its sides.
 */
export class FrameDecoder {
  #buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])
    const messages: unknown[] = []
    while (this.#buffer.length >= 4) {
      const size = this.#buffer.readUInt32LE(0)
      if (size > MAX_FRAME) throw new Error(`A frame of ${size} bytes is too large.`)
      if (this.#buffer.length < 4 + size) break
      const body = this.#buffer.subarray(4, 4 + size).toString("utf8")
      this.#buffer = this.#buffer.subarray(4 + size)
      messages.push(JSON.parse(body))
    }
    return messages
  }
}

export const encodeFrame = (message: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

/**
 * Desktop's endpoint for the extension's native host: a Unix socket in a private directory, or
 * a named pipe on Windows, announced with a token generated at each start in an owner-only
 * discovery file. A connection presents the token and the extension's hello; Desktop checks the
 * caller and the protocol version, then talks to that browser profile as an `ExtensionSession`.
 */
export class ExtensionEndpoint {
  readonly #options: ExtensionEndpointOptions
  readonly #token = randomBytes(24).toString("hex")
  readonly #sessions = new Set<ExtensionSession>()
  #server: Server | undefined
  #endpoint: string | undefined
  #privateDir: string | undefined

  constructor(options: ExtensionEndpointOptions) {
    this.#options = options
  }

  /** The connected browser profiles that answered `getInfo`. */
  get sessions(): readonly ExtensionSession[] {
    return [...this.#sessions].filter((session) => session.info !== undefined)
  }

  get endpoint(): string | undefined {
    return this.#endpoint
  }

  async start(): Promise<void> {
    if (this.#server) return
    const endpoint = this.#endpointPath()
    if (process.platform !== "win32") rmSync(endpoint, { force: true })
    const server = createServer((socket) => this.#accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(endpoint, () => {
        server.off("error", reject)
        resolve()
      })
    })
    if ((this.#options.platform ?? process.platform) !== "win32") chmodSync(endpoint, 0o600)
    this.#server = server
    this.#endpoint = endpoint
    await this.#writeDiscovery(endpoint)
  }

  async stop(): Promise<void> {
    for (const session of this.#sessions) session.close()
    this.#sessions.clear()
    const server = this.#server
    this.#server = undefined
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    // Another Desktop may have started since and own the file now.
    const path = discoveryPath(this.#options.cypheriaHome)
    const current = await readFile(path, "utf8").catch(() => "")
    if (current.includes(this.#token)) await rm(path, { force: true })
    if (this.#privateDir) rmSync(this.#privateDir, { force: true, recursive: true })
    this.#options.onChange?.()
  }

  #endpointPath(): string {
    const platform = this.#options.platform ?? process.platform
    const { cypheriaHome } = this.#options
    const digest = createHash("sha256").update(cypheriaHome).digest("hex").slice(0, 12)
    if (platform === "win32") return `\\\\.\\pipe\\cypheria-browser-extension-${digest}`
    const runDir = join(cypheriaHome, "run")
    mkdirSync(runDir, { mode: 0o700, recursive: true })
    chmodSync(runDir, 0o700)
    const preferred = join(runDir, "browser-extension.sock")
    if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH) return preferred
    // A long home falls back to a private directory in the temporary directory.
    this.#privateDir = mkdtempSync(join(tmpdir(), "cypheria-bx-"))
    chmodSync(this.#privateDir, 0o700)
    return join(this.#privateDir, "s.sock")
  }

  async #writeDiscovery(endpoint: string): Promise<void> {
    const discovery: Discovery = {
      desktopVersion: this.#options.desktopVersion,
      endpoint,
      pid: process.pid,
      protocolVersion: PROTOCOL_VERSION,
      token: this.#token,
    }
    const path = discoveryPath(this.#options.cypheriaHome)
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(discovery, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  }

  #accept(socket: Socket): void {
    const decoder = new FrameDecoder()
    let session: ExtensionSession | undefined
    let peer: Peer | undefined
    const send = (message: unknown) => {
      if (!socket.destroyed) socket.write(encodeFrame(message))
    }
    const refuse = (id: unknown, code: string, message: string) => {
      send({ error: { code, message }, id })
      socket.end()
    }
    // The host must present the token promptly.
    const deadline = setTimeout(() => socket.destroy(), 5_000)
    socket.on("data", (chunk) => {
      let messages: unknown[]
      try {
        messages = decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      } catch {
        socket.destroy()
        return
      }
      for (const message of messages) {
        if (peer) {
          peer.receive(message)
          continue
        }
        clearTimeout(deadline)
        const request = message as { id?: unknown; method?: unknown; params?: unknown }
        if (request.method !== "connect") {
          socket.destroy()
          return
        }
        const parsed = ConnectParamsSchema.safeParse(request.params)
        if (!parsed.success || !this.#tokenMatches(parsed.data.token)) {
          refuse(request.id, "unauthorized", "The native host did not present Desktop's token.")
          return
        }
        const { hello, origin } = parsed.data
        const id = origin.replace(/^chrome-extension:\/\//, "").replace(/\/$/, "")
        if (!(EXTENSION_IDS as readonly string[]).includes(id) || hello.extensionId !== id) {
          refuse(request.id, "unauthorized", `Extension ${id} is not a Cypheria extension.`)
          return
        }
        if (hello.protocolVersion < PROTOCOL_VERSION) {
          refuse(
            request.id,
            "extension_update_required",
            "Update the Cypheria extension to use it with this version of Cypheria Desktop."
          )
          return
        }
        if (hello.protocolVersion > PROTOCOL_VERSION) {
          refuse(
            request.id,
            "app_update_required",
            "Update Cypheria Desktop to use it with this version of the Cypheria extension."
          )
          return
        }
        const connection = new Peer({
          onNotification: (method, params) => session?.notification(method, params),
          send,
          timeoutMs: REQUEST_TIMEOUT_MS,
        })
        peer = connection
        session = new ExtensionSession({
          close: () => socket.destroy(),
          peer: connection,
        })
        this.#sessions.add(session)
        send({
          id: request.id,
          result: {
            desktopVersion: this.#options.desktopVersion,
            protocolVersion: PROTOCOL_VERSION,
          },
        })
        void this.#identify(session)
      }
    })
    socket.on("error", () => undefined)
    socket.on("close", () => {
      clearTimeout(deadline)
      peer?.close(new PeerError("failed", "The browser extension disconnected."))
      if (session) {
        session.closed()
        this.#sessions.delete(session)
        this.#options.onChange?.()
      }
    })
  }

  async #identify(session: ExtensionSession): Promise<void> {
    try {
      const info = BrowserInfoSchema.parse(await session.peer.request("getInfo", {}))
      // A profile that reconnects replaces its previous connection.
      for (const other of this.#sessions) {
        if (other !== session && other.info?.instanceId === info.instanceId) other.close()
      }
      session.identified(info)
      this.#options.log?.(`connected ${info.family} extension ${info.extensionVersion}`)
      this.#options.onChange?.()
    } catch (error) {
      this.#options.log?.(
        `extension did not identify itself: ${error instanceof Error ? error.message : String(error)}`
      )
      session.close()
    }
  }

  #tokenMatches(token: string): boolean {
    const expected = Buffer.from(this.#token)
    const actual = Buffer.from(token)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
}
