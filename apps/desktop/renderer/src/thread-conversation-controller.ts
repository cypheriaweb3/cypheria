import type { CypheriaClient } from "@cypheria/client"
import {
  type AgentId,
  projectThreadTimelineRows,
  type ThreadInputBlock,
  type ThreadInteractionResponse,
  type ThreadTimelineCursor,
  type ThreadTimelineProjectedItem,
  type ThreadTimelineRow,
  type ThreadView,
} from "@cypheria/protocol"

import { ensureCypheriaClient } from "./cypheria-client.js"

export type ConversationSubmitMode = "send" | "steer" | "queue"
export type ConversationLoadState = "loading" | "ready" | "error"

export type ThreadConversationSnapshot = {
  readonly error: Error | null
  readonly hasOlder: boolean
  readonly items: readonly ThreadTimelineProjectedItem[]
  readonly loadState: ConversationLoadState
  readonly loadingOlder: boolean
  readonly thread: ThreadView | null
  readonly threadId: string | null
}

export type ThreadConversationControllerOptions = {
  readonly agentId: AgentId
  readonly cwd?: string
  readonly initialThreadId?: string
  readonly projectId?: string
  readonly sectionId?: string
  readonly onThreadCreated?: (threadId: string) => Promise<void> | void
}

const initialSnapshot = (threadId?: string): ThreadConversationSnapshot => ({
  error: null,
  hasOlder: false,
  items: [],
  loadState: "loading",
  loadingOlder: false,
  thread: null,
  threadId: threadId ?? null,
})

export class ThreadConversationController {
  readonly #listeners = new Set<() => void>()
  readonly #options: ThreadConversationControllerOptions
  readonly #unsubscribers: Array<() => void> = []
  #client: CypheriaClient | null = null
  #cwd: string | undefined
  #disposed = false
  #connectionGeneration = 0
  #epoch: string | null = null
  #rows: ThreadTimelineRow[] = []
  #snapshot: ThreadConversationSnapshot
  #startCursor: ThreadTimelineCursor | null = null
  #needsRecovery = false

  constructor(options: ThreadConversationControllerOptions) {
    this.#options = options
    this.#cwd = options.cwd
    this.#snapshot = initialSnapshot(options.initialThreadId)
  }

  setCwd(cwd: string | undefined): void {
    this.#cwd = cwd
  }

