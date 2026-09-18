import { randomBytes } from "node:crypto"
import { isAbsolute, normalize } from "node:path"

import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import type { CypheriaDatabase } from "./client.js"
import { projectItems, projects, sectionItems, sections, threads } from "./schema/index.js"

export const PINNED_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318" as const

export type ProjectRecord = typeof projects.$inferSelect
export type ThreadRecord = typeof threads.$inferSelect
export type SectionRecord = typeof sections.$inferSelect
export type ProjectItemRecord = typeof projectItems.$inferSelect
export type SectionItemRecord = typeof sectionItems.$inferSelect

export type Page<T> = {
  readonly data: T[]
  readonly nextCursor: string | null
}

export type SortDirection = "asc" | "desc"

export type SectionItemRef =
  | { readonly id: string; readonly type: "thread" }
  | { readonly id: string; readonly type: "project" }

export type ProjectItemView = {
  readonly createdAt: number
  readonly position: number
  readonly thread: ThreadRecord
  readonly updatedAt: number
}

export type ProjectMembershipView = {
  readonly createdAt: number
  readonly position: number
  readonly project: ProjectRecord
  readonly updatedAt: number
}

export type SectionItemView =
  | {
      readonly createdAt: number
      readonly position: number
      readonly project: ProjectRecord
      readonly type: "project"
      readonly updatedAt: number
    }
  | {
      readonly createdAt: number
      readonly position: number
      readonly thread: ThreadRecord
      readonly type: "thread"
      readonly updatedAt: number
    }

export type SectionMembershipView = {
  readonly createdAt: number
  readonly position: number
  readonly section: SectionRecord
  readonly updatedAt: number
}

export type SectionPlacement = {
  readonly beforeItem?: SectionItemRef | null
  readonly sectionId: string
}

export type ProjectPlacement = {
  readonly beforeThreadId?: string | null
  readonly projectId: string
}

export type CreateProjectInput = {
  readonly beforeProjectId?: string | null
  readonly name: string
  readonly roots: readonly string[]
  readonly sectionPlacement?: SectionPlacement
}

export type CreateThreadInput = {
  readonly agentId: string
  readonly agentSessionId?: string | null
  readonly beforeThreadId?: string | null
  readonly cwd?: string | null
  readonly forkedFromId?: string | null
  readonly id?: string
  readonly projectPlacement?: ProjectPlacement
  readonly recencyAt?: number | null
  readonly sectionPlacement?: SectionPlacement
  readonly title?: string | null
}

export type ListProjectsOptions = {
  readonly cursor?: string | null
  readonly limit?: number
  readonly sortDirection?: SortDirection
  readonly sortKey?: "position" | "recencyAt"
}

export type ListThreadsOptions = {
  readonly agentId?: string
  readonly archived?: boolean
  readonly cursor?: string | null
  readonly forkedFromId?: string
  readonly limit?: number
  readonly projectId?: string
  readonly sectionId?: string
  readonly sortDirection?: SortDirection
  readonly sortKey?: "position" | "recencyAt"
}

export type ListOptions = {
  readonly cursor?: string | null
  readonly limit?: number
}

export class ProjectThreadPersistenceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

export type ProjectThreadPersistenceService = {
  bindThreadAgentSession(
    threadId: string,
    agentSessionId: string | null,
    now?: number
  ): Promise<ThreadRecord>
  createProject(input: CreateProjectInput, now?: number): Promise<ProjectRecord>
  createSection(
    input: {
      beforeSectionId?: string | null
      color?: string | null
      icon?: string | null
      name: string
    },
    now?: number
  ): Promise<SectionRecord>
  createThread(input: CreateThreadInput, now?: number): Promise<ThreadRecord>
  deleteProject(projectId: string, now?: number): Promise<void>
  deleteSection(sectionId: string, now?: number): Promise<void>
  deleteThread(threadId: string, now?: number): Promise<void>
  ensurePinnedSection(now?: number): Promise<SectionRecord>
  getItemSection(item: SectionItemRef): Promise<SectionMembershipView | undefined>
  getProject(projectId: string): Promise<ProjectRecord | undefined>
  getSection(sectionId: string): Promise<SectionRecord | undefined>
  getThread(threadId: string): Promise<ThreadRecord | undefined>
  getThreadProject(threadId: string): Promise<ProjectMembershipView | undefined>
  listProjectThreads(projectId: string, options?: ListOptions): Promise<Page<ProjectItemView>>
  listProjects(options?: ListProjectsOptions): Promise<Page<ProjectRecord>>
  listSectionItems(sectionId: string, options?: ListOptions): Promise<Page<SectionItemView>>
  listSections(options?: ListOptions): Promise<Page<SectionRecord>>
  listThreads(options?: ListThreadsOptions): Promise<Page<ThreadRecord>>
  moveItemToSection(
    input: { beforeItem?: SectionItemRef | null; item: SectionItemRef; sectionId: string },
    now?: number
  ): Promise<SectionMembershipView>
  moveProject(
    input: { beforeProjectId?: string | null; projectId: string },
    now?: number
  ): Promise<void>
  moveSection(
    input: { beforeSectionId?: string | null; sectionId: string },
    now?: number
  ): Promise<void>
  moveThread(
    input: { beforeThreadId?: string | null; threadId: string },
    now?: number
  ): Promise<void>
  moveThreadToProject(
    input: { beforeThreadId?: string | null; projectId: string; threadId: string },
    now?: number
  ): Promise<ProjectMembershipView>
  pinItem(
    input: { beforeItem?: SectionItemRef | null; item: SectionItemRef },
    now?: number
  ): Promise<SectionMembershipView>
  removeItemFromSection(item: SectionItemRef, now?: number): Promise<void>
  removeThreadFromProject(threadId: string, now?: number): Promise<void>
  setThreadArchived(
    threadId: string,
    archivedAt: number | null,
    now?: number
  ): Promise<ThreadRecord>
  touchThreadRecency(threadId: string, recencyAt: number, now?: number): Promise<ThreadRecord>
  unpinItem(item: SectionItemRef, now?: number): Promise<void>
  updateProject(
    projectId: string,
    patch: { name?: string; roots?: readonly string[] },
    now?: number
  ): Promise<ProjectRecord>
  updateSection(
    sectionId: string,
    patch: { color?: string | null; icon?: string | null; name?: string },
    now?: number
  ): Promise<SectionRecord>
  updateThread(
    threadId: string,
    patch: { cwd?: string | null; title?: string | null },
    now?: number
  ): Promise<ThreadRecord>
}

