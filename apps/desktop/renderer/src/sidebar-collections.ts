import type { CypheriaApi } from "@cypheria/client"
import type {
  Project,
  ProjectMembershipRecord,
  Section,
  SectionMembershipRecord,
  ServerMessage,
  ThreadView,
} from "@cypheria/protocol"
import { type Collection, createCollection } from "@tanstack/db"
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection"
import type { QueryClient } from "@tanstack/react-query"

import { cypheriaClient, ensureCypheriaClient } from "./cypheria-client.js"

const collectPages = async <T>(
  load: (cursor: string | null) => Promise<{ data: T[]; nextCursor: string | null }>
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

const sectionMembershipKey = (membership: SectionMembershipRecord) =>
  `${membership.item.type}:${membership.item.id}`

export type SidebarCollections = {
  readonly projectMemberships: Collection<ProjectMembershipRecord, string>
  readonly projects: Collection<Project, string>
  readonly sectionMemberships: Collection<SectionMembershipRecord, string>
  readonly sections: Collection<Section, string>
  readonly threads: Collection<ThreadView, string>
  invalidate(): Promise<void>
}

const collectionsByQueryClient = new WeakMap<QueryClient, SidebarCollections>()
const desktopRuntime = typeof window !== "undefined"

export const getSidebarCollections = (queryClient: QueryClient): SidebarCollections => {
  const existing = collectionsByQueryClient.get(queryClient)
  if (existing) return existing

  const client = (): Promise<CypheriaApi> => ensureCypheriaClient()
  const projects = createCollection<Project, string>(
    queryCollectionOptions({
      enabled: desktopRuntime,
      getKey: (project) => project.id,
      id: "sidebar-projects",
      queryClient,
      queryFn: async ({ signal }) => {
        const api = await client()
        return collectPages((cursor) => api.projects.list({ cursor, limit: 200 }, { signal }))
      },
      queryKey: ["cypheria", "sidebar-db", "projects"],
    })
  )
  const sections = createCollection<Section, string>(
    queryCollectionOptions({
      enabled: desktopRuntime,
      getKey: (section) => section.id,
      id: "sidebar-sections",
      queryClient,
      queryFn: async ({ signal }) => {
        const api = await client()
        return collectPages((cursor) => api.sections.list({ cursor, limit: 200 }, { signal }))
      },
      queryKey: ["cypheria", "sidebar-db", "sections"],
    })
  )
  const projectMemberships = createCollection<ProjectMembershipRecord, string>(
    queryCollectionOptions({
      enabled: desktopRuntime,
      getKey: (membership) => membership.threadId,
      id: "sidebar-project-memberships",
      queryClient,
      queryFn: async ({ signal }) => {
        const api = await client()
        return collectPages((cursor) =>
          api.projects.listMemberships({ cursor, limit: 200 }, { signal })
        )
      },
      queryKey: ["cypheria", "sidebar-db", "project-memberships"],
    })
  )
  const sectionMemberships = createCollection<SectionMembershipRecord, string>(
    queryCollectionOptions({
      enabled: desktopRuntime,
      getKey: sectionMembershipKey,
      id: "sidebar-section-memberships",
      queryClient,
      queryFn: async ({ signal }) => {
        const api = await client()
        return collectPages((cursor) =>
          api.sections.listMemberships({ cursor, limit: 200 }, { signal })
        )
      },
      queryKey: ["cypheria", "sidebar-db", "section-memberships"],
    })
  )
  const threads = createCollection<ThreadView, string>(
    queryCollectionOptions({
      enabled: desktopRuntime,
      getKey: (thread) => thread.id,
      id: "sidebar-threads",
      queryClient,
      queryFn: async ({ meta, signal }) => {
        const options = meta?.loadSubsetOptions
        const parsed = parseLoadSubsetOptions(options)
        for (const filter of parsed.filters) {
          if (
            filter.field.join(".") !== "archivedAt" ||
            filter.operator !== "eq" ||
            filter.value !== null
          ) {
            throw new Error("Unsupported Sidebar Thread collection predicate")
          }
        }
        const api = await client()
        const values = await collectPages((cursor) =>
          api.threads.list({ archived: false, cursor, limit: 200 }, { signal })
        )
        for (const sort of parsed.sorts.toReversed()) {
          const field = sort.field.join(".") as keyof ThreadView
          if (!(["createdAt", "position", "recencyAt", "updatedAt"] as string[]).includes(field)) {
            throw new Error("Unsupported Sidebar Thread collection sort")
          }
          values.sort((left, right) => {
            const leftValue = left[field]
            const rightValue = right[field]
            if (leftValue === rightValue) return left.id.localeCompare(right.id)
            if (leftValue === null) return 1
            if (rightValue === null) return -1
            if (typeof leftValue !== "number" || typeof rightValue !== "number") {
              throw new Error("Unsupported Sidebar Thread collection sort value")
            }
            return sort.direction === "asc" ? leftValue - rightValue : rightValue - leftValue
          })
        }
        const offset = options?.offset ?? 0
        return values.slice(offset, parsed.limit === undefined ? undefined : offset + parsed.limit)
      },
      queryKey: (options) => {
        const parsed = parseLoadSubsetOptions(options)
        const key: unknown[] = ["cypheria", "sidebar-db", "threads", "active"]
        if (parsed.filters.length > 0) key.push({ filters: parsed.filters })
        if (parsed.sorts.length > 0) key.push({ sorts: parsed.sorts })
        if (options.offset !== undefined) key.push({ offset: options.offset })
        if (parsed.limit !== undefined) key.push({ limit: parsed.limit })
        return key
      },
      syncMode: "on-demand",
    })
  )

  const applyNotification = (message: ServerMessage) => {
    switch (message.type) {
      case "project.created.notification":
      case "project.updated.notification":
        projects.utils.writeUpsert(message.payload)
        break
      case "project.deleted.notification":
        projects.utils.writeDelete(message.payload.projectId)
        break
      case "section.created.notification":
      case "section.updated.notification":
        sections.utils.writeUpsert(message.payload)
        break
      case "section.deleted.notification":
        sections.utils.writeDelete(message.payload.sectionId)
        break
      case "project.membership.upserted.notification":
        projectMemberships.utils.writeUpsert(message.payload)
        break
      case "project.membership.deleted.notification":
        projectMemberships.utils.writeDelete(message.payload.threadId)
        break
      case "section.membership.upserted.notification":
        sectionMemberships.utils.writeUpsert(message.payload)
        break
      case "section.membership.deleted.notification":
        sectionMemberships.utils.writeDelete(
          `${message.payload.item.type}:${message.payload.item.id}`
        )
        break
      case "thread.created.notification":
      case "thread.updated.notification":
        if (message.payload.archivedAt === null) threads.utils.writeUpsert(message.payload)
        else threads.utils.writeDelete(message.payload.id)
        break
      case "thread.deleted.notification":
        threads.utils.writeDelete(message.payload.threadId)
        break
    }
  }
  cypheriaClient.subscribe(applyNotification)

  const collections: SidebarCollections = {
    projectMemberships,
    projects,
    sectionMemberships,
    sections,
    threads,
    async invalidate() {
      await Promise.all([
        projects.utils.refetch(),
        sections.utils.refetch(),
        projectMemberships.utils.refetch(),
        sectionMemberships.utils.refetch(),
        threads.utils.refetch(),
      ])
    },
  }
  collectionsByQueryClient.set(queryClient, collections)
  return collections
}
