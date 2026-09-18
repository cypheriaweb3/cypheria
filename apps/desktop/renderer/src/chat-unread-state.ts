import type { ServerMessage } from "@cypheria/protocol"

const UNREAD_THREAD_STORAGE_KEY = "cypheria.unread-thread-ids-v1"
const MAX_UNREAD_THREAD_IDS = 1_000

type StorageLike = Pick<Storage, "getItem" | "setItem">
type UnreadThreadListener = () => void

const parseThreadIds = (value: string | null, limit: number) => {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(parsed.filter((threadId): threadId is string => typeof threadId === "string")),
    ].slice(-limit)
  } catch {
    return []
  }
}

export class UnreadThreadStore {
  readonly #listeners = new Set<UnreadThreadListener>()
  readonly #limit: number
  readonly #storage: StorageLike | undefined
  #orderedThreadIds: string[]
  #snapshot: ReadonlySet<string>

  constructor(storage?: StorageLike, limit = MAX_UNREAD_THREAD_IDS) {
    this.#storage = storage
    this.#limit = Math.max(1, limit)
    this.#orderedThreadIds = parseThreadIds(this.#readStorageValue(), this.#limit)
    this.#snapshot = new Set(this.#orderedThreadIds)
  }

  readonly getSnapshot = () => this.#snapshot

  readonly subscribe = (listener: UnreadThreadListener) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  has(threadId: string) {
    return this.#snapshot.has(threadId)
  }

  markRead(threadId: string) {
    if (!this.#snapshot.has(threadId)) return false
    this.#replace(this.#orderedThreadIds.filter((candidate) => candidate !== threadId))
    return true
  }

  markUnread(threadId: string) {
    if (!threadId) return false
    const next = this.#orderedThreadIds.filter((candidate) => candidate !== threadId)
    next.push(threadId)
    const bounded = next.slice(-this.#limit)
    if (
      bounded.length === this.#orderedThreadIds.length &&
      bounded.every((candidate, index) => candidate === this.#orderedThreadIds[index])
    )
      return false
    this.#replace(bounded)
    return true
  }

  syncFromStorage(value?: string | null) {
    const next = parseThreadIds(value === undefined ? this.#readStorageValue() : value, this.#limit)
    if (
      next.length === this.#orderedThreadIds.length &&
      next.every((candidate, index) => candidate === this.#orderedThreadIds[index])
    )
      return false
    this.#orderedThreadIds = next
    this.#snapshot = new Set(next)
    this.#emit()
    return true
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }

  #readStorageValue() {
    try {
      return this.#storage?.getItem(UNREAD_THREAD_STORAGE_KEY) ?? null
    } catch {
      return null
    }
  }

  #replace(next: string[]) {
    this.#orderedThreadIds = next
    this.#snapshot = new Set(next)
    try {
      this.#storage?.setItem(UNREAD_THREAD_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Read state remains useful for this renderer even when persistence is unavailable.
    }
    this.#emit()
  }
}

type UnreadThreadMutation = Readonly<{
  action: "read" | "unread"
  threadId: string
}>

export const unreadThreadMutationFromServerMessage = (
  event: ServerMessage,
  activeThreadId?: string
): UnreadThreadMutation | null => {
  if (
    event.type === "thread.timeline.appended.notification" &&
    event.payload.row.item.type === "message" &&
    event.payload.row.item.role === "assistant"
  )
    return {
      action: event.payload.threadId === activeThreadId ? "read" : "unread",
      threadId: event.payload.threadId,
    }
  if (event.type === "thread.deleted.notification")
    return { action: "read", threadId: event.payload.threadId }
  if (event.type === "thread.updated.notification" && event.payload.archivedAt !== null)
    return { action: "read", threadId: event.payload.id }
  return null
}

const browserStorage = (() => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
})()

export const unreadThreadStore = new UnreadThreadStore(browserStorage)

if (typeof globalThis.addEventListener === "function")
  globalThis.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === UNREAD_THREAD_STORAGE_KEY) unreadThreadStore.syncFromStorage(event.newValue)
  })

export { MAX_UNREAD_THREAD_IDS, UNREAD_THREAD_STORAGE_KEY }
