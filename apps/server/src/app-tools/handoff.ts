/**
 * `handoff_thread`: moves another Thread and its local changes between its checkout and a managed
 * worktree. The work runs in the background and the caller follows it by revision, like the
 * official desktop's `get_handoff_status`.
 */

/**
 * `queued`, `interrupting`, then the Git steps of the move in the order they run, then `completed`
 * or `failed`. The steps are the official desktop's names.
 */
export type HandoffStatus = string

export type HandoffOperation = {
  readonly direction?: "to-checkout" | "to-worktree"
  readonly error?: string
  readonly operationId: string
  readonly revision: number
  readonly status: HandoffStatus
  readonly threadId: string
  readonly workspaceDirectory?: string
}

export type HandoffThreads = {
  cancelTurn(threadId: string): Promise<unknown>
  get(threadId: string): Promise<{ activeTurn: unknown; state: string }>
  startTurn(input: {
    clientMessageId: string
    content: { text: string; type: "text" }[]
    threadId: string
  }): Promise<unknown>
}

export type HandoffGit = {
  handoffThread(
    threadId: string,
    onStep: (step: string) => void
  ): Promise<{ direction: "to-checkout" | "to-worktree"; path: string }>
}

const MAX_OPERATIONS = 100
const INTERRUPT_POLL_MS = 250
const INTERRUPT_TIMEOUT_MS = 30_000

export class HandoffService {
  readonly #git: HandoffGit
  readonly #operations = new Map<string, HandoffOperation>()
  readonly #randomId: () => string
  readonly #threads: HandoffThreads
  readonly #waiters = new Map<string, Set<() => void>>()
  readonly #pause: (ms: number) => Promise<void>

  constructor(options: {
    git: HandoffGit
    pause?: (ms: number) => Promise<void>
    randomId: () => string
    threads: HandoffThreads
  }) {
    this.#git = options.git
    this.#pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.#randomId = options.randomId
    this.#threads = options.threads
  }

  /** Starts a handoff and returns at once; the caller reads progress with {@link status}. */
  start(input: { followUpPrompt?: string; threadId: string }): HandoffOperation {
    for (const operation of this.#operations.values()) {
      if (
        operation.threadId === input.threadId &&
        operation.status !== "completed" &&
        operation.status !== "failed"
      ) {
        throw new Error("A handoff of this thread is already in progress.")
      }
    }
    if (this.#operations.size >= MAX_OPERATIONS) {
      for (const [id, operation] of this.#operations) {
        if (operation.status === "completed" || operation.status === "failed") {
          this.#operations.delete(id)
        }
        if (this.#operations.size < MAX_OPERATIONS) break
      }
    }
    const operationId = this.#randomId()
    const initial: HandoffOperation = {
      operationId,
      revision: 1,
      status: "queued",
      threadId: input.threadId,
    }
    this.#operations.set(operationId, initial)
    void this.#run(operationId, input)
    return initial
  }

  /** The operation, once its revision is past `afterRevision` or `waitMs` has elapsed. */
  async status(
    operationId: string,
    options: { afterRevision?: number; waitMs?: number } = {}
  ): Promise<HandoffOperation> {
    const current = this.#operations.get(operationId)
    if (!current) throw new Error("Unknown handoff operation.")
    const { afterRevision, waitMs } = options
    if (afterRevision === undefined || !waitMs || current.revision > afterRevision) return current
    await new Promise<void>((resolve) => {
      const waiters = this.#waiters.get(operationId) ?? new Set<() => void>()
      const wake = (): void => {
        clearTimeout(timer)
        waiters.delete(wake)
        resolve()
      }
      const timer = setTimeout(wake, waitMs)
      waiters.add(wake)
      this.#waiters.set(operationId, waiters)
    })
    return this.#operations.get(operationId) as HandoffOperation
  }

  #update(operationId: string, patch: Partial<HandoffOperation>): void {
    const current = this.#operations.get(operationId)
    if (!current) return
    this.#operations.set(operationId, { ...current, ...patch, revision: current.revision + 1 })
    for (const wake of [...(this.#waiters.get(operationId) ?? [])]) wake()
  }

  async #run(
    operationId: string,
    input: { followUpPrompt?: string; threadId: string }
  ): Promise<void> {
    try {
      const thread = await this.#threads.get(input.threadId)
      if (thread.activeTurn || thread.state === "running") {
        this.#update(operationId, { status: "interrupting" })
        await this.#threads.cancelTurn(input.threadId)
        const deadline = Date.now() + INTERRUPT_TIMEOUT_MS
        for (;;) {
          const latest = await this.#threads.get(input.threadId)
          if (!latest.activeTurn && latest.state !== "running" && latest.state !== "stopping") break
          if (Date.now() >= deadline) throw new Error("The thread did not stop in time.")
          await this.#pause(INTERRUPT_POLL_MS)
        }
      }
      const moved = await this.#git.handoffThread(input.threadId, (step) =>
        this.#update(operationId, { status: step })
      )
      if (input.followUpPrompt) {
        await this.#threads.startTurn({
          clientMessageId: this.#randomId(),
          content: [{ text: input.followUpPrompt, type: "text" }],
          threadId: input.threadId,
        })
      }
      this.#update(operationId, {
        direction: moved.direction,
        status: "completed",
        workspaceDirectory: moved.path,
      })
    } catch (error) {
      this.#update(operationId, {
        error: error instanceof Error ? error.message : String(error),
        status: "failed",
      })
    }
  }
}