type TransactionCallback = Parameters<CypheriaDatabase["transaction"]>[0]
type ProjectThreadTransaction = Parameters<TransactionCallback>[0]
type ProjectThreadExecutor = CypheriaDatabase | ProjectThreadTransaction

const uuidV7Schema = z.uuidv7()
const timestampSchema = z.int().nonnegative()
const PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 200
const POSITION_OFFSET = 1_000_000_000

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

export const createThreadId = (now = Date.now()): string => {
  const bytes = randomBytes(16)
  let timestamp = BigInt(now)
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const parseId = (value: string): string => uuidV7Schema.parse(value)
const parseTimestamp = (value: number): number => timestampSchema.parse(value)
const parseNow = (value: number): number => timestampSchema.parse(value)

const parseName = (value: string): string => {
  const name = value.trim()
  if (!name) throw new ProjectThreadPersistenceError("INVALID_NAME", "Name must not be empty")
  return name
}

const parseRoots = (values: readonly string[]): string[] => {
  if (values.length === 0) {
    throw new ProjectThreadPersistenceError("INVALID_ROOTS", "A project requires at least one root")
  }
  const roots = [...new Set(values.map((value) => normalize(value.trim())))]
  if (roots.some((root) => !isAbsolute(root))) {
    throw new ProjectThreadPersistenceError("INVALID_ROOTS", "Project roots must be absolute paths")
  }
  return roots
}

const parseLimit = (value = PAGE_LIMIT): number => {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_PAGE_LIMIT) {
    throw new ProjectThreadPersistenceError(
      "INVALID_PAGE_LIMIT",
      `Page limit must be between 1 and ${MAX_PAGE_LIMIT}`
    )
  }
  return value
}

const encodeCursor = (id: string | number): string =>
  Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url")

const decodeCursor = (cursor: string): string | number => {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      (typeof value.id === "string" || typeof value.id === "number")
    ) {
      return value.id
    }
  } catch {
    // Replaced with the stable domain error below.
  }
  throw new ProjectThreadPersistenceError("INVALID_CURSOR", "Pagination cursor is invalid")
}

const paginate = <T>(
  values: readonly T[],
  options: ListOptions,
  id: (value: T) => string | number
): Page<T> => {
  const limit = parseLimit(options.limit)
  let start = 0
  if (options.cursor) {
    const cursorId = decodeCursor(options.cursor)
    const index = values.findIndex((value) => id(value) === cursorId)
    if (index < 0)
      throw new ProjectThreadPersistenceError("INVALID_CURSOR", "Cursor item was not found")
    start = index + 1
  }
  const data = values.slice(start, start + limit)
  const hasMore = start + data.length < values.length
  const last = data.at(-1)
  return {
    data: [...data],
    nextCursor: hasMore && last !== undefined ? encodeCursor(id(last)) : null,
  }
}

const insertBefore = <T extends string | number>(
  current: readonly T[],
  item: T,
  before: T | null | undefined,
  code: string
): T[] => {
  if (before === item) {
    if (current.includes(item)) return [...current]
    throw new ProjectThreadPersistenceError(code, "The before item is not in the destination list")
  }
  const values = current.filter((value) => value !== item)
  if (before === null || before === undefined) return [...values, item]
  const index = values.indexOf(before)
  if (index < 0)
    throw new ProjectThreadPersistenceError(code, "The before item is not in the destination list")
  values.splice(index, 0, item)
  return values
}

const compareNullableNumber = (
  left: number | null,
  right: number | null,
  direction: SortDirection
): number => {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === "asc" ? left - right : right - left
}

const loadProject = async (
  db: ProjectThreadExecutor,
  projectId: string
): Promise<ProjectRecord | undefined> => {
  const [record] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  return record
}

const loadThread = async (
  db: ProjectThreadExecutor,
  threadId: string
): Promise<ThreadRecord | undefined> => {
  const [record] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1)
  return record
}

