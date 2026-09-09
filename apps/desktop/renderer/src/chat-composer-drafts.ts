export const COMPOSER_DRAFT_STORAGE_KEY = "cypheria.composer-prompt-drafts-v1"
export const COMPOSER_DRAFT_WRITE_DELAY_MS = 250
export const MAX_PERSISTED_COMPOSER_DRAFT_ALIASES = 100

type ComposerDraftStorage = Pick<Storage, "getItem" | "setItem">

type PersistedComposerDraft = {
  readonly alias: string
  readonly text: string
  readonly updatedAt: number
}

type PersistedComposerDraftState = {
  readonly drafts: PersistedComposerDraft[]
  readonly version: 1
}

const isPersistedComposerDraft = (value: unknown): value is PersistedComposerDraft => {
  if (!value || typeof value !== "object") return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.alias === "string" &&
    typeof draft.text === "string" &&
    typeof draft.updatedAt === "number"
  )
}

const readBrowserStorage = (): ComposerDraftStorage | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export class ComposerPromptDraftStore {
  readonly #drafts = new Map<string, PersistedComposerDraft>()
  #pendingWrite: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly storage: ComposerDraftStorage | undefined = readBrowserStorage(),
    private readonly maxEntries = MAX_PERSISTED_COMPOSER_DRAFT_ALIASES,
    private readonly writeDelayMs = COMPOSER_DRAFT_WRITE_DELAY_MS,
    private readonly now: () => number = Date.now
  ) {
    this.#load()
  }

  get(alias: string): string | undefined {
    return this.#drafts.get(alias)?.text
  }

  set(aliases: Iterable<string>, text: string): void {
    const uniqueAliases = new Set(aliases)
    if (uniqueAliases.size === 0) return

    if (text.length === 0) {
      for (const alias of uniqueAliases) this.#drafts.delete(alias)
    } else {
      const updatedAt = this.now()
      for (const alias of uniqueAliases) {
        this.#drafts.delete(alias)
        this.#drafts.set(alias, { alias, text, updatedAt })
      }
    }

    this.#prune()
    this.#scheduleWrite()
  }

  flush(): void {
    if (this.#pendingWrite) {
      clearTimeout(this.#pendingWrite)
      this.#pendingWrite = undefined
    }
    if (!this.storage) return
    const state: PersistedComposerDraftState = {
      drafts: [...this.#drafts.values()],
      version: 1,
    }
    try {
      this.storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Draft persistence should never make the composer unusable.
    }
  }

  #load(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)
      if (!raw) return
      const state = JSON.parse(raw) as Partial<PersistedComposerDraftState>
      if (state.version !== 1 || !Array.isArray(state.drafts)) return
      for (const draft of state.drafts) {
        if (isPersistedComposerDraft(draft) && draft.text.length > 0) {
          this.#drafts.set(draft.alias, draft)
        }
      }
      this.#prune()
    } catch {
      this.#drafts.clear()
    }
  }

  #prune(): void {
    while (this.#drafts.size > this.maxEntries) {
      const oldestAlias = this.#drafts.keys().next().value
      if (oldestAlias === undefined) return
      this.#drafts.delete(oldestAlias)
    }
  }

  #scheduleWrite(): void {
    if (!this.storage) return
    if (this.#pendingWrite) clearTimeout(this.#pendingWrite)
    this.#pendingWrite = setTimeout(() => this.flush(), this.writeDelayMs)
  }
}

export const composerPromptDraftStore = new ComposerPromptDraftStore()

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("pagehide", () => composerPromptDraftStore.flush())
}
