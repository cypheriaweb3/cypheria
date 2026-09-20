import type { AgentId, HarnessCatalogSnapshot } from "@cypheria/protocol"

export type HarnessCatalogDiscovery = (
  agentId: AgentId,
  signal: AbortSignal
) => Promise<{
  models: HarnessCatalogSnapshot["models"]
  settingSections: HarnessCatalogSnapshot["settingSections"]
}>

type Entry = {
  dirty?: boolean
  generation: number
  inflight?: Promise<HarnessCatalogSnapshot>
  snapshot?: HarnessCatalogSnapshot
}

const emptySnapshot = (agentId: AgentId): HarnessCatalogSnapshot => ({
  agentId,
  error: null,
  fetchedAt: null,
  models: [],
  settingSections: [],
  stale: false,
  status: "loading",
})

/**
 * Process-local catalog cache. Entries live until an explicit invalidation or server shutdown;
 * there is intentionally no TTL or background polling.
 */
export class HarnessCatalogManager {
  readonly #controllers = new Set<AbortController>()
  readonly #discover: HarnessCatalogDiscovery
  readonly #entries = new Map<AgentId, Entry>()
  #stopped = false

  constructor(discover: HarnessCatalogDiscovery) {
    this.#discover = discover
  }

  peek(agentId: AgentId): HarnessCatalogSnapshot | undefined {
    return this.#entries.get(agentId)?.snapshot
  }

  async get(agentId: AgentId, refresh = false): Promise<HarnessCatalogSnapshot> {
    if (this.#stopped) throw new Error("Harness catalog manager is stopped")
    const entry = this.#entries.get(agentId) ?? { generation: 0 }
    this.#entries.set(agentId, entry)
    if (!refresh && entry.snapshot && !entry.dirty) return entry.snapshot
    if (entry.inflight) return entry.inflight

    const controller = new AbortController()
    const generation = entry.generation
    this.#controllers.add(controller)
    entry.inflight = this.#load(agentId, entry, generation, controller)
    return entry.inflight
  }

  invalidate(agentId?: AgentId): void {
    if (agentId) {
      const entry = this.#entries.get(agentId)
      if (entry) {
        entry.dirty = true
        entry.generation += 1
      }
      return
    }
    for (const entry of this.#entries.values()) {
      entry.dirty = true
      entry.generation += 1
    }
  }

  stop(): void {
    this.#stopped = true
    for (const controller of this.#controllers) controller.abort()
    this.#controllers.clear()
    this.#entries.clear()
  }

  async #load(
    agentId: AgentId,
    entry: Entry,
    generation: number,
    controller: AbortController
  ): Promise<HarnessCatalogSnapshot> {
    const previous = entry.snapshot
    try {
      const discovered = await this.#discover(agentId, controller.signal)
      const snapshot: HarnessCatalogSnapshot = {
        agentId,
        error: null,
        fetchedAt: new Date().toISOString(),
        models: discovered.models,
        settingSections: discovered.settingSections,
        stale: false,
        status: "ready",
      }
      if (entry.generation === generation) {
        entry.dirty = false
        entry.snapshot = snapshot
      }
      return snapshot
    } catch (error) {
      if (controller.signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      const snapshot: HarnessCatalogSnapshot = previous
        ? { ...previous, error: message, stale: true }
        : { ...emptySnapshot(agentId), error: message, status: "error" }
      if (entry.generation === generation) {
        entry.dirty = false
        entry.snapshot = snapshot
      }
      return snapshot
    } finally {
      this.#controllers.delete(controller)
      entry.inflight = undefined
    }
  }
}
