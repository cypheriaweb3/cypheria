import type { CypheriaApi } from "@cypheria/client"
import type {
  Project,
  ProjectItem,
  Section,
  SectionItem,
  ThreadTimelineProjectedItem,
  ThreadView,
} from "@cypheria/protocol"

import { ensureCypheriaClient } from "./cypheria-client.js"

export const PINNED_SIDEBAR_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

export type SidebarThreadStatus = "active" | "idle" | "notLoaded" | "systemError"

export type SidebarThreadView = {
  agentId: ThreadView["agentId"]
  cwd: string
  id: string
  projectId: string | null
  sectionId: string | null
  sectionName: string | null
  status: SidebarThreadStatus
  title: string
  updatedAt: number
}

export type SidebarProjectView = Project & {
  sectionId: string | null
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
  sortKey?: "created_at" | "updated_at" | "recency_at" | "section_position"
}

type SidebarSnapshot = {
  projects: SidebarProjectView[]
  sections: SidebarSectionView[]
  threads: Array<
    SidebarThreadView & {
      createdAt: number
      position: number
      recencyAt: number | null
      sectionPosition: number | null
    }
  >
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
          sortKey === "created_at"
            ? compareNumber(left.createdAt, right.createdAt, direction)
            : sortKey === "recency_at"
              ? compareNumber(left.recencyAt, right.recencyAt, direction)
              : sortKey === "section_position"
                ? compareNumber(left.sectionPosition, right.sectionPosition, direction)
                : compareNumber(left.updatedAt, right.updatedAt, direction)
        return compared || left.id.localeCompare(right.id)
      })
    return page(values, input.cursor, input.limit)
  }

  async listProjects(): Promise<SidebarPage<SidebarProjectView>> {
    const snapshot = await this.#load(false)
    return { data: snapshot.projects, nextCursor: null }
  }

  async listSections(): Promise<SidebarPage<SidebarSectionView>> {
    const snapshot = await this.#load(false)
    return { data: snapshot.sections, nextCursor: null }
  }

  async archiveThread(threadId: string) {
    const client = await this.#client()
    const result = await client.threads.archive(threadId)
    this.invalidate()
    return result
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
    const result = await client.threads.fork({ threadId })
    this.invalidate()
    return result.thread
  }

  async moveThreadToProject(threadId: string, projectId: string | null) {
    const client = await this.#client()
    if (projectId) await client.projects.moveThread({ projectId, threadId })
    else await client.projects.removeThread(threadId)
    this.invalidate()
  }

  async moveItemToSection(
    item: { id: string; type: "project" | "thread" },
    sectionId: string | null
  ) {
    const client = await this.#client()
    if (sectionId) await client.sections.moveItem({ item, sectionId })
    else await client.sections.removeItem(item)
    this.invalidate()
  }

  async createProject(name: string, root: string) {
    const client = await this.#client()
    const result = await client.projects.create({ name, roots: [root] })
    this.invalidate()
    return result
  }

  async updateProject(projectId: string, name: string) {
    const client = await this.#client()
    const result = await client.projects.update({ name, projectId })
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
    for (const thread of snapshot.threads.filter(matches)) await client.threads.archive(thread.id)
    this.invalidate()
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
    const [threads, projects, sections] = await Promise.all([
      collectPages<ThreadView>((cursor) => client.threads.list({ archived, cursor, limit: 200 })),
      collectPages<Project>((cursor) => client.projects.list({ cursor, limit: 200 })),
      collectPages<Section>((cursor) => client.sections.list({ cursor, limit: 200 })),
    ])
    const [projectPages, sectionPages] = await Promise.all([
      Promise.all(
        projects.map(async (project) => ({
          items: await collectPages<ProjectItem>((cursor) =>
            client.projects.listThreads({ cursor, limit: 200, projectId: project.id })
          ),
          project,
        }))
      ),
      Promise.all(
        sections.map(async (section) => ({
          items: await collectPages<SectionItem>((cursor) =>
            client.sections.listItems({ cursor, limit: 200, sectionId: section.id })
          ),
          section,
        }))
      ),
    ])
    const projectByThread = new Map<string, string>()
    for (const { items, project } of projectPages)
      for (const { thread } of items) projectByThread.set(thread.id, project.id)
    const sectionByThread = new Map<string, { id: string; name: string; position: number }>()
    const sectionByProject = new Map<string, string>()
    for (const { items, section } of sectionPages) {
      for (const item of items) {
        if (item.type === "thread")
          sectionByThread.set(item.thread.id, {
            id: section.id,
            name: section.name,
            position: item.position,
          })
        else sectionByProject.set(item.project.id, section.id)
      }
    }
    if (archived) {
      const memberships = await Promise.all(
        threads.map(async (thread) => ({
          project: await client.projects.getThreadProject(thread.id),
          section: await client.sections.getItemSection({ id: thread.id, type: "thread" }),
          thread,
        }))
      )
      for (const membership of memberships) {
        if (membership.project)
          projectByThread.set(membership.thread.id, membership.project.project.id)
        if (membership.section)
          sectionByThread.set(membership.thread.id, {
            id: membership.section.section.id,
            name: membership.section.section.name,
            position: membership.section.position,
          })
      }
    }
    return {
      projects: projects.map((project) => ({
        ...project,
        sectionId: sectionByProject.get(project.id) ?? null,
      })),
      sections: sections.map(({ id, name }) => ({ id, name })),
      threads: threads.map((thread) => {
        const section = sectionByThread.get(thread.id)
        return {
          agentId: thread.agentId,
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
