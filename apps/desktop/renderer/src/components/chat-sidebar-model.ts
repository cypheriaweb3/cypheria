import type { SidebarProjectView, SidebarThreadView } from "../sidebar-data.js"

export const SIDEBAR_BATCH_SIZE = 5

export type SidebarSectionId = "pinned" | "projects" | "recents"

export type SidebarProjectGroup = {
  project: SidebarProjectView
  projectId: string
  projectName: string
  threads: SidebarThreadView[]
  updatedAt: number
}

export type SidebarCustomSection = {
  id: string
  name: string
  projects: SidebarProjectGroup[]
  threads: SidebarThreadView[]
}

export type ChatSidebarRow =
  | { key: string; kind: "navigation"; navigationId: string }
  | { key: string; kind: "section"; section: SidebarSectionId }
  | {
      archiveEnabled: boolean
      key: string
      kind: "customSection"
      sectionId: string
      sectionName: string
    }
  | {
      key: string
      kind: "project"
      project: SidebarProjectView
      threads: readonly SidebarThreadView[]
    }
  | {
      key: string
      kind: "thread"
      parentProjectId?: string
      source: "pinned" | "project" | "recent"
      thread: SidebarThreadView
    }
  | {
      key: string
      kind: "showMore"
      projectId?: string
      target: "pinned" | "project" | "projects"
    }
  | { key: string; kind: "loading"; target: "projects" | "recent" }
  | { key: string; kind: "empty"; section: SidebarSectionId }
  | { key: string; kind: "customEmpty"; sectionId: string }

export type SidebarDragItem = {
  id: string
  key: string
  type: "project" | "section" | "thread"
}

export const sidebarDragItemForRow = (row: ChatSidebarRow): SidebarDragItem | null =>
  row.kind === "thread"
    ? { id: row.thread.id, key: row.key, type: "thread" }
    : row.kind === "project"
      ? { id: row.project.id, key: row.key, type: "project" }
      : row.kind === "customSection"
        ? { id: row.sectionId, key: row.key, type: "section" }
        : null

const isProjectDescendant = (row: ChatSidebarRow, projectId: string) =>
  (row.kind === "thread" && row.parentProjectId === projectId) ||
  (row.kind === "showMore" && row.projectId === projectId)

const sectionEnd = (rows: readonly ChatSidebarRow[], start: number) => {
  let end = start + 1
  while (end < rows.length && rows[end]?.kind !== "section" && rows[end]?.kind !== "customSection")
    end += 1
  return end
}

/** Provides an immediate, reversible visual placement while the Server confirms a drag mutation. */
export function placeSidebarDragItem(
  rows: readonly ChatSidebarRow[],
  source: SidebarDragItem,
  target: ChatSidebarRow
): ChatSidebarRow[] {
  const sourceStart = rows.findIndex(({ key }) => key === source.key)
  if (sourceStart < 0 || target.key === source.key) return [...rows]
  let sourceEnd = sourceStart + 1
  if (source.type === "project") {
    while (
      sourceEnd < rows.length &&
      isProjectDescendant(rows[sourceEnd] as ChatSidebarRow, source.id)
    )
      sourceEnd += 1
  } else if (source.type === "section") {
    sourceEnd = sectionEnd(rows, sourceStart)
  }
  let moving = rows.slice(sourceStart, sourceEnd)
  const remaining = [...rows.slice(0, sourceStart), ...rows.slice(sourceEnd)]
  const targetIndex = remaining.findIndex(({ key }) => key === target.key)
  if (targetIndex < 0) return [...rows]
  let insertAt = targetIndex
  if (source.type !== "section" && (target.kind === "section" || target.kind === "customSection")) {
    insertAt = sectionEnd(remaining, targetIndex)
  } else if (source.type === "thread" && target.kind === "project") {
    moving = moving.map((row) =>
      row.kind === "thread"
        ? {
            ...row,
            key: `${target.key}:thread:${row.thread.id}`,
            parentProjectId: target.project.id,
            source: "project",
          }
        : row
    )
    insertAt = targetIndex + 1
    while (
      insertAt < remaining.length &&
      isProjectDescendant(remaining[insertAt] as ChatSidebarRow, target.project.id)
    )
      insertAt += 1
  }
  return [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)]
}

