import type { CypheriaApi } from "@cypheria/client"
import type {
  Project,
  ProjectMembershipRecord,
  Section,
  SectionMembershipRecord,
  ThreadTimelineProjectedItem,
  ThreadView,
} from "@cypheria/protocol"

import { ensureCypheriaClient } from "./cypheria-client.js"

export const PINNED_SIDEBAR_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

export type SidebarThreadStatus = "active" | "idle" | "notLoaded" | "systemError"

export type SidebarThreadView = {
  agentId: ThreadView["agentId"]
  attention: boolean
  createdAt?: number
  cwd: string
  id: string
  position?: number
  projectId: string | null
  recencyAt?: number | null
  sectionId: string | null
  sectionName: string | null
  sectionPosition: number | null
  status: SidebarThreadStatus
  title: string
  updatedAt: number
}

export type SidebarProjectView = Project & {
  sectionId: string | null
  sectionPosition: number | null
}

export type SidebarSectionView = Pick<Section, "id" | "name">

export type SidebarPage<T> = { data: T[]; nextCursor: string | null }

export type SidebarThreadListInput = {
  archived?: boolean
  cursor?: string | null
  limit?: number
  searchTerm?: string
  sectionId?: string | null
  sortDirection?: "asc" | "desc"
  sortKey?: "created_at" | "updated_at" | "recency_at" | "section_position" | "priority"
}

type SidebarSnapshot = {
  projects: SidebarProjectView[]
  sections: SidebarSectionView[]
  threads: SidebarThreadView[]
}

