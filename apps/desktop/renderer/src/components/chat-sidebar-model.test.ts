import { describe, expect, it } from "vitest"
import type { CodexThreadView } from "../../../ipc/src/index.js"
import {
  buildChatSidebarRows,
  groupProjectThreads,
  SIDEBAR_BATCH_SIZE,
  type SidebarSectionId,
} from "./chat-sidebar-model.js"

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

describe("chat sidebar row model", () => {
  it("flattens navigation, collapsible groups, projects, chats, and loaders", () => {
    const projectThreads = Array.from({ length: 7 }, (_, index) =>
      thread(`chat-${index + 1}`, "project-a", 10 - index)
    )
    const rows = buildChatSidebarRows({
      expandedProjects: new Set(["project-a"]),
      expandedSections: allSections,
      navigationIds: ["pending", "wallets"],
      pinnedHasMore: true,
      pinnedThreads: [thread("pinned-1")],
      projectGroups: groupProjectThreads(projectThreads),
      projectChatLimits: {},
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
      "project:project-a:thread:chat-1",
      "project:project-a:thread:chat-2",
      "project:project-a:thread:chat-3",
      "project:project-a:thread:chat-4",
      "project:project-a:thread:chat-5",
      "show-more:project:project-a",
      "section:recents",
      "recent:recent-1",
      "loading:recents",
    ])
  })

  it("removes group descendants while preserving group headings", () => {
    const rows = buildChatSidebarRows({
      expandedProjects: new Set(),
      expandedSections: new Set(),
      navigationIds: ["pending"],
      pinnedHasMore: true,
      pinnedThreads: [thread("pinned-1")],
      projectGroups: groupProjectThreads([thread("chat-1", "project-a")]),
      projectChatLimits: {},
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

  it("sorts projects and their chats by recency", () => {
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

  it("places custom sections above projects and can hide project grouping", () => {
    const rows = buildChatSidebarRows({
      customSections: [{ id: "section-1", name: "Test", threads: [] }],
      expandedCustomSections: new Set(["section-1"]),
      expandedProjects: new Set(["project-a"]),
      expandedSections: allSections,
      navigationIds: [],
      pinnedHasMore: false,
      pinnedThreads: [],
      projectGroups: groupProjectThreads([thread("chat-1", "project-a")]),
      projectChatLimits: {},
      projectsHasMore: false,
      recentHasMore: false,
      recentLoading: false,
      recentThreads: [thread("chat-1", "project-a")],
      showProjects: false,
      visibleProjectCount: SIDEBAR_BATCH_SIZE,
    })

    expect(rows.map((row) => row.key)).toEqual([
      "section:pinned",
      "empty:pinned",
      "custom-section:section-1",
      "custom-empty:section-1",
      "section:recents",
      "recent:chat-1",
    ])
  })
})