const loadSection = async (
  db: ProjectThreadExecutor,
  sectionId: string
): Promise<SectionRecord | undefined> => {
  const [record] = await db.select().from(sections).where(eq(sections.id, sectionId)).limit(1)
  return record
}

const requireProject = async (db: ProjectThreadExecutor, id: string): Promise<ProjectRecord> => {
  const project = await loadProject(db, parseId(id))
  if (!project)
    throw new ProjectThreadPersistenceError("PROJECT_NOT_FOUND", "Project was not found")
  return project
}

const requireThread = async (db: ProjectThreadExecutor, id: string): Promise<ThreadRecord> => {
  const thread = await loadThread(db, parseId(id))
  if (!thread) throw new ProjectThreadPersistenceError("THREAD_NOT_FOUND", "Thread was not found")
  return thread
}

const requireSection = async (db: ProjectThreadExecutor, id: string): Promise<SectionRecord> => {
  const section = await loadSection(db, parseId(id))
  if (!section)
    throw new ProjectThreadPersistenceError("SECTION_NOT_FOUND", "Section was not found")
  return section
}

const projectIdsByPosition = async (db: ProjectThreadExecutor): Promise<string[]> =>
  (
    await db
      .select({ id: projects.id })
      .from(projects)
      .orderBy(asc(projects.position), asc(projects.id))
  ).map(({ id }) => id)

const threadIdsByPosition = async (db: ProjectThreadExecutor): Promise<string[]> =>
  (
    await db
      .select({ id: threads.id })
      .from(threads)
      .orderBy(asc(threads.position), asc(threads.id))
  ).map(({ id }) => id)

const sectionIdsByPosition = async (db: ProjectThreadExecutor): Promise<string[]> =>
  (
    await db
      .select({ id: sections.id })
      .from(sections)
      .orderBy(asc(sections.position), asc(sections.id))
  ).map(({ id }) => id)

const projectItemIdsByPosition = async (
  db: ProjectThreadExecutor,
  projectId: string
): Promise<string[]> =>
  (
    await db
      .select({ id: projectItems.threadId })
      .from(projectItems)
      .where(eq(projectItems.projectId, projectId))
      .orderBy(asc(projectItems.position), asc(projectItems.threadId))
  ).map(({ id }) => id)

const sectionItemIdsByPosition = async (
  db: ProjectThreadExecutor,
  sectionId: string
): Promise<number[]> =>
  (
    await db
      .select({ id: sectionItems.id })
      .from(sectionItems)
      .where(eq(sectionItems.sectionId, sectionId))
      .orderBy(asc(sectionItems.position), asc(sectionItems.id))
  ).map(({ id }) => id)

const reindexProjects = async (
  db: ProjectThreadExecutor,
  ids: readonly string[],
  now: number
): Promise<void> => {
  const current = new Map(
    (await db.select({ id: projects.id, position: projects.position }).from(projects)).map(
      ({ id, position }) => [id, position]
    )
  )
  const changed = ids.flatMap((id, position) =>
    current.get(id) === position ? [] : [{ id, position }]
  )
  for (const { id } of changed) {
    await db
      .update(projects)
      .set({ position: sql`${projects.position} + ${POSITION_OFFSET}` })
      .where(eq(projects.id, id))
  }
  for (const { id, position } of changed) {
    await db.update(projects).set({ position, updatedAt: now }).where(eq(projects.id, id))
  }
}

const reindexThreads = async (
  db: ProjectThreadExecutor,
  ids: readonly string[],
  now: number
): Promise<void> => {
  const current = new Map(
    (await db.select({ id: threads.id, position: threads.position }).from(threads)).map(
      ({ id, position }) => [id, position]
    )
  )
  const changed = ids.flatMap((id, position) =>
    current.get(id) === position ? [] : [{ id, position }]
  )
  for (const { id } of changed) {
    await db
      .update(threads)
      .set({ position: sql`${threads.position} + ${POSITION_OFFSET}` })
      .where(eq(threads.id, id))
  }
  for (const { id, position } of changed) {
    await db.update(threads).set({ position, updatedAt: now }).where(eq(threads.id, id))
  }
}

const reindexSections = async (
  db: ProjectThreadExecutor,
  ids: readonly string[],
  now: number
): Promise<void> => {
  const current = new Map(
    (await db.select({ id: sections.id, position: sections.position }).from(sections)).map(
      ({ id, position }) => [id, position]
    )
  )
  const changed = ids.flatMap((id, position) =>
    current.get(id) === position ? [] : [{ id, position }]
  )
  for (const { id } of changed) {
    await db
      .update(sections)
      .set({ position: sql`${sections.position} + ${POSITION_OFFSET}` })
      .where(eq(sections.id, id))
  }
  for (const { id, position } of changed) {
    await db.update(sections).set({ position, updatedAt: now }).where(eq(sections.id, id))
  }
}

