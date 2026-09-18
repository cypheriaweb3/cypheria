import { randomUUID } from "node:crypto"
import { ProjectThreadPersistenceError, type ProjectThreadPersistenceService } from "@cypheria/db"
import {
  type ProjectThreadClientMessage,
  type ProjectThreadServerMessage,
  type ServerMessage,
  type ThreadClientMessage,
  ThreadSchema,
  type ThreadServerMessage,
  type ThreadState,
  type ThreadView,
} from "@cypheria/protocol"

export type ProjectThreadServiceOptions = {
  readonly persistence: ProjectThreadPersistenceService
  readonly publish?: (message: ServerMessage) => void
}

export class ProjectThreadService {
  readonly #epochs = new Map<string, string>()
  readonly #persistence: ProjectThreadPersistenceService
  readonly #publish: (message: ServerMessage) => void
  readonly #states = new Map<string, ThreadState>()

  constructor(options: ProjectThreadServiceOptions) {
    this.#persistence = options.persistence
    this.#publish = options.publish ?? (() => undefined)
  }

  async initialize(): Promise<void> {
    await this.#persistence.ensurePinnedSection()
  }

  async handle(
    message: ProjectThreadClientMessage | ThreadClientMessage,
    send: (message: ServerMessage) => void
  ): Promise<void> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ProjectThreadServerMessage | ThreadServerMessage)
    }

    try {
      switch (message.type) {
        case "project.create.request":
          respond(await this.#persistence.createProject(message.payload))
          break
        case "project.read.request":
          respond(
            await this.#required(
              this.#persistence.getProject(message.payload.projectId),
              "PROJECT_NOT_FOUND",
              "Project was not found"
            )
          )
          break
        case "project.list.request":
          respond(await this.#persistence.listProjects(message.payload))
          break
        case "project.update.request": {
          const { projectId, ...patch } = message.payload
          respond(await this.#persistence.updateProject(projectId, patch))
          break
        }
        case "project.move.request":
          await this.#persistence.moveProject(message.payload)
          respond({})
          break
        case "project.delete.request":
          await this.#persistence.deleteProject(message.payload.projectId)
          respond({})
          break
        case "thread.create.request":
          {
            const thread = await this.#persistence.createThread(message.payload)
            const view = this.#view(thread)
            const timeline = this.#timelineHead(thread.id)
            this.#publish({ payload: view, type: "thread.created.notification" })
            respond({ thread: view, timeline })
          }
          break
        case "thread.get.request":
          respond(
            this.#view(
              await this.#required(
                this.#persistence.getThread(message.payload.threadId),
                "THREAD_NOT_FOUND",
                "Thread was not found"
              )
            )
          )
          break
        case "thread.list.request": {
          const page = await this.#persistence.listThreads(message.payload)
          respond({ ...page, data: page.data.map((thread) => this.#view(thread)) })
          break
        }
        case "thread.update.request": {
          const { threadId, ...patch } = message.payload
          if (patch.cwd !== undefined && this.#state(threadId) !== "stopped") {
            throw new ProjectThreadPersistenceError(
              "THREAD_ACTIVE",
              "Thread cwd can only be changed while the thread is stopped"
            )
          }
          const view = this.#view(await this.#persistence.updateThread(threadId, patch))
          this.#publish({ payload: view, type: "thread.updated.notification" })
          respond(view)
          break
        }
        case "thread.recency.touch.request":
          {
            const view = this.#view(
              await this.#persistence.touchThreadRecency(
                message.payload.threadId,
                message.payload.recencyAt
              )
            )
            this.#publish({ payload: view, type: "thread.updated.notification" })
            respond(view)
          }
          break
        case "thread.resume.request": {
          const thread = await this.#required(
            this.#persistence.getThread(message.payload.threadId),
            "THREAD_NOT_FOUND",
            "Thread was not found"
          )
          this.#states.set(thread.id, "idle")
          const view = this.#view(thread)
          this.#publish({ payload: view, type: "thread.updated.notification" })
          respond({ thread: view, timeline: this.#timelineHead(thread.id) })
          break
        }
        case "thread.close.request": {
          const thread = await this.#required(
            this.#persistence.getThread(message.payload.threadId),
            "THREAD_NOT_FOUND",
            "Thread was not found"
          )
          this.#states.set(thread.id, "stopped")
          const view = this.#view(thread)
          this.#publish({ payload: view, type: "thread.updated.notification" })
          respond(view)
          break
        }
        case "thread.timeline.get.request": {
          const thread = await this.#required(
            this.#persistence.getThread(message.payload.threadId),
            "THREAD_NOT_FOUND",
            "Thread was not found"
          )
          const epoch = this.#timelineHead(thread.id).epoch
          respond({
            canonicalRows: [],
            endCursor: null,
            epoch,
            hasNewer: false,
            hasOlder: false,
            projectedItems: [],
            projection: message.payload.projection,
            reset:
              message.payload.cursor?.epoch !== undefined && message.payload.cursor.epoch !== epoch,
            startCursor: null,
            threadId: thread.id,
          })
          break
        }
        case "thread.turn.start.request":
        case "thread.turn.cancel.request":
        case "thread.config.update.request":
        case "thread.interaction.respond.request":
          throw new ProjectThreadPersistenceError(
            "THREAD_NOT_READY",
            "Thread execution is not available until its provider adapter is attached"
          )
        case "thread.move.request":
          await this.#persistence.moveThread(message.payload)
          respond({})
          break
        case "thread.delete.request":
          await this.#persistence.deleteThread(message.payload.threadId)
          this.#states.delete(message.payload.threadId)
          this.#epochs.delete(message.payload.threadId)
          this.#publish({
            payload: { threadId: message.payload.threadId },
            type: "thread.deleted.notification",
          })
          respond({})
          break
        case "project.item.get.request":
          respond(await this.#persistence.getThreadProject(message.payload.threadId))
          break
        case "project.item.list.request": {
          const { projectId, ...options } = message.payload
          respond(await this.#persistence.listProjectThreads(projectId, options))
          break
        }
        case "project.item.move.request":
          respond(await this.#persistence.moveThreadToProject(message.payload))
          break
        case "project.item.remove.request":
          await this.#persistence.removeThreadFromProject(message.payload.threadId)
          respond({})
          break
        case "section.create.request":
          respond(await this.#persistence.createSection(message.payload))
          break
        case "section.read.request":
          respond(
            await this.#required(
              this.#persistence.getSection(message.payload.sectionId),
              "SECTION_NOT_FOUND",
              "Section was not found"
            )
          )
          break
        case "section.list.request":
          respond(await this.#persistence.listSections(message.payload))
          break
        case "section.update.request": {
          const { sectionId, ...patch } = message.payload
          respond(await this.#persistence.updateSection(sectionId, patch))
          break
        }
        case "section.move.request":
          await this.#persistence.moveSection(message.payload)
          respond({})
          break
        case "section.delete.request":
          await this.#persistence.deleteSection(message.payload.sectionId)
          respond({})
          break
        case "section.item.get.request":
          respond(await this.#persistence.getItemSection(message.payload.item))
          break
        case "section.item.list.request": {
          const { sectionId, ...options } = message.payload
          respond(await this.#persistence.listSectionItems(sectionId, options))
          break
        }
        case "section.item.move.request":
          respond(await this.#persistence.moveItemToSection(message.payload))
          break
        case "section.item.remove.request":
          await this.#persistence.removeItemFromSection(message.payload.item)
          respond({})
          break
        case "section.item.pin.request":
          respond(await this.#persistence.pinItem(message.payload))
          break
        case "section.item.unpin.request":
          await this.#persistence.unpinItem(message.payload.item)
          respond({})
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: {
            code:
              error instanceof ProjectThreadPersistenceError
                ? error.code
                : failure.name || "PROJECT_THREAD_ERROR",
            message: failure.message,
          },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ProjectThreadServerMessage | ThreadServerMessage)
    }
  }

  #state(threadId: string): ThreadState {
    return this.#states.get(threadId) ?? "stopped"
  }

  #timelineHead(threadId: string): { endCursor: null; epoch: string } {
    let epoch = this.#epochs.get(threadId)
    if (!epoch) {
      epoch = randomUUID()
      this.#epochs.set(threadId, epoch)
    }
    return { endCursor: null, epoch }
  }

  #view(value: unknown): ThreadView {
    const thread = ThreadSchema.parse(value)
    return {
      ...thread,
      activeTurn: null,
      attention: false,
      capabilities: {
        changeCwd: true,
        configure: false,
        fork: false,
        promptContent: ["text"],
        providerExtensions: false,
      },
      pendingInteractions: [],
      state: this.#state(thread.id),
    }
  }

  async #required<T>(promise: Promise<T | undefined>, code: string, message: string): Promise<T> {
    const value = await promise
    if (value === undefined) throw new ProjectThreadPersistenceError(code, message)
    return value
  }
}