export function groupProjectThreads(
  threads: readonly SidebarThreadView[],
  projects: readonly SidebarProjectView[] = [],
  compareThreads: (left: SidebarThreadView, right: SidebarThreadView) => number = (left, right) =>
    right.updatedAt - left.updatedAt
): SidebarProjectGroup[] {
  const groups = new Map<string, SidebarThreadView[]>()
  for (const thread of threads) {
    if (!thread.projectId) continue
    groups.set(thread.projectId, [...(groups.get(thread.projectId) ?? []), thread])
  }

  const projectById = new Map(projects.map((project) => [project.id, project]))
  for (const project of projects) groups.set(project.id, groups.get(project.id) ?? [])

  return [...groups.entries()]
    .map(([projectId, projectThreads]) => {
      const sortedThreads = projectThreads.toSorted(compareThreads)
      const project = projectById.get(projectId) ?? {
        createdAt: 0,
        id: projectId,
        name: projectId,
        position: 0,
        recencyAt: sortedThreads[0]?.updatedAt ?? null,
        roots: [],
        sectionId: null,
        sectionPosition: null,
        updatedAt: sortedThreads[0]?.updatedAt ?? 0,
      }
      return {
        project,
        projectId,
        projectName: project.name,
        threads: sortedThreads,
        updatedAt: sortedThreads[0]?.updatedAt ?? 0,
      }
    })
    .toSorted(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.projectId.localeCompare(right.projectId)
    )
}