const reindexProjectItems = async (
  db: ProjectThreadExecutor,
  projectId: string,
  ids: readonly string[],
  now: number
): Promise<void> => {
  const current = new Map(
    (
      await db
        .select({ id: projectItems.threadId, position: projectItems.position })
        .from(projectItems)
        .where(eq(projectItems.projectId, projectId))
    ).map(({ id, position }) => [id, position])
  )
  const changed = ids.flatMap((id, position) =>
    current.get(id) === position ? [] : [{ id, position }]
  )
  for (const { id } of changed) {
    await db
      .update(projectItems)
      .set({ position: sql`${projectItems.position} + ${POSITION_OFFSET}` })
      .where(and(eq(projectItems.projectId, projectId), eq(projectItems.threadId, id)))
  }
  for (const { id: threadId, position } of changed) {
    await db
      .update(projectItems)
      .set({ position, updatedAt: now })
      .where(and(eq(projectItems.projectId, projectId), eq(projectItems.threadId, threadId)))
  }
}

const reindexSectionItems = async (
  db: ProjectThreadExecutor,
  sectionId: string,
  ids: readonly number[],
  now: number
): Promise<void> => {
  const current = new Map(
    (
      await db
        .select({ id: sectionItems.id, position: sectionItems.position })
        .from(sectionItems)
        .where(eq(sectionItems.sectionId, sectionId))
    ).map(({ id, position }) => [id, position])
  )
  const changed = ids.flatMap((id, position) =>
    current.get(id) === position ? [] : [{ id, position }]
  )
  for (const { id } of changed) {
    await db
      .update(sectionItems)
      .set({ position: sql`${sectionItems.position} + ${POSITION_OFFSET}` })
      .where(eq(sectionItems.id, id))
  }
  for (const { id, position } of changed) {
    await db.update(sectionItems).set({ position, updatedAt: now }).where(eq(sectionItems.id, id))
  }
}

const recomputeProjectRecency = async (
  db: ProjectThreadExecutor,
  projectId: string,
  now: number
): Promise<void> => {
  const values = await db
    .select({ recencyAt: threads.recencyAt })
    .from(projectItems)
    .innerJoin(threads, eq(projectItems.threadId, threads.id))
    .where(and(eq(projectItems.projectId, projectId), isNull(threads.archivedAt)))
  const recencies = values.flatMap(({ recencyAt }) => (recencyAt === null ? [] : [recencyAt]))
  const recencyAt = recencies.length === 0 ? null : Math.max(...recencies)
  const project = await requireProject(db, projectId)
  if (project.recencyAt === recencyAt) return
  await db.update(projects).set({ recencyAt, updatedAt: now }).where(eq(projects.id, projectId))
}

const findProjectItem = async (
  db: ProjectThreadExecutor,
  threadId: string
): Promise<ProjectItemRecord | undefined> => {
  const [item] = await db
    .select()
    .from(projectItems)
    .where(eq(projectItems.threadId, threadId))
    .limit(1)
  return item
}

const findSectionItem = async (
  db: ProjectThreadExecutor,
  item: SectionItemRef
): Promise<SectionItemRecord | undefined> => {
  const parsed = { ...item, id: parseId(item.id) }
  const [record] = await db
    .select()
    .from(sectionItems)
    .where(
      parsed.type === "thread"
        ? eq(sectionItems.threadId, parsed.id)
        : eq(sectionItems.projectId, parsed.id)
    )
    .limit(1)
  return record
}

const moveItemToSectionInTransaction = async (
  db: ProjectThreadTransaction,
  input: { beforeItem?: SectionItemRef | null; item: SectionItemRef; sectionId: string },
  now: number
): Promise<SectionMembershipView> => {
  const section = await requireSection(db, input.sectionId)
  if (input.item.type === "thread") await requireThread(db, input.item.id)
  else await requireProject(db, input.item.id)

  const existing = await findSectionItem(db, input.item)
  const oldSectionId = existing?.sectionId
  let targetIds = await sectionItemIdsByPosition(db, section.id)
  if (existing && oldSectionId === section.id) {
    let beforeId: number | null | undefined
    if (input.beforeItem) {
      const before = await findSectionItem(db, input.beforeItem)
      if (!before || before.sectionId !== section.id) {
        throw new ProjectThreadPersistenceError(
          "INVALID_BEFORE_ITEM",
          "The before item is not in the destination section"
        )
      }
      beforeId = before.id
    }
    const ordered = insertBefore(targetIds, existing.id, beforeId, "INVALID_BEFORE_ITEM")
    if (ordered.every((id, index) => targetIds[index] === id)) {
      return {
        createdAt: existing.createdAt,
        position: existing.position,
        section,
        updatedAt: existing.updatedAt,
      }
    }
  }

  if (existing) {
    await db.delete(sectionItems).where(eq(sectionItems.id, existing.id))
    if (oldSectionId === section.id) {
      targetIds = targetIds.filter((id) => id !== existing.id)
      await reindexSectionItems(db, section.id, targetIds, now)
    } else if (oldSectionId) {
      const oldIds = await sectionItemIdsByPosition(db, oldSectionId)
      await reindexSectionItems(db, oldSectionId, oldIds, now)
    }
  }

  const [inserted] = await db
    .insert(sectionItems)
    .values({
      createdAt: oldSectionId === section.id && existing ? existing.createdAt : now,
      itemType: input.item.type,
      position: targetIds.length,
      projectId: input.item.type === "project" ? input.item.id : null,
      sectionId: section.id,
      threadId: input.item.type === "thread" ? input.item.id : null,
      updatedAt: now,
    })
    .returning()
  if (!inserted)
    throw new ProjectThreadPersistenceError("WRITE_FAILED", "Section item was not created")

  let beforeId: number | null | undefined
  if (input.beforeItem) {
    const before = await findSectionItem(db, input.beforeItem)
    if (!before || before.sectionId !== section.id) {
      throw new ProjectThreadPersistenceError(
        "INVALID_BEFORE_ITEM",
        "The before item is not in the destination section"
      )
    }
    beforeId = before.id
  }
  const ordered = insertBefore(targetIds, inserted.id, beforeId, "INVALID_BEFORE_ITEM")
  await reindexSectionItems(db, section.id, ordered, now)
  const [saved] = await db
    .select()
    .from(sectionItems)
    .where(eq(sectionItems.id, inserted.id))
    .limit(1)
  if (!saved)
    throw new ProjectThreadPersistenceError("WRITE_FAILED", "Section item was not persisted")
  return {
    createdAt: saved.createdAt,
    position: saved.position,
    section,
    updatedAt: saved.updatedAt,
  }
}