const collectPages = async <T>(
  load: (cursor: string | null) => Promise<SidebarPage<T>>
): Promise<T[]> => {
  const values: T[] = []
  let cursor: string | null = null
  do {
    const page = await load(cursor)
    values.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return values
}

const page = <T>(values: readonly T[], cursor: string | null | undefined, limit = 100) => {
  const offset = cursor ? Number.parseInt(cursor.replace("sidebar:", ""), 10) : 0
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid Sidebar cursor")
  const data = values.slice(offset, offset + limit)
  return {
    data,
    nextCursor: offset + data.length < values.length ? `sidebar:${offset + data.length}` : null,
  }
}

const statusFor = (state: ThreadView["state"]): SidebarThreadStatus => {
  if (state === "running") return "active"
  if (state === "errored") return "systemError"
  if (state === "stopped") return "notLoaded"
  return "idle"
}

const compareNumber = (left: number | null, right: number | null, direction: "asc" | "desc") => {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === "asc" ? left - right : right - left
}

export class SidebarDataApi {
  readonly #client: () => Promise<CypheriaApi>
  #snapshot: Promise<SidebarSnapshot> | undefined

  constructor(client: () => Promise<CypheriaApi> = ensureCypheriaClient) {
    this.#client = client
  }

  invalidate() {
    this.#snapshot = undefined
  }

  async listThreads(input: SidebarThreadListInput = {}): Promise<SidebarPage<SidebarThreadView>> {
    if (!(input.archived ?? false) && !input.searchTerm?.trim() && input.sortKey !== "priority") {
      return this.#listActiveThreads(input)
    }
    const snapshot = await this.#load(input.archived ?? false)
    const direction = input.sortDirection ?? "desc"
    const sortKey = input.sortKey ?? "updated_at"
    const values = snapshot.threads
      .filter(({ sectionId }) => input.sectionId === undefined || sectionId === input.sectionId)
      .filter(({ cwd, title }) => {
        const search = input.searchTerm?.trim().toLocaleLowerCase()
        return (
          !search ||
          title.toLocaleLowerCase().includes(search) ||
          cwd.toLocaleLowerCase().includes(search)
        )
      })
      .toSorted((left, right) => {
        const compared =
          sortKey === "priority"
            ? Number(right.attention) - Number(left.attention) ||
              Number(right.status === "active") - Number(left.status === "active") ||
              compareNumber(left.updatedAt, right.updatedAt, "desc")
            : sortKey === "created_at"
              ? compareNumber(left.createdAt ?? null, right.createdAt ?? null, direction)
              : sortKey === "recency_at"
                ? compareNumber(left.recencyAt ?? null, right.recencyAt ?? null, direction)
                : sortKey === "section_position"
                  ? compareNumber(left.sectionPosition, right.sectionPosition, direction)
                  : compareNumber(left.updatedAt, right.updatedAt, direction)
        return compared || left.id.localeCompare(right.id)
      })
    return page(values, input.cursor, input.limit)
  }

  async listProjects(): Promise<SidebarPage<SidebarProjectView>> {
    const client = await this.#client()
    const [projects, memberships] = await Promise.all([
      collectPages<Project>((cursor) => client.projects.list({ cursor, limit: 200 })),
      collectPages<SectionMembershipRecord>((cursor) =>
        client.sections.listMemberships({ cursor, limit: 200 })
      ),
    ])
    const sectionByProject = new Map(
      memberships.flatMap((membership) =>
        membership.item.type === "project" ? [[membership.item.id, membership] as const] : []
      )
    )
    return {
      data: projects.map((project) => {
        const membership = sectionByProject.get(project.id)
        return {
          ...project,
          sectionId: membership?.sectionId ?? null,
          sectionPosition: membership?.position ?? null,
        }
      }),
      nextCursor: null,
    }
  }

  async listSections(): Promise<SidebarPage<SidebarSectionView>> {
    const client = await this.#client()
    const sections = await collectPages<Section>((cursor) =>
      client.sections.list({ cursor, limit: 200 })
    )
    return { data: sections.map(({ id, name }) => ({ id, name })), nextCursor: null }
  }

  async archiveThread(threadId: string) {
    const client = await this.#client()
    const result = await client.threads.archive(threadId)
    this.invalidate()
    return result.thread
  }

  async unarchiveThread(threadId: string) {
    const client = await this.#client()
    const result = await client.threads.unarchive(threadId)
    this.invalidate()
    return result
  }

  async deleteThread(threadId: string) {
    const client = await this.#client()
    await client.threads.delete(threadId)
    this.invalidate()
  }

  async renameThread(threadId: string, title: string) {
    const client = await this.#client()
    const result = await client.threads.update({ threadId, title })
    this.invalidate()
    return result
  }

  async forkThread(threadId: string) {
    const client = await this.#client()
    const result = await client.threads.fork({ target: { kind: "thread-head" }, threadId })
    this.invalidate()
    return result.thread
  }

  async moveThreadToProject(
    threadId: string,
    projectId: string | null,
    beforeThreadId?: string | null
  ) {
    const client = await this.#client()
    if (projectId)
      await client.projects.moveThread({
        ...(beforeThreadId === undefined ? {} : { beforeThreadId }),
        projectId,
        threadId,
      })
    else await client.projects.removeThread(threadId)
    this.invalidate()
  }

  async moveItemToSection(
    item: { id: string; type: "project" | "thread" },
    sectionId: string | null,
    beforeItem?: { id: string; type: "project" | "thread" } | null
  ) {
    const client = await this.#client()
    if (sectionId)
      await client.sections.moveItem({
        ...(beforeItem === undefined ? {} : { beforeItem }),
        item,
        sectionId,
      })
    else await client.sections.removeItem(item)
    this.invalidate()
  }

  async moveProject(projectId: string, beforeProjectId?: string | null) {
    const client = await this.#client()
    await client.projects.move({ beforeProjectId, projectId })
    this.invalidate()
  }

  async moveSection(sectionId: string, beforeSectionId?: string | null) {
    const client = await this.#client()
    await client.sections.move({ beforeSectionId, sectionId })
    this.invalidate()
  }

  async moveThread(threadId: string, beforeThreadId?: string | null) {
    const client = await this.#client()
    await client.threads.move({ beforeThreadId, threadId })
    this.invalidate()
  }

  async createProject(name: string, root: string) {
    const client = await this.#client()
    const result = await client.projects.create({ name, roots: [root] })
    this.invalidate()
    return result
  }

  async updateProject(projectId: string, name: string, roots: readonly string[]) {
    const client = await this.#client()
    const result = await client.projects.update({ name, projectId, roots: [...roots] })
    this.invalidate()
    return result
  }

  async deleteProject(projectId: string) {
    const client = await this.#client()
    await client.projects.delete(projectId)
    this.invalidate()
  }

  async createSection(name: string) {
    const client = await this.#client()
    const result = await client.sections.create({ name })
    this.invalidate()
    return result
  }

  async updateSection(sectionId: string, name: string) {
    const client = await this.#client()
    const result = await client.sections.update({ name, sectionId })
    this.invalidate()
    return result
  }

  async deleteSection(sectionId: string) {
    const client = await this.#client()
    await client.sections.delete(sectionId)
    this.invalidate()
  }

  async readThread(threadId: string): Promise<ThreadTimelineProjectedItem[]> {
    const client = await this.#client()
    return (
      await client.timeline.get({
        direction: "tail",
        limit: 500,
        projection: "projected",
        threadId,
      })
    ).projectedItems
  }

  async archiveMatchingThreads(matches: (thread: SidebarThreadView) => boolean) {
    const client = await this.#client()
    const snapshot = await this.#load(false)
    const threadIds = snapshot.threads.filter(matches).map((thread) => thread.id)
    if (threadIds.length === 0) return
    const result = await client.threads.archiveMany(threadIds)
    this.invalidate()
    if (result.failed.length > 0) {
      throw new Error(
        result.failed.map((failure) => `${failure.threadId}: ${failure.message}`).join("\n")
      )
    }
  }

  async #listActiveThreads(input: SidebarThreadListInput): Promise<SidebarPage<SidebarThreadView>> {
    const client = await this.#client()
    const requestedSort = input.sortKey ?? "updated_at"
    const sortKey =
      requestedSort === "created_at"
        ? "createdAt"
        : requestedSort === "updated_at"
          ? "updatedAt"
          : requestedSort === "recency_at" || requestedSort === "priority"
            ? "recencyAt"
            : input.sectionId
              ? "sectionPosition"
              : "position"
    const [result, projectMemberships, sectionMemberships, sections] = await Promise.all([
      client.threads.list({
        archived: false,
        cursor: input.cursor,
        limit: input.limit,
        sectionId: input.sectionId,
        sortDirection: input.sortDirection,
        sortKey,
      }),
      collectPages<ProjectMembershipRecord>((cursor) =>
        client.projects.listMemberships({ cursor, limit: 200 })
      ),
      collectPages<SectionMembershipRecord>((cursor) =>
        client.sections.listMemberships({ cursor, limit: 200 })
      ),
      collectPages<Section>((cursor) => client.sections.list({ cursor, limit: 200 })),
    ])
    const projectByThread = new Map(
      projectMemberships.map(({ projectId, threadId }) => [threadId, projectId])
    )
    const sectionById = new Map(sections.map((section) => [section.id, section]))
    const sectionByThread = new Map(
      sectionMemberships.flatMap((membership) =>
        membership.item.type === "thread" ? [[membership.item.id, membership] as const] : []
      )
    )
    const data = result.data.map((thread) => {
      const sectionMembership = sectionByThread.get(thread.id)
      const section = sectionMembership ? sectionById.get(sectionMembership.sectionId) : undefined
      return {
        agentId: thread.agentId,
        attention: thread.attention,
        createdAt: thread.createdAt,
        cwd: thread.cwd ?? "",
        id: thread.id,
        position: thread.position,
        projectId: projectByThread.get(thread.id) ?? null,
        recencyAt: thread.recencyAt,
        sectionId: sectionMembership?.sectionId ?? null,
        sectionName: section?.name ?? null,
        sectionPosition: sectionMembership?.position ?? null,
        status: statusFor(thread.state),
        title: thread.title ?? "New chat",
        updatedAt: thread.updatedAt,
      }
    })
    if (requestedSort === "priority") {
      data.sort(
        (left, right) =>
          Number(right.attention) - Number(left.attention) ||
          Number(right.status === "active") - Number(left.status === "active") ||
          right.updatedAt - left.updatedAt ||
          left.id.localeCompare(right.id)
      )
    }
    return { data, nextCursor: result.nextCursor }
  }

  async #load(archived: boolean): Promise<SidebarSnapshot> {
    if (archived) return this.#createSnapshot(true)
    if (!this.#snapshot) {
      const pending = this.#createSnapshot(false).catch((error) => {
        this.#snapshot = undefined
        throw error
      })
      this.#snapshot = pending
      void pending.then(() => {
        setTimeout(() => {
          if (this.#snapshot === pending) this.#snapshot = undefined
        }, 100)
      })
    }
    return this.#snapshot
  }

  async #createSnapshot(archived: boolean): Promise<SidebarSnapshot> {
    const client = await this.#client()
    const [threads, projects, sections, projectMemberships, sectionMemberships] = await Promise.all(
      [
        collectPages<ThreadView>((cursor) => client.threads.list({ archived, cursor, limit: 200 })),
        collectPages<Project>((cursor) => client.projects.list({ cursor, limit: 200 })),
        collectPages<Section>((cursor) => client.sections.list({ cursor, limit: 200 })),
        collectPages<ProjectMembershipRecord>((cursor) =>
          client.projects.listMemberships({ cursor, limit: 200 })
        ),
        collectPages<SectionMembershipRecord>((cursor) =>
          client.sections.listMemberships({ cursor, limit: 200 })
        ),
      ]
    )
    const projectByThread = new Map(
      projectMemberships.map(({ projectId, threadId }) => [threadId, projectId])
    )
    const sectionByThread = new Map<string, { id: string; name: string; position: number }>()
    const sectionByProject = new Map<string, { id: string; position: number }>()
    const sectionById = new Map(sections.map((section) => [section.id, section]))
    for (const membership of sectionMemberships) {
      if (membership.item.type === "thread") {
        const section = sectionById.get(membership.sectionId)
        if (section) {
          sectionByThread.set(membership.item.id, {
            id: section.id,
            name: section.name,
            position: membership.position,
          })
        }
      } else {
        sectionByProject.set(membership.item.id, {
          id: membership.sectionId,
          position: membership.position,
        })
      }
    }
    return {
      projects: projects.map((project) => ({
        ...project,
        sectionId: sectionByProject.get(project.id)?.id ?? null,
        sectionPosition: sectionByProject.get(project.id)?.position ?? null,
      })),
      sections: sections.map(({ id, name }) => ({ id, name })),
      threads: threads.map((thread) => {
        const section = sectionByThread.get(thread.id)
        return {
          agentId: thread.agentId,
          attention: thread.attention,
          createdAt: thread.createdAt,
          cwd: thread.cwd ?? "",
          id: thread.id,
          position: thread.position,
          projectId: projectByThread.get(thread.id) ?? null,
          recencyAt: thread.recencyAt,
          sectionId: section?.id ?? null,
          sectionName: section?.name ?? null,
          sectionPosition: section?.position ?? null,
          status: statusFor(thread.state),
          title: thread.title ?? "New chat",
          updatedAt: thread.updatedAt,
        }
      }),
    }
  }
}

export const sidebarData = new SidebarDataApi()

export const sidebarQueryKeys = {
  all: ["cypheria", "sidebar"] as const,
  projects: () => [...sidebarQueryKeys.all, "projects"] as const,
  sections: () => [...sidebarQueryKeys.all, "sections"] as const,
  threads: (...scope: readonly unknown[]) =>
    [...sidebarQueryKeys.all, "threads", ...scope] as const,
}