export function buildChatSidebarRows({
  expandedProjects,
  expandedSections,
  expandedCustomSections = new Set(),
  customSections = [],
  navigationIds,
  pinnedHasMore,
  pinnedProjects = [],
  pinnedThreads,
  projectGroups,
  projectChatLimits,
  projectsHasMore,
  recentHasMore,
  recentLoading,
  recentThreads,
  showProjects = true,
  visibleProjectCount,
}: {
  expandedProjects: ReadonlySet<string>
  expandedSections: ReadonlySet<SidebarSectionId>
  expandedCustomSections?: ReadonlySet<string>
  customSections?: readonly SidebarCustomSection[]
  navigationIds: readonly string[]
  pinnedHasMore: boolean
  pinnedProjects?: readonly SidebarProjectGroup[]
  pinnedThreads: readonly SidebarThreadView[]
  projectGroups: readonly SidebarProjectGroup[]
  projectChatLimits: Readonly<Record<string, number>>
  projectsHasMore: boolean
  recentHasMore: boolean
  recentLoading: boolean
  recentThreads: readonly SidebarThreadView[]
  showProjects?: boolean
  visibleProjectCount: number
}): ChatSidebarRow[] {
  const rows: ChatSidebarRow[] = navigationIds.map((navigationId) => ({
    key: `navigation:${navigationId}`,
    kind: "navigation",
    navigationId,
  }))

  const appendProject = (project: SidebarProjectGroup, keyPrefix: string) => {
    rows.push({
      key: `${keyPrefix}:project:${project.projectId}`,
      kind: "project",
      project: project.project,
      threads: project.threads,
    })
    if (!expandedProjects.has(project.projectId)) return
    const chatLimit = projectChatLimits[project.projectId] ?? SIDEBAR_BATCH_SIZE
    rows.push(
      ...project.threads.slice(0, chatLimit).map(
        (thread): ChatSidebarRow => ({
          key: `${keyPrefix}:project:${project.projectId}:thread:${thread.id}`,
          kind: "thread",
          parentProjectId: project.projectId,
          source: "project",
          thread,
        })
      )
    )
    if (project.threads.length > chatLimit || projectsHasMore)
      rows.push({
        key: `${keyPrefix}:show-more:project:${project.projectId}`,
        kind: "showMore",
        projectId: project.projectId,
        target: "project",
      })
  }

  const appendSectionItems = (
    projects: readonly SidebarProjectGroup[],
    threads: readonly SidebarThreadView[],
    keyPrefix: string,
    threadSource: "pinned" | "recent"
  ) => {
    const items = [
      ...projects.map((project) => ({
        item: project,
        position: project.project.sectionPosition,
        type: "project" as const,
      })),
      ...threads.map((thread) => ({
        item: thread,
        position: thread.sectionPosition,
        type: "thread" as const,
      })),
    ].toSorted(
      (left, right) =>
        (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
        (left.type === "project" ? left.item.projectId : left.item.id).localeCompare(
          right.type === "project" ? right.item.projectId : right.item.id
        )
    )
    for (const entry of items) {
      if (entry.type === "project") appendProject(entry.item, keyPrefix)
      else
        rows.push({
          key: `${keyPrefix}${keyPrefix.startsWith("custom-section:") ? ":thread" : ""}:${entry.item.id}`,
          kind: "thread",
          source: threadSource,
          thread: entry.item,
        })
    }
  }

  rows.push({ key: "section:pinned", kind: "section", section: "pinned" })
  if (expandedSections.has("pinned")) {
    appendSectionItems(pinnedProjects, pinnedThreads, "pinned", "pinned")
    if (pinnedProjects.length === 0 && pinnedThreads.length === 0 && !pinnedHasMore)
      rows.push({ key: "empty:pinned", kind: "empty", section: "pinned" })
    if (pinnedHasMore) rows.push({ key: "show-more:pinned", kind: "showMore", target: "pinned" })
  }

  for (const section of customSections) {
    rows.push({
      archiveEnabled:
        section.threads.length > 0 || section.projects.some(({ threads }) => threads.length > 0),
      key: `custom-section:${section.id}`,
      kind: "customSection",
      sectionId: section.id,
      sectionName: section.name,
    })
    if (!expandedCustomSections.has(section.id)) continue
    appendSectionItems(section.projects, section.threads, `custom-section:${section.id}`, "recent")
    if (section.projects.length === 0 && section.threads.length === 0)
      rows.push({ key: `custom-empty:${section.id}`, kind: "customEmpty", sectionId: section.id })
  }

  if (showProjects) rows.push({ key: "section:projects", kind: "section", section: "projects" })
  if (showProjects && expandedSections.has("projects")) {
    const visibleProjects = projectGroups.slice(0, visibleProjectCount)
    for (const project of visibleProjects) appendProject(project, "projects")
    if (projectGroups.length === 0 && !projectsHasMore)
      rows.push({ key: "empty:projects", kind: "empty", section: "projects" })
    if (projectGroups.length > visibleProjectCount || projectsHasMore) {
      rows.push({ key: "show-more:projects", kind: "showMore", target: "projects" })
    }
  }

  rows.push({ key: "section:recents", kind: "section", section: "recents" })
  if (expandedSections.has("recents")) {
    rows.push(
      ...recentThreads.map(
        (thread): ChatSidebarRow => ({
          key: `recent:${thread.id}`,
          kind: "thread",
          source: "recent",
          thread,
        })
      )
    )
    if (recentThreads.length === 0 && !recentHasMore && !recentLoading)
      rows.push({ key: "empty:recents", kind: "empty", section: "recents" })
    if (recentHasMore || recentLoading)
      rows.push({ key: "loading:recents", kind: "loading", target: "recent" })
  }

  return rows
}

export function estimateChatSidebarRowSize(row: ChatSidebarRow): number {
  switch (row.kind) {
    case "section":
    case "customSection":
      return 40
    case "showMore":
      return 30
    case "loading":
    case "empty":
    case "customEmpty":
      return 36
    case "navigation":
    case "project":
    case "thread":
      return 32
  }
}