const moveThreadToProjectInTransaction = async (
  db: ProjectThreadTransaction,
  input: { beforeThreadId?: string | null; projectId: string; threadId: string },
  now: number
): Promise<ProjectMembershipView> => {
  const project = await requireProject(db, input.projectId)
  await requireThread(db, input.threadId)
  const existing = await findProjectItem(db, input.threadId)
  const oldProjectId = existing?.projectId
  let targetIds = await projectItemIdsByPosition(db, project.id)
  const ordered = insertBefore(
    targetIds,
    input.threadId,
    input.beforeThreadId,
    "INVALID_BEFORE_THREAD"
  )

  if (
    existing &&
    oldProjectId === project.id &&
    ordered.every((id, index) => targetIds[index] === id)
  ) {
    return {
      createdAt: existing.createdAt,
      position: existing.position,
      project,
      updatedAt: existing.updatedAt,
    }
  }

  if (existing) {
    await db.delete(projectItems).where(eq(projectItems.threadId, input.threadId))
    if (oldProjectId === project.id) {
      targetIds = targetIds.filter((id) => id !== input.threadId)
      await reindexProjectItems(db, project.id, targetIds, now)
    } else if (oldProjectId) {
      const oldIds = await projectItemIdsByPosition(db, oldProjectId)
      await reindexProjectItems(db, oldProjectId, oldIds, now)
      await recomputeProjectRecency(db, oldProjectId, now)
    }
  }

  await db.insert(projectItems).values({
    createdAt: oldProjectId === project.id && existing ? existing.createdAt : now,
    position: targetIds.length,
    projectId: project.id,
    threadId: input.threadId,
    updatedAt: now,
  })
  await reindexProjectItems(db, project.id, ordered, now)
  await recomputeProjectRecency(db, project.id, now)
  const saved = await findProjectItem(db, input.threadId)
  const savedProject = await requireProject(db, project.id)
  if (!saved)
    throw new ProjectThreadPersistenceError("WRITE_FAILED", "Project item was not persisted")
  return {
    createdAt: saved.createdAt,
    position: saved.position,
    project: savedProject,
    updatedAt: saved.updatedAt,
  }
}

