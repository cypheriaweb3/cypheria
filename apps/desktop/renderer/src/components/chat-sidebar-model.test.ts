import { describe, expect, it } from "vitest"
import type { CodexProjectView, CodexThreadView } from "../../../ipc/src/index.js"
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
      "projects:project:project-a",
      "projects:project:project-a:thread:chat-1",
      "projects:project:project-a:thread:chat-2",
      "projects:project:project-a:thread:chat-3",
      "projects:project:project-a:thread:chat-4",
      "projects:project:project-a:thread:chat-5",
      "projects:show-more:project:project-a",
      "section:recents",
      "recent:recent-1",
      "loading:recents",
    ])
    expect(rows.find((row) => row.kind === "project")).toEqual(
      expect.objectContaining({ threads: projectThreads })
    )
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
          metadata: {},
          name: "Cypheria",
          position: 0,
          recencyAt: null,
          roots: ["/work/cypheria"],
          updatedAt: 1,
        },
      ]
    )

    expect(groups).toEqual([
      expect.objectContaining({
        projectId: "project-a",
        projectName: "Cypheria",
        threads: [],
        updatedAt: 0,
      }),
    ])
  })

  it("places custom sections above projects and can hide project grouping", () => {
    const rows = buildChatSidebarRows({
      customSections: [{ id: "section-1", name: "Test", projects: [], threads: [] }],
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
    expect(rows.find((row) => row.kind === "customSection")).toEqual(
      expect.objectContaining({ archiveEnabled: false })
    )
  })

  it("renders pinned and sectioned projects with their nested chats", () => {
    const projects: CodexProjectView[] = [
      {
        createdAt: 1,
        id: "pinned-project",
        metadata: { "cypheria.sidebar.pinned": "true" },
        name: "Pinned project",
        position: 0,
        recencyAt: 2,
        roots: ["/work/pinned"],
        updatedAt: 2,
      },
      {
        createdAt: 1,
        id: "section-project",
        metadata: { "cypheria.sidebar.sectionId": "section-1" },
        name: "Section project",
        position: 1,
        recencyAt: 1,
        roots: ["/work/section"],
        updatedAt: 1,
      },
    ]
    const groups = groupProjectThreads(
      [thread("pinned-chat", "pinned-project"), thread("section-chat", "section-project")],
      projects
    )
    const rows = buildChatSidebarRows({
      customSections: [
        {
          id: "section-1",
          name: "Work",
          projects: groups.filter(({ projectId }) => projectId === "section-project"),
          threads: [],
        },
      ],
      expandedCustomSections: new Set(["section-1"]),
      expandedProjects: new Set(["pinned-project", "section-project"]),
      expandedSections: allSections,
      navigationIds: [],
      pinnedHasMore: false,
      pinnedProjects: groups.filter(({ projectId }) => projectId === "pinned-project"),
      pinnedThreads: [],
      projectGroups: [],
      projectChatLimits: {},
      projectsHasMore: false,
      recentHasMore: false,
      recentLoading: false,
      recentThreads: [],
      visibleProjectCount: SIDEBAR_BATCH_SIZE,
    })

    expect(rows.map(({ key }) => key)).toContain("pinned:project:pinned-project")
    expect(rows.map(({ key }) => key)).toContain("pinned:project:pinned-project:thread:pinned-chat")
    expect(rows.map(({ key }) => key)).toContain("custom-section:section-1:project:section-project")
    expect(rows.map(({ key }) => key)).toContain(
      "custom-section:section-1:project:section-project:thread:section-chat"
    )
    const sectionRow = rows.find(
      (row) => row.kind === "customSection" && row.sectionId === "section-1"
    )
    expect(sectionRow?.kind).toBe("customSection")
    if (sectionRow?.kind !== "customSection") throw new Error("Expected custom section row")
    expect(sectionRow.archiveEnabled).toBe(true)
  })
})
