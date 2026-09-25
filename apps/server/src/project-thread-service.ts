import {
  PINNED_SECTION_ID,
  ProjectThreadPersistenceError,
  type ProjectThreadPersistenceService,
} from "@cypheria/db"
import type {
  ProjectThreadClientMessage,
  ProjectThreadServerMessage,
  ServerMessage,
} from "@cypheria/protocol"

export type ProjectThreadServiceOptions = {
  readonly persistence: ProjectThreadPersistenceService
  readonly publish?: (message: ServerMessage) => void
}

/** Project and section CRUD. Agent execution and Thread lifecycle belong to ThreadManager. */
export class ProjectThreadService {
  readonly #persistence: ProjectThreadPersistenceService
  readonly #publish: (message: ServerMessage) => void

  constructor(options: ProjectThreadServiceOptions) {
    this.#persistence = options.persistence
    this.#publish = options.publish ?? (() => undefined)
  }

  async initialize(): Promise<void> {
    await this.#persistence.ensurePinnedSection()
    await this.cleanupDeletedResources().catch(() => undefined)
  }

  async cleanupDeletedResources(): Promise<void> {
    const failures: unknown[] = []
    for (const resource of await this.#persistence.listDeletedResources()) {
      try {
        if (resource.type === "project") {
          await this.#persistence.purgeProject(resource.value.id)
        } else if (resource.type === "section") {
          await this.#persistence.purgeSection(resource.value.id)
        }
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more deferred resources could not be cleaned up")
    }
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
        case "project.create.request": {
          const project = await this.#persistence.createProject(message.payload)
          respond(project)
          this.#publish({ payload: project, type: "project.created.notification" })
          if (message.payload.sectionPlacement) {
            await this.#publishSectionMemberships(message.payload.sectionPlacement.sectionId)
          }
          break
        }
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
          const project = await this.#persistence.updateProject(projectId, patch)
          respond(project)
          this.#publish({ payload: project, type: "project.updated.notification" })
          break
        }
        case "project.move.request":
          await this.#persistence.moveProject(message.payload)
          respond({})
          await this.#publishProjects()
          break
        case "project.delete.request": {
          const membership = await this.#persistence.getItemSection({
            id: message.payload.projectId,
            type: "project",
          })
          const projectMemberships = await this.#collectProjectMemberships(
            message.payload.projectId
          )
          await this.#persistence.markProjectDeleting(message.payload.projectId)
          this.#publish({
            payload: { projectId: message.payload.projectId },
            type: "project.deleted.notification",
          })
          for (const item of projectMemberships) {
            this.#publish({
              payload: { threadId: item.threadId },
              type: "project.membership.deleted.notification",
            })
          }
          if (membership) {
            this.#publish({
              payload: { item: { id: message.payload.projectId, type: "project" } },
              type: "section.membership.deleted.notification",
            })
          }
          await this.#persistence.purgeProject(message.payload.projectId)
          respond({})
          await this.#publishProjects()
          if (membership) await this.#publishSectionMemberships(membership.section.id)
          break
        }
        case "project.item.get.request":
          respond((await this.#persistence.getThreadProject(message.payload.threadId)) ?? null)
          break
        case "project.item.list.request": {
          const { projectId, ...options } = message.payload
          respond(await this.#persistence.listProjectThreads(projectId, options))
          break
        }
        case "project.membership.list.request":
          respond(await this.#persistence.listProjectMemberships(message.payload))
          break
        case "project.item.move.request":
          {
            const previous = await this.#persistence.getThreadProject(message.payload.threadId)
            const membership = await this.#persistence.moveThreadToProject(message.payload)
            respond(membership)
            await this.#publishProjectMemberships(message.payload.projectId)
            await this.#publishProject(message.payload.projectId)
            if (previous && previous.project.id !== message.payload.projectId) {
              await this.#publishProjectMemberships(previous.project.id)
              await this.#publishProject(previous.project.id)
            }
          }
          break
        case "project.item.remove.request":
          {
            const previous = await this.#persistence.getThreadProject(message.payload.threadId)
            await this.#persistence.removeThreadFromProject(message.payload.threadId)
            if (previous) {
              this.#publish({
                payload: { threadId: message.payload.threadId },
                type: "project.membership.deleted.notification",
              })
              await this.#publishProjectMemberships(previous.project.id)
              await this.#publishProject(previous.project.id)
            }
          }
          respond({})
          break
        case "section.create.request": {
          const section = await this.#persistence.createSection(message.payload)
          respond(section)
          this.#publish({ payload: section, type: "section.created.notification" })
          break
        }
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
          const section = await this.#persistence.updateSection(sectionId, patch)
          respond(section)
          this.#publish({ payload: section, type: "section.updated.notification" })
          break
        }
        case "section.move.request":
          await this.#persistence.moveSection(message.payload)
          respond({})
          await this.#publishSections()
          break
        case "section.delete.request": {
          const memberships = await this.#collectSectionMemberships(message.payload.sectionId)
          await this.#persistence.markSectionDeleting(message.payload.sectionId)
          this.#publish({
            payload: { sectionId: message.payload.sectionId },
            type: "section.deleted.notification",
          })
          for (const membership of memberships) {
            this.#publish({
              payload: { item: membership.item },
              type: "section.membership.deleted.notification",
            })
          }
          await this.#persistence.purgeSection(message.payload.sectionId)
          respond({})
          await this.#publishSections()
          break
        }
        case "section.item.get.request":
          respond((await this.#persistence.getItemSection(message.payload.item)) ?? null)
          break
        case "section.item.list.request": {
          const { sectionId, ...options } = message.payload
          respond(await this.#persistence.listSectionItems(sectionId, options))
          break
        }
        case "section.membership.list.request":
          respond(await this.#persistence.listSectionMemberships(message.payload))
          break
        case "section.item.move.request": {
          const previous = await this.#persistence.getItemSection(message.payload.item)
          respond(await this.#persistence.moveItemToSection(message.payload))
          await this.#publishSectionMemberships(message.payload.sectionId)
          if (previous && previous.section.id !== message.payload.sectionId) {
            await this.#publishSectionMemberships(previous.section.id)
          }
          break
        }
        case "section.item.remove.request": {
          const previous = await this.#persistence.getItemSection(message.payload.item)
          await this.#persistence.removeItemFromSection(message.payload.item)
          respond({})
          if (previous) {
            this.#publish({
              payload: { item: message.payload.item },
              type: "section.membership.deleted.notification",
            })
            await this.#publishSectionMemberships(previous.section.id)
          }
          break
        }
        case "section.item.pin.request": {
          const previous = await this.#persistence.getItemSection(message.payload.item)
          respond(await this.#persistence.pinItem(message.payload))
          await this.#publishSectionMemberships(PINNED_SECTION_ID)
          if (previous && previous.section.id !== PINNED_SECTION_ID) {
            await this.#publishSectionMemberships(previous.section.id)
          }
          break
        }
        case "section.item.unpin.request":
          await this.#persistence.unpinItem(message.payload.item)
          respond({})
          this.#publish({
            payload: { item: message.payload.item },
            type: "section.membership.deleted.notification",
          })
          await this.#publishSectionMemberships(PINNED_SECTION_ID)
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

  async #collectProjectMemberships(projectId?: string) {
    const values: Awaited<
      ReturnType<ProjectThreadPersistenceService["listProjectMemberships"]>
    >["data"] = []
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listProjectMemberships({
        cursor,
        limit: 200,
        ...(projectId === undefined ? {} : { projectId }),
      })
      values.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    return values
  }

  async #collectSectionMemberships(sectionId?: string) {
    const values: Awaited<
      ReturnType<ProjectThreadPersistenceService["listSectionMemberships"]>
    >["data"] = []
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listSectionMemberships({
        cursor,
        limit: 200,
        ...(sectionId === undefined ? {} : { sectionId }),
      })
      values.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    return values
  }

  async #publishProjectMemberships(projectId: string): Promise<void> {
    for (const membership of await this.#collectProjectMemberships(projectId)) {
      this.#publish({
        payload: membership,
        type: "project.membership.upserted.notification",
      })
    }
  }

  async #publishProject(projectId: string): Promise<void> {
    const project = await this.#persistence.getProject(projectId)
    if (project) this.#publish({ payload: project, type: "project.updated.notification" })
  }

  async #publishSectionMemberships(sectionId: string): Promise<void> {
    for (const membership of await this.#collectSectionMemberships(sectionId)) {
      this.#publish({
        payload: membership,
        type: "section.membership.upserted.notification",
      })
    }
  }

  async #publishProjects(): Promise<void> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listProjects({ cursor, limit: 200 })
      for (const project of page.data) {
        this.#publish({ payload: project, type: "project.updated.notification" })
      }
      cursor = page.nextCursor
    } while (cursor)
  }

  async #publishSections(): Promise<void> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listSections({ cursor, limit: 200 })
      for (const section of page.data) {
        this.#publish({ payload: section, type: "section.updated.notification" })
      }
      cursor = page.nextCursor
    } while (cursor)
  }
}