export const createProjectThreadPersistenceService = (
  db: CypheriaDatabase
): ProjectThreadPersistenceService => ({
  bindThreadAgentSession: async (threadId, agentSessionId, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    const thread = await requireThread(db, threadId)
    const [record] = await db
      .update(threads)
      .set({ agentSessionId, updatedAt: now })
      .where(eq(threads.id, thread.id))
      .returning()
    if (!record)
      throw new ProjectThreadPersistenceError("WRITE_FAILED", "Thread binding was not updated")
    return record
  },
  createProject: async (input, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    return db.transaction(async (tx) => {
      const id = createThreadId(now * 1000)
      const ids = await projectIdsByPosition(tx)
      await tx.insert(projects).values({
        createdAt: now,
        id,
        name: parseName(input.name),
        position: ids.length,
        recencyAt: null,
        roots: parseRoots(input.roots),
        updatedAt: now,
      })
      await reindexProjects(
        tx,
        insertBefore(ids, id, input.beforeProjectId, "INVALID_BEFORE_PROJECT"),
        now
      )
      if (input.sectionPlacement) {
        await moveItemToSectionInTransaction(
          tx,
          { item: { id, type: "project" }, ...input.sectionPlacement },
          now
        )
      }
      return requireProject(tx, id)
    })
  },
  createSection: async (input, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    return db.transaction(async (tx) => {
      await requireSection(tx, PINNED_SECTION_ID)
      if (input.beforeSectionId === PINNED_SECTION_ID) {
        throw new ProjectThreadPersistenceError(
          "PINNED_SECTION_IMMUTABLE",
          "A section cannot move before Pinned"
        )
      }
      const id = createThreadId(now * 1000)
      const ids = await sectionIdsByPosition(tx)
      await tx.insert(sections).values({
        color: input.color ?? null,
        createdAt: now,
        icon: input.icon ?? null,
        id,
        name: parseName(input.name),
        position: ids.length,
        updatedAt: now,
      })
      await reindexSections(
        tx,
        insertBefore(ids, id, input.beforeSectionId, "INVALID_BEFORE_SECTION"),
        now
      )
      return requireSection(tx, id)
    })
  },
  createThread: async (input, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    return db.transaction(async (tx) => {
      if (input.forkedFromId) await requireThread(tx, input.forkedFromId)
      const id = input.id === undefined ? createThreadId(now * 1000) : uuidV7Schema.parse(input.id)
      const ids = await threadIdsByPosition(tx)
      await tx.insert(threads).values({
        agentId: input.agentId,
        agentSessionId: input.agentSessionId ?? null,
        archivedAt: null,
        createdAt: now,
        cwd: input.cwd ?? null,
        forkedFromId: input.forkedFromId ?? null,
        id,
        position: ids.length,
        recencyAt:
          input.recencyAt === null || input.recencyAt === undefined
            ? null
            : parseTimestamp(input.recencyAt),
        title: input.title ?? null,
        updatedAt: now,
      })
      await reindexThreads(
        tx,
        insertBefore(ids, id, input.beforeThreadId, "INVALID_BEFORE_THREAD"),
        now
      )
      if (input.projectPlacement) {
        await moveThreadToProjectInTransaction(tx, { threadId: id, ...input.projectPlacement }, now)
      }
      if (input.sectionPlacement) {
        await moveItemToSectionInTransaction(
          tx,
          { item: { id, type: "thread" }, ...input.sectionPlacement },
          now
        )
      }
      return requireThread(tx, id)
    })
  },
  deleteProject: async (projectId, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    await db.transaction(async (tx) => {
      const project = await requireProject(tx, projectId)
      const membership = await findSectionItem(tx, { id: project.id, type: "project" })
      await tx.delete(projects).where(eq(projects.id, project.id))
      await reindexProjects(tx, await projectIdsByPosition(tx), now)
      if (membership) {
        await reindexSectionItems(
          tx,
          membership.sectionId,
          await sectionItemIdsByPosition(tx, membership.sectionId),
          now
        )
      }
    })
  },
  deleteSection: async (sectionId, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    if (sectionId === PINNED_SECTION_ID) {
      throw new ProjectThreadPersistenceError(
        "PINNED_SECTION_IMMUTABLE",
        "Pinned cannot be deleted"
      )
    }
    await db.transaction(async (tx) => {
      const section = await requireSection(tx, sectionId)
      await tx.delete(sections).where(eq(sections.id, section.id))
      await reindexSections(tx, await sectionIdsByPosition(tx), now)
    })
  },
  deleteThread: async (threadId, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    await db.transaction(async (tx) => {
      const thread = await requireThread(tx, threadId)
      const projectItem = await findProjectItem(tx, thread.id)
      const sectionItem = await findSectionItem(tx, { id: thread.id, type: "thread" })
      await tx
        .update(threads)
        .set({ forkedFromId: null, updatedAt: now })
        .where(eq(threads.forkedFromId, thread.id))
      await tx.delete(threads).where(eq(threads.id, thread.id))
      await reindexThreads(tx, await threadIdsByPosition(tx), now)
      if (projectItem) {
        await reindexProjectItems(
          tx,
          projectItem.projectId,
          await projectItemIdsByPosition(tx, projectItem.projectId),
          now
        )
        await recomputeProjectRecency(tx, projectItem.projectId, now)
      }
      if (sectionItem) {
        await reindexSectionItems(
          tx,
          sectionItem.sectionId,
          await sectionItemIdsByPosition(tx, sectionItem.sectionId),
          now
        )
      }
    })
  },
  ensurePinnedSection: async (nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    return db.transaction(async (tx) => {
      const existing = await loadSection(tx, PINNED_SECTION_ID)
      if (!existing) {
        const ids = await sectionIdsByPosition(tx)
        await reindexSections(tx, ids, now)
        await tx.insert(sections).values({
          color: null,
          createdAt: now,
          icon: null,
          id: PINNED_SECTION_ID,
          name: "Pinned",
          position: ids.length,
          updatedAt: now,
        })
        await reindexSections(tx, [PINNED_SECTION_ID, ...ids], now)
      } else if (existing.position !== 0) {
        const ids = await sectionIdsByPosition(tx)
        await reindexSections(
          tx,
          [PINNED_SECTION_ID, ...ids.filter((id) => id !== PINNED_SECTION_ID)],
          now
        )
      }
      return requireSection(tx, PINNED_SECTION_ID)
    })
  },
  getItemSection: async (item) => {
    const membership = await findSectionItem(db, item)
    if (!membership) return undefined
    const section = await requireSection(db, membership.sectionId)
    return {
      createdAt: membership.createdAt,
      position: membership.position,
      section,
      updatedAt: membership.updatedAt,
    }
  },
  getProject: (projectId) => loadProject(db, parseId(projectId)),
  getSection: (sectionId) => loadSection(db, parseId(sectionId)),
  getThread: (threadId) => loadThread(db, parseId(threadId)),
  getThreadProject: async (threadId) => {
    const item = await findProjectItem(db, parseId(threadId))
    if (!item) return undefined
    return {
      createdAt: item.createdAt,
      position: item.position,
      project: await requireProject(db, item.projectId),
      updatedAt: item.updatedAt,
    }
  },
  listProjectThreads: async (projectId, options = {}) => {
    const project = await requireProject(db, projectId)
    const rows = await db
      .select({ item: projectItems, thread: threads })
      .from(projectItems)
      .innerJoin(threads, eq(projectItems.threadId, threads.id))
      .where(and(eq(projectItems.projectId, project.id), isNull(threads.archivedAt)))
      .orderBy(asc(projectItems.position), asc(projectItems.threadId))
    return paginate(
      rows.map(({ item, thread }) => ({
        createdAt: item.createdAt,
        position: item.position,
        thread,
        updatedAt: item.updatedAt,
      })),
      options,
      ({ thread }) => thread.id
    )
  },
  listProjects: async (options = {}) => {
    const values = await db.select().from(projects)
    const sortKey = options.sortKey ?? "position"
    const direction = options.sortDirection ?? (sortKey === "recencyAt" ? "desc" : "asc")
    values.sort((left, right) => {
      const compared =
        sortKey === "position"
          ? direction === "asc"
            ? left.position - right.position
            : right.position - left.position
          : compareNullableNumber(left.recencyAt, right.recencyAt, direction)
      return compared || left.id.localeCompare(right.id)
    })
    return paginate(values, options, ({ id }) => id)
  },
  listSectionItems: async (sectionId, options = {}) => {
    const section = await requireSection(db, sectionId)
    const rows = await db
      .select()
      .from(sectionItems)
      .where(eq(sectionItems.sectionId, section.id))
      .orderBy(asc(sectionItems.position), asc(sectionItems.id))
    const values: SectionItemView[] = []
    for (const row of rows) {
      if (row.itemType === "thread" && row.threadId) {
        const thread = await requireThread(db, row.threadId)
        if (thread.archivedAt !== null) continue
        values.push({
          createdAt: row.createdAt,
          position: row.position,
          thread,
          type: "thread",
          updatedAt: row.updatedAt,
        })
      } else if (row.itemType === "project" && row.projectId) {
        values.push({
          createdAt: row.createdAt,
          position: row.position,
          project: await requireProject(db, row.projectId),
          type: "project",
          updatedAt: row.updatedAt,
        })
      }
    }
    return paginate(values, options, (value) =>
      value.type === "thread" ? value.thread.id : value.project.id
    )
  },
  listSections: async (options = {}) => {
    const values = await db
      .select()
      .from(sections)
      .orderBy(asc(sections.position), asc(sections.id))
    return paginate(values, options, ({ id }) => id)
  },
  listThreads: async (options = {}) => {
    let values = await db.select().from(threads)
    const archived = options.archived ?? false
    values = values.filter((thread) => (thread.archivedAt !== null) === archived)
    if (options.agentId !== undefined)
      values = values.filter(({ agentId }) => agentId === options.agentId)
    if (options.forkedFromId !== undefined) {
      const forkedFromId = parseId(options.forkedFromId)
      values = values.filter((thread) => thread.forkedFromId === forkedFromId)
    }
    if (options.projectId !== undefined) {
      const ids = new Set(await projectItemIdsByPosition(db, parseId(options.projectId)))
      values = values.filter(({ id }) => ids.has(id))
    }
    if (options.sectionId !== undefined) {
      const rows = await db
        .select({ threadId: sectionItems.threadId })
        .from(sectionItems)
        .where(eq(sectionItems.sectionId, parseId(options.sectionId)))
      const ids = new Set(rows.flatMap(({ threadId }) => (threadId ? [threadId] : [])))
      values = values.filter(({ id }) => ids.has(id))
    }
    const sortKey = options.sortKey ?? "position"
    const direction = options.sortDirection ?? (sortKey === "recencyAt" ? "desc" : "asc")
    values.sort((left, right) => {
      const compared =
        sortKey === "position"
          ? direction === "asc"
            ? left.position - right.position
            : right.position - left.position
          : compareNullableNumber(left.recencyAt, right.recencyAt, direction)
      return compared || left.id.localeCompare(right.id)
    })
    return paginate(values, options, ({ id }) => id)
  },
  moveItemToSection: async (input, nowValue = nowSeconds()) =>
    db.transaction((tx) => moveItemToSectionInTransaction(tx, input, parseNow(nowValue))),
  moveProject: async (input, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    await db.transaction(async (tx) => {
      const project = await requireProject(tx, input.projectId)
      const ids = await projectIdsByPosition(tx)
      await reindexProjects(
        tx,
        insertBefore(ids, project.id, input.beforeProjectId, "INVALID_BEFORE_PROJECT"),
        now
      )
    })
  },
  moveSection: async (input, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    if (input.sectionId === PINNED_SECTION_ID || input.beforeSectionId === PINNED_SECTION_ID) {
      throw new ProjectThreadPersistenceError(
        "PINNED_SECTION_IMMUTABLE",
        "Pinned cannot be reordered"
      )
    }
    await db.transaction(async (tx) => {
      const section = await requireSection(tx, input.sectionId)
      const ids = await sectionIdsByPosition(tx)
      await reindexSections(
        tx,
        insertBefore(ids, section.id, input.beforeSectionId, "INVALID_BEFORE_SECTION"),
        now
      )
    })
  },
  moveThread: async (input, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    await db.transaction(async (tx) => {
      const thread = await requireThread(tx, input.threadId)
      const ids = await threadIdsByPosition(tx)
      await reindexThreads(
        tx,
        insertBefore(ids, thread.id, input.beforeThreadId, "INVALID_BEFORE_THREAD"),
        now
      )
    })
  },
  moveThreadToProject: async (input, nowValue = nowSeconds()) =>
    db.transaction((tx) => moveThreadToProjectInTransaction(tx, input, parseNow(nowValue))),
  pinItem: async (input, nowValue = nowSeconds()) =>
    db.transaction((tx) =>
      moveItemToSectionInTransaction(
        tx,
        { ...input, sectionId: PINNED_SECTION_ID },
        parseNow(nowValue)
      )
    ),
  removeItemFromSection: async (item, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    await db.transaction(async (tx) => {
      const membership = await findSectionItem(tx, item)
      if (!membership) return
      await tx.delete(sectionItems).where(eq(sectionItems.id, membership.id))
      await reindexSectionItems(
        tx,
        membership.sectionId,
        await sectionItemIdsByPosition(tx, membership.sectionId),
        now
      )
    })
  },
  removeThreadFromProject: async (threadId, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    await db.transaction(async (tx) => {
      const item = await findProjectItem(tx, parseId(threadId))
      if (!item) return
      await tx.delete(projectItems).where(eq(projectItems.threadId, item.threadId))
      await reindexProjectItems(
        tx,
        item.projectId,
        await projectItemIdsByPosition(tx, item.projectId),
        now
      )
      await recomputeProjectRecency(tx, item.projectId, now)
    })
  },
  setThreadArchived: async (threadId, archivedAtValue, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    const archivedAt = archivedAtValue === null ? null : parseTimestamp(archivedAtValue)
    return db.transaction(async (tx) => {
      const thread = await requireThread(tx, threadId)
      if (thread.archivedAt === archivedAt) return thread
      const [record] = await tx
        .update(threads)
        .set({ archivedAt, updatedAt: now })
        .where(eq(threads.id, thread.id))
        .returning()
      if (!record) throw new ProjectThreadPersistenceError("WRITE_FAILED", "Thread was not updated")
      const item = await findProjectItem(tx, thread.id)
      if (item) await recomputeProjectRecency(tx, item.projectId, now)
      return record
    })
  },
  touchThreadRecency: async (threadId, recencyValue, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    const recencyAt = parseTimestamp(recencyValue)
    return db.transaction(async (tx) => {
      const thread = await requireThread(tx, threadId)
      if (thread.recencyAt !== null && recencyAt <= thread.recencyAt) return thread
      await tx.update(threads).set({ recencyAt, updatedAt: now }).where(eq(threads.id, thread.id))
      const item = await findProjectItem(tx, thread.id)
      if (item) await recomputeProjectRecency(tx, item.projectId, now)
      return requireThread(tx, thread.id)
    })
  },
  unpinItem: async (item, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    await db.transaction(async (tx) => {
      const membership = await findSectionItem(tx, item)
      if (membership?.sectionId !== PINNED_SECTION_ID) return
      await tx.delete(sectionItems).where(eq(sectionItems.id, membership.id))
      await reindexSectionItems(
        tx,
        PINNED_SECTION_ID,
        await sectionItemIdsByPosition(tx, PINNED_SECTION_ID),
        now
      )
    })
  },
  updateProject: async (projectId, patch, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    const id = parseId(projectId)
    await requireProject(db, id)
    const [record] = await db
      .update(projects)
      .set({
        ...(patch.name === undefined ? {} : { name: parseName(patch.name) }),
        ...(patch.roots === undefined ? {} : { roots: parseRoots(patch.roots) }),
        updatedAt: now,
      })
      .where(eq(projects.id, id))
      .returning()
    if (!record) throw new ProjectThreadPersistenceError("WRITE_FAILED", "Project was not updated")
    return record
  },
  updateSection: async (sectionId, patch, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    const section = await requireSection(db, sectionId)
    if (section.id === PINNED_SECTION_ID && patch.name !== undefined) {
      throw new ProjectThreadPersistenceError(
        "PINNED_SECTION_IMMUTABLE",
        "Pinned cannot be renamed"
      )
    }
    const [record] = await db
      .update(sections)
      .set({
        ...(patch.color === undefined ? {} : { color: patch.color }),
        ...(patch.icon === undefined ? {} : { icon: patch.icon }),
        ...(patch.name === undefined ? {} : { name: parseName(patch.name) }),
        updatedAt: now,
      })
      .where(eq(sections.id, section.id))
      .returning()
    if (!record) throw new ProjectThreadPersistenceError("WRITE_FAILED", "Section was not updated")
    return record
  },
  updateThread: async (threadId, patch, nowValue = nowSeconds()) => {
    const now = parseNow(nowValue)
    const thread = await requireThread(db, threadId)
    const [record] = await db
      .update(threads)
      .set({
        ...(patch.cwd === undefined ? {} : { cwd: patch.cwd }),
        ...(patch.title === undefined ? {} : { title: patch.title }),
        updatedAt: now,
      })
      .where(eq(threads.id, thread.id))
      .returning()
    if (!record) throw new ProjectThreadPersistenceError("WRITE_FAILED", "Thread was not updated")
    return record
  },
})
