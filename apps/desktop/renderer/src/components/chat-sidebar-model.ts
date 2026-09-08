import type { CodexProjectView, CodexThreadView } from "../../../ipc/src/index.js"

export const SIDEBAR_BATCH_SIZE = 5

export type SidebarSectionId = "pinned" | "projects" | "recents"

export type SidebarProjectGroup = {
  project: CodexProjectView
  projectId: string
  projectName: string
  threads: CodexThreadView[]
  updatedAt: number
}

export type SidebarCustomSection = {
  id: string
  name: string
  projects: SidebarProjectGroup[]
  threads: CodexThreadView[]
}

export type ChatSidebarRow =
  | { key: string; kind: "navigation"; navigationId: string }
  | { key: string; kind: "section"; section: SidebarSectionId }
  | { key: string; kind: "customSection"; sectionId: string; sectionName: string }
  | { key: string; kind: "project"; project: CodexProjectView }
  | {
      key: string
      kind: "thread"
      parentProjectId?: string
      source: "pinned" | "project" | "recent"
      thread: CodexThreadView
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

export function groupProjectThreads(
  threads: readonly CodexThreadView[],
  projects: readonly CodexProjectView[] = []
): SidebarProjectGroup[] {
  const groups = new Map<string, CodexThreadView[]>()
  for (const thread of threads) {
    if (!thread.projectId) continue
    groups.set(thread.projectId, [...(groups.get(thread.projectId) ?? []), thread])
  }

  const projectById = new Map(projects.map((project) => [project.id, project]))
  for (const project of projects) groups.set(project.id, groups.get(project.id) ?? [])

  return [...groups.entries()]
    .map(([projectId, projectThreads]) => {
      const sortedThreads = projectThreads.toSorted(
        (left, right) => right.updatedAt - left.updatedAt
      )
      const project = projectById.get(projectId) ?? {
        createdAt: 0,
        id: projectId,
        metadata: {},
        name: projectId,
        position: 0,
        recencyAt: sortedThreads[0]?.updatedAt ?? null,
        roots: [],
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
  pinnedThreads: readonly CodexThreadView[]
  projectGroups: readonly SidebarProjectGroup[]
  projectChatLimits: Readonly<Record<string, number>>
  projectsHasMore: boolean
  recentHasMore: boolean
  recentLoading: boolean
  recentThreads: readonly CodexThreadView[]
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

  rows.push({ key: "section:pinned", kind: "section", section: "pinned" })
  if (expandedSections.has("pinned")) {
    for (const project of pinnedProjects) appendProject(project, "pinned")
    rows.push(
      ...pinnedThreads.map(
        (thread): ChatSidebarRow => ({
          key: `pinned:${thread.id}`,
          kind: "thread",
          source: "pinned",
          thread,
        })
      )
    )
    if (pinnedProjects.length === 0 && pinnedThreads.length === 0 && !pinnedHasMore)
      rows.push({ key: "empty:pinned", kind: "empty", section: "pinned" })
    if (pinnedHasMore) rows.push({ key: "show-more:pinned", kind: "showMore", target: "pinned" })
  }

  for (const section of customSections) {
    rows.push({
      key: `custom-section:${section.id}`,
      kind: "customSection",
      sectionId: section.id,
      sectionName: section.name,
    })
    if (!expandedCustomSections.has(section.id)) continue
    for (const project of section.projects) appendProject(project, `custom-section:${section.id}`)
    rows.push(
      ...section.threads.map(
        (thread): ChatSidebarRow => ({
          key: `custom-section:${section.id}:thread:${thread.id}`,
          kind: "thread",
          source: "recent",
          thread,
        })
      )
    )
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