  getSnapshot = (): ThreadConversationSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async connect(): Promise<void> {
    if (this.#client) return
    this.#disposed = false
    const generation = ++this.#connectionGeneration
    try {
      const client = await ensureCypheriaClient()
      if (this.#disposed || generation !== this.#connectionGeneration) return
      this.#client = client
      this.#subscribeClient(client)
      if (this.#snapshot.threadId) {
        const existing = await client.threads.get(this.#snapshot.threadId)
        const ready =
          existing.state === "stopped" || existing.state === "errored"
            ? (await client.threads.resume(existing.id)).thread
            : existing
        if (this.#disposed || generation !== this.#connectionGeneration) return
        await this.#hydrate(ready)
      } else {
        this.#set({ ...this.#snapshot, loadState: "ready" })
      }
    } catch (error) {
      if (generation === this.#connectionGeneration) this.#fail(error)
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#connectionGeneration += 1
    this.#client = null
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe()
    this.#listeners.clear()
  }

  async loadOlder(): Promise<void> {
    const client = this.#requireClient()
    const threadId = this.#snapshot.threadId
    if (!threadId || !this.#startCursor || !this.#snapshot.hasOlder || this.#snapshot.loadingOlder)
      return
    this.#set({ ...this.#snapshot, loadingOlder: true })
    try {
      const page = await client.threads.getTimeline({
        cursor: this.#startCursor,
        direction: "before",
        limit: 200,
        projection: "canonical",
        threadId,
      })
      if (page.reset || page.epoch !== this.#epoch) {
        await this.#refreshTimeline()
        return
      }
      this.#rows = this.#mergeRows(page.canonicalRows, this.#rows)
      this.#startCursor = page.startCursor
      this.#publishRows(page.hasOlder, false)
    } catch (error) {
      this.#set({ ...this.#snapshot, error: this.#error(error), loadingOlder: false })
    }
  }

  async submit(content: readonly ThreadInputBlock[], mode: ConversationSubmitMode): Promise<void> {
    if (content.length === 0) return
    const client = this.#requireClient()
    try {
      const thread = await this.#ensureThread(client)
      const clientMessageId = globalThis.crypto.randomUUID()
      if (mode === "queue") {
        if (thread.agentId !== "codex") throw new Error("Queued follow-ups require Codex")
        await client.harnesses.codex.threads.queue.add({
          clientUserMessageId: clientMessageId,
          input: content.map((block) => {
            if (block.type === "text") return { text: block.text, text_elements: [], type: "text" }
            if (block.type === "image")
              return { type: "image", url: `data:${block.mimeType};base64,${block.data}` }
            if (block.type === "audio")
              return { type: "audio", url: `data:${block.mimeType};base64,${block.data}` }
            return { text: block.uri, text_elements: [], type: "text" }
          }),
          threadId: thread.id,
        })
        return
      }
      if (mode === "steer" && thread.activeTurn && thread.capabilities.steer) {
        await client.threads.steerTurn({
          clientMessageId,
          content: [...content],
          threadId: thread.id,
        })
      } else {
        await client.threads.startTurn({
          clientMessageId,
          content: [...content],
          threadId: thread.id,
        })
      }
      this.#set({ ...this.#snapshot, error: null })
    } catch (error) {
      this.#fail(error, false)
      throw error
    }
  }

  async cancel(): Promise<void> {
    const client = this.#requireClient()
    const thread = this.#snapshot.thread
    if (!thread?.activeTurn) return
    try {
      const next = await client.threads.cancelTurn(thread.id, thread.activeTurn.id)
      this.#set({ ...this.#snapshot, error: null, thread: next })
    } catch (error) {
      this.#fail(error, false)
    }
  }

  async updateConfig(patch: {
    mode?: string | null
    model?: string | null
    speed?: string | null
    thinking?: string | null
  }): Promise<void> {
    const client = this.#requireClient()
    const threadId = this.#snapshot.threadId
    if (!threadId) return
    try {
      const thread = await client.threads.updateConfig({ ...patch, threadId })
      this.#set({ ...this.#snapshot, error: null, thread })
    } catch (error) {
      this.#fail(error, false)
      throw error
    }
  }

  async respond(interactionId: string, response: ThreadInteractionResponse): Promise<void> {
    const client = this.#requireClient()
    const threadId = this.#snapshot.threadId
    if (!threadId) return
    try {
      const thread = await client.threads.respondToInteraction({
        interactionId,
        response,
        threadId,
      })
      this.#set({ ...this.#snapshot, error: null, thread })
    } catch (error) {
      this.#fail(error, false)
      throw error
    }
  }

  async refresh(): Promise<void> {
    const client = this.#requireClient()
    const threadId = this.#snapshot.threadId
    if (!threadId) return
    try {
      const thread = await client.threads.get(threadId)
      await this.#hydrate(thread)
    } catch (error) {
      this.#fail(error, false)
    }
  }

  #subscribeClient(client: CypheriaClient): void {
    this.#unsubscribers.push(
      client.on("thread.updated.notification", ({ payload }) => {
        if (payload.id !== this.#snapshot.threadId) return
        this.#set({ ...this.#snapshot, error: null, thread: payload })
      }),
      client.on("thread.timeline.appended.notification", ({ payload }) => {
        if (payload.threadId !== this.#snapshot.threadId) return
        if (this.#epoch && payload.epoch !== this.#epoch) {
          void this.#refreshTimeline()
          return
        }
        const lastSequence = this.#rows.at(-1)?.seq
        if (lastSequence !== undefined && payload.row.seq > lastSequence + 1) {
          void this.#refreshTimeline()
          return
        }
        this.#epoch = payload.epoch
        this.#rows = this.#mergeRows(this.#rows, [payload.row])
        this.#publishRows(this.#snapshot.hasOlder, false)
      }),
      client.on("thread.timeline.replaced.notification", ({ payload }) => {
        if (payload.threadId === this.#snapshot.threadId) void this.#refreshTimeline()
      }),
      client.on("thread.interaction.requested.notification", ({ payload }) => {
        const thread = this.#snapshot.thread
        if (!thread || payload.threadId !== thread.id) return
        if (thread.pendingInteractions.some((item) => item.id === payload.interaction.id)) return
        this.#set({
          ...this.#snapshot,
          thread: {
            ...thread,
            attention: true,
            pendingInteractions: [...thread.pendingInteractions, payload.interaction],
          },
        })
      }),
      client.on("thread.interaction.resolved.notification", ({ payload }) => {
        const thread = this.#snapshot.thread
        if (!thread || payload.threadId !== thread.id) return
        this.#set({
          ...this.#snapshot,
          thread: {
            ...thread,
            pendingInteractions: thread.pendingInteractions.filter(
              (item) => item.id !== payload.interactionId
            ),
          },
        })
      }),
      client.subscribeConnectionStatus((state) => {
        if (this.#disposed) return
        if (state.status === "connected") {
          if (this.#needsRecovery && this.#snapshot.threadId) {
            this.#needsRecovery = false
            void this.refresh()
          }
          return
        }
        this.#needsRecovery = true
        this.#set({
          ...this.#snapshot,
          error: state.status === "idle" ? new Error("Connection lost") : this.#snapshot.error,
        })
      })
    )
  }

  async #ensureThread(client: CypheriaClient): Promise<ThreadView> {
    if (this.#snapshot.thread) return this.#snapshot.thread
    const ready = await client.threads.create({
      agentId: this.#options.agentId,
      cwd: this.#cwd ?? null,
      ...(this.#options.projectId
        ? { projectPlacement: { projectId: this.#options.projectId } }
        : {}),
      ...(this.#options.sectionId
        ? { sectionPlacement: { sectionId: this.#options.sectionId } }
        : {}),
    })
    this.#epoch = ready.timeline.epoch
    this.#set({
      ...this.#snapshot,
      loadState: "ready",
      thread: ready.thread,
      threadId: ready.thread.id,
    })
    await this.#options.onThreadCreated?.(ready.thread.id)
    return ready.thread
  }

  async #hydrate(thread: ThreadView): Promise<void> {
    this.#set({ ...this.#snapshot, error: null, thread, threadId: thread.id })
    await this.#refreshTimeline()
  }

  async #refreshTimeline(): Promise<void> {
    const client = this.#requireClient()
    const threadId = this.#snapshot.threadId
    if (!threadId) return
    const page = await client.threads.getTimeline({
      direction: "tail",
      limit: 300,
      projection: "canonical",
      threadId,
    })
    this.#epoch = page.epoch
    this.#rows = page.canonicalRows
    this.#startCursor = page.startCursor
    this.#publishRows(page.hasOlder, false, "ready")
  }

  #mergeRows(...groups: readonly (readonly ThreadTimelineRow[])[]): ThreadTimelineRow[] {
    const bySequence = new Map<number, ThreadTimelineRow>()
    for (const rows of groups) for (const row of rows) bySequence.set(row.seq, row)
    return [...bySequence.values()].sort((left, right) => left.seq - right.seq)
  }

  #publishRows(
    hasOlder: boolean,
    loadingOlder: boolean,
    loadState: ConversationLoadState = this.#snapshot.loadState
  ): void {
    this.#set({
      ...this.#snapshot,
      hasOlder,
      items: projectThreadTimelineRows(this.#rows),
      loadState,
      loadingOlder,
    })
  }

  #requireClient(): CypheriaClient {
    if (!this.#client) throw new Error("Conversation is not connected")
    return this.#client
  }

  #fail(value: unknown, loading = true): void {
    this.#set({
      ...this.#snapshot,
      error: this.#error(value),
      ...(loading ? { loadState: "error" as const } : {}),
    })
  }

  #error(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value))
  }

  #set(snapshot: ThreadConversationSnapshot): void {
    if (this.#disposed) return
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }
}
