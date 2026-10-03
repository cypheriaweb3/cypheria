import type {
  ProjectThreadPersistenceService,
  WorkspaceThreadPersistenceService,
} from "@cypheria/db"
import type {
  ServerMessage,
  ThreadClientMessage,
  ThreadServerMessage,
  WorkspaceThread,
} from "@cypheria/protocol"

export type WorkspaceThreadClientMessage = Extract<
  ThreadClientMessage,
  { type: `thread.workspace-thread.${string}` }
>

export class WorkspaceThreadServiceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

/**
 * The chat each workspace page shows beside its App. The Server keeps it, so every client reopens
 * the same chat on that page; deleting the Thread forgets it.
 */
export class WorkspaceThreadService {
  readonly #persistence: WorkspaceThreadPersistenceService
  readonly #projects: ProjectThreadPersistenceService
  readonly #publish: (message: ServerMessage) => void

  constructor(options: {
    persistence: WorkspaceThreadPersistenceService
    projects: ProjectThreadPersistenceService
    publish?: (message: ServerMessage) => void
  }) {
    this.#persistence = options.persistence
    this.#projects = options.projects
    this.#publish = options.publish ?? (() => undefined)
  }

  async get(workspaceKey: string): Promise<WorkspaceThread> {
    const record = await this.#persistence.get(workspaceKey)
    return { threadId: record?.threadId ?? null, workspaceKey }
  }

  async set(workspaceKey: string, threadId: string | null): Promise<WorkspaceThread> {
    if (threadId !== null && !(await this.#projects.getThread(threadId))) {
      throw new WorkspaceThreadServiceError("THREAD_NOT_FOUND", "Thread was not found")
    }
    const current = await this.#persistence.get(workspaceKey)
    const chat = { threadId, workspaceKey }
    if ((current?.threadId ?? null) === threadId) return chat
    await this.#persistence.set(workspaceKey, threadId)
    this.#publish({ payload: chat, type: "thread.workspace-thread.updated.notification" })
    return chat
  }

  async handle(
    message: WorkspaceThreadClientMessage,
    send: (message: ServerMessage) => void
  ): Promise<void> {
    const type = message.type.replace(/\.request$/u, ".response")
    try {
      const value =
        message.type === "thread.workspace-thread.get.request"
          ? await this.get(message.payload.workspaceKey)
          : await this.set(message.payload.workspaceKey, message.payload.threadId)
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type,
      } as ThreadServerMessage)
    } catch (error) {
      send({
        payload: {
          error: {
            code:
              error instanceof WorkspaceThreadServiceError ? error.code : "WORKSPACE_CHAT_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
          ok: false,
        },
        requestId: message.requestId,
        type,
      } as ThreadServerMessage)
    }
  }
}
