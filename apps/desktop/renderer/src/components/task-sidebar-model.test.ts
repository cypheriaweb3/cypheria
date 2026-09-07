import { describe, expect, it } from "vitest"
import type { CodexThreadView } from "../../../ipc/src/index.js"
import {
  buildTaskSidebarRows,
  groupProjectThreads,
  SIDEBAR_BATCH_SIZE,
  type SidebarSectionId,
} from "./task-sidebar-model.js"

const thread = (
  id: string,
  projectId: string | null = null,
  updatedAt = Number(id.replace(/\D/g, "")) || 0
): CodexThreadView => ({
  cwd: "/work",
  id,
  modelProvider: "openai",
  projectId,
  sectionId: null,
  sectionName: null,
  status: "idle",
  title: id,
  updatedAt,
})

const allSections = new Set<SidebarSectionId>(["pinned", "projects", "recents"])

describe("task sidebar row model", () => {
  it("flattens navigation, collapsible groups, projects, tasks, and loaders", () => {
    const projectThreads = Array.from({ length: 7 }, (_, index) =>
      thread(`task-${index + 1}`, "project-a", 10 - index)
    )
    const rows = buildTaskSidebarRows({
      expandedProjects: new Set(["project-a"]),
      expandedSections: allSections,
      navigationIds: ["pending", "wallets"],
      pinnedHasMore: true,
      pinnedThreads: [thread("pinned-1")],
      projectGroups: groupProjectThreads(projectThreads),
      projectTaskLimits: {},
      projectsHasMore: false,
      recentHasMore: true,
      recentLoading: false,
      recentThreads: [thread("recent-1")],
      visibleProjectCount: SIDEBAR_BATCH_SIZE,
    })

    expect(rows.map((row) => row.key)).toEqual([
      "navigation:pending",
      "navigation:wallets",
      "section:pinned",
      "pinned:pinned-1",
      "show-more:pinned",
      "section:projects",
      "project:project-a",
      "project:project-a:thread:task-1",
      "project:project-a:thread:task-2",
      "project:project-a:thread:task-3",
      "project:project-a:thread:task-4",
      "project:project-a:thread:task-5",
      "show-more:project:project-a",
      "section:recents",
      "recent:recent-1",
      "loading:recents",
    ])
  })

  it("removes group descendants while preserving group headings", () => {
    const rows = buildTaskSidebarRows({
      expandedProjects: new Set(),
      expandedSections: new Set(),
      navigationIds: ["pending"],
      pinnedHasMore: true,
      pinnedThreads: [thread("pinned-1")],
      projectGroups: groupProjectThreads([thread("task-1", "project-a")]),
      projectTaskLimits: {},
      projectsHasMore: true,
      recentHasMore: true,
      recentLoading: false,
      recentThreads: [thread("recent-1")],
      visibleProjectCount: SIDEBAR_BATCH_SIZE,
    })

    expect(rows.map((row) => row.key)).toEqual([
      "navigation:pending",
      "section:pinned",
      "section:projects",
      "section:recents",
    ])
  })

  it("sorts projects and their tasks by recency", () => {
    const groups = groupProjectThreads([
      thread("a-old", "a", 1),
      thread("b-new", "b", 8),
      thread("a-new", "a", 10),
    ])

    expect(groups.map((group) => group.projectId)).toEqual(["a", "b"])
    expect(groups[0]?.threads.map(({ id }) => id)).toEqual(["a-new", "a-old"])
  })

  it("keeps empty projects visible and uses their display names", () => {
    const groups = groupProjectThreads(
      [],
      [
        {
          createdAt: 1,
          id: "project-a",
          name: "Cypheria",
          position: 0,
          recencyAt: null,
          roots: ["/work/cypheria"],
          updatedAt: 1,
        },
      ]
    )

    expect(groups).toEqual([
      { projectId: "project-a", projectName: "Cypheria", threads: [], updatedAt: 0 },
    ])
  })
})
