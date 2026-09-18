import { ProjectThreadPersistenceError, type ProjectThreadPersistenceService } from "@cypheria/db"
import type {
  ProjectThreadClientMessage,
  ProjectThreadServerMessage,
  ServerMessage,
} from "@cypheria/protocol"

export type ProjectThreadServiceOptions = {
  readonly persistence: ProjectThreadPersistenceService
}

export class ProjectThreadService {
  readonly #persistence: ProjectThreadPersistenceService

  constructor(options: ProjectThreadServiceOptions) {
    this.#persistence = options.persistence
  }

  async initialize(): Promise<void> {
    await this.#persistence.ensurePinnedSection()
  }

  async handle(
    message: ProjectThreadClientMessage,
    send: (message: ServerMessage) => void
  ): Promise<void> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ProjectThreadServerMessage)
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
          respond(await this.#persistence.createThread(message.payload))
          break
        case "thread.read.request":
          respond(
            await this.#required(
              this.#persistence.getThread(message.payload.threadId),
              "THREAD_NOT_FOUND",
              "Thread was not found"
            )
          )
          break
        case "thread.list.request":
          respond(await this.#persistence.listThreads(message.payload))
          break
        case "thread.update.request": {
          const { threadId, ...patch } = message.payload
          respond(await this.#persistence.updateThread(threadId, patch))
          break
        }
        case "thread.recency.touch.request":
          respond(
            await this.#persistence.touchThreadRecency(
              message.payload.threadId,
              message.payload.recencyAt
            )
          )
          break
        case "thread.move.request":
          await this.#persistence.moveThread(message.payload)
          respond({})
          break
        case "thread.delete.request":
          await this.#persistence.deleteThread(message.payload.threadId)
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
      } as ProjectThreadServerMessage)
    }
  }

  async #required<T>(promise: Promise<T | undefined>, code: string, message: string): Promise<T> {
    const value = await promise
    if (value === undefined) throw new ProjectThreadPersistenceError(code, message)
    return value
  }
}
