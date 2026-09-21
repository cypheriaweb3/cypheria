import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  type AgentRegistryDocument,
  AgentRegistryDocumentSchema,
  type AgentRegistryEntry,
  type AgentRegistrySyncState,
} from "@cypheria/protocol"

const DEFAULT_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024
const REFRESH_INTERVAL_MS = 60 * 60 * 1000
const nativeRegistryIds = new Set(["codex-acp", "claude-acp", "pi-acp", "opencode"])

type CacheEnvelope = {
  etag?: string
  lastModified?: string
  savedAt: string
}

export type AgentRegistryServiceOptions = {
  cypheriaHome: string
  fetchImpl?: typeof fetch
  onUpdate?: (state: AgentRegistrySyncState) => void
  registryUrl?: string
}

export class AgentRegistryService {
  readonly #metadataPath: string
  readonly #registryPath: string
  readonly #fetch: typeof fetch
  readonly #onUpdate: ((state: AgentRegistrySyncState) => void) | undefined
  readonly #registryUrl: string
  #document: AgentRegistryDocument | undefined
  #etag: string | undefined
  #lastModified: string | undefined
  #timer: NodeJS.Timeout | undefined
  #state: AgentRegistrySyncState = {
    error: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    registryVersion: null,
    stale: true,
  }

  constructor(options: AgentRegistryServiceOptions) {
    this.#registryPath = join(options.cypheriaHome, "agents", "registry.json")
    this.#metadataPath = join(options.cypheriaHome, "agents", "registry.metadata.json")
    this.#fetch = options.fetchImpl ?? fetch
    this.#onUpdate = options.onUpdate
    this.#registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL
  }

  get state(): AgentRegistrySyncState {
    return { ...this.#state }
  }

  get entries(): readonly AgentRegistryEntry[] {
    return this.#document?.agents.filter(({ id }) => !nativeRegistryIds.has(id)) ?? []
  }

  get(id: string): AgentRegistryEntry | undefined {
    if (nativeRegistryIds.has(id)) return undefined
    return this.#document?.agents.find((agent) => agent.id === id)
  }

  async start(options: { refresh?: boolean } = {}): Promise<void> {
    const stored = await this.#readStoredRegistry()
    if (stored) {
      this.#document = stored.document
      this.#etag = stored.metadata?.etag
      this.#lastModified = stored.metadata?.lastModified
      this.#state = {
        ...this.#state,
        lastSuccessAt: stored.metadata?.savedAt ?? null,
        registryVersion: stored.document.version,
      }
    }
    if (options.refresh !== false) {
      await this.refresh().catch(() => this.state)
      this.#timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
      this.#timer.unref()
    }
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  async refresh(): Promise<AgentRegistrySyncState> {
    const attemptedAt = new Date().toISOString()
    this.#state = { ...this.#state, lastAttemptAt: attemptedAt }
    try {
      const headers = new Headers()
      if (this.#etag) headers.set("if-none-match", this.#etag)
      if (this.#lastModified) headers.set("if-modified-since", this.#lastModified)
      const response = await this.#fetch(this.#registryUrl, {
        headers,
        signal: AbortSignal.timeout(20_000),
      })
      if (response.status === 304) {
        this.#state = { ...this.#state, error: null, lastSuccessAt: attemptedAt, stale: false }
        await this.#writeAtomic(this.#metadataPath, {
          ...(this.#etag ? { etag: this.#etag } : {}),
          ...(this.#lastModified ? { lastModified: this.#lastModified } : {}),
          savedAt: attemptedAt,
        })
        this.#onUpdate?.(this.state)
        return this.state
      }
      if (!response.ok) throw new Error(`Registry download failed with HTTP ${response.status}`)
      const declared = Number(response.headers.get("content-length") ?? 0)
      if (declared > MAX_REGISTRY_BYTES) throw new Error("Registry response is too large")
      const text = await response.text()
      if (Buffer.byteLength(text) > MAX_REGISTRY_BYTES)
        throw new Error("Registry response is too large")
      const incoming = AgentRegistryDocumentSchema.parse(JSON.parse(text))
      this.#document = incoming
      this.#etag = response.headers.get("etag") ?? undefined
      this.#lastModified = response.headers.get("last-modified") ?? undefined
      this.#state = {
        error: null,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: attemptedAt,
        registryVersion: incoming.version,
        stale: false,
      }
      await this.#writeStoredRegistry(incoming, {
        ...(this.#etag ? { etag: this.#etag } : {}),
        ...(this.#lastModified ? { lastModified: this.#lastModified } : {}),
        savedAt: attemptedAt,
      })
    } catch (error) {
      this.#state = {
        ...this.#state,
        error: error instanceof Error ? error.message : String(error),
        stale: true,
      }
    }
    this.#onUpdate?.(this.state)
    return this.state
  }

  async #readStoredRegistry(): Promise<
    { document: AgentRegistryDocument; metadata?: CacheEnvelope } | undefined
  > {
    try {
      const document = AgentRegistryDocumentSchema.parse(
        JSON.parse(await readFile(this.#registryPath, "utf8"))
      )
      const metadata = await readFile(this.#metadataPath, "utf8").then(
        (value) => JSON.parse(value) as CacheEnvelope,
        () => undefined
      )
      return { document, ...(metadata ? { metadata } : {}) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      return undefined
    }
  }

  async #writeStoredRegistry(
    document: AgentRegistryDocument,
    metadata: CacheEnvelope
  ): Promise<void> {
    await mkdir(dirname(this.#registryPath), { recursive: true })
    await this.#writeAtomic(this.#registryPath, document)
    await this.#writeAtomic(this.#metadataPath, metadata)
  }

  async #writeAtomic(path: string, value: unknown): Promise<void> {
    const staging = `${path}.${process.pid}.tmp`
    await writeFile(staging, `${JSON.stringify(value)}\n`, { mode: 0o600 })
    await rename(staging, path)
  }
}
