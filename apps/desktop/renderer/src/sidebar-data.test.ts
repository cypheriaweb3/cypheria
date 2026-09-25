import type { CypheriaApi } from "@cypheria/client"
import type { Project, Section, ThreadView } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { PINNED_SIDEBAR_SECTION_ID, SidebarDataApi } from "./sidebar-data.js"

const thread = (id: string, title: string): ThreadView => ({
  activeTurn: null,
  agentId: "codex",
  agentSessionId: `native-${id}`,
  archivedAt: null,
  attention: false,
  capabilities: {
    changeCwd: true,
    configure: true,
    fork: true,
    promptContent: ["text"],
    harnessExtensions: true,
    steer: true,
  },
  createdAt: 1,
  cwd: "/repo",
  forkedFromId: null,
  id,
  pendingInteractions: [],
  position: 0,
  recencyAt: 2,
  state: "idle",
  title,
  updatedAt: 2,
})

const project: Project = {
  createdAt: 1,
  id: "01996a3a-bcde-7000-8000-000000000010",
  name: "Cypheria",
  position: 0,
  recencyAt: 2,
  roots: ["/repo"],
  updatedAt: 2,
}

const pinned: Section = {
  color: null,
  createdAt: 1,
  icon: null,
  id: PINNED_SIDEBAR_SECTION_ID,
  name: "Pinned",
  position: 0,
  updatedAt: 1,
}

const section: Section = {
  ...pinned,
  id: "01996a3a-bcde-7000-8000-000000000011",
  name: "Work",
  position: 1,
}

const page = <T>(data: T[]) => Promise.resolve({ data, nextCursor: null })

const setup = () => {
  const projectThread = thread("01996a3a-bcde-7000-8000-000000000001", "Project chat")
  const pinnedThread = thread("01996a3a-bcde-7000-8000-000000000002", "Pinned chat")
  const api = {
    projects: {
      create: vi.fn(),
      delete: vi.fn(),
      getThreadProject: vi.fn((threadId: string) =>
        Promise.resolve(
          threadId === projectThread.id
            ? { createdAt: 1, position: 0, project, updatedAt: 1 }
            : undefined
        )
      ),
      list: vi.fn(() => page([project])),
      listMemberships: vi.fn(() =>
        page([
          {
            createdAt: 1,
            position: 0,
            projectId: project.id,
            threadId: projectThread.id,
            updatedAt: 1,
          },
        ])
      ),
      listThreads: vi.fn(() =>
        page([{ createdAt: 1, position: 0, thread: projectThread, updatedAt: 1 }])
      ),
      moveThread: vi.fn(),
      removeThread: vi.fn(),
      update: vi.fn(),
    },
    sections: {
      create: vi.fn(),
      delete: vi.fn(),
      getItemSection: vi.fn(({ id, type }: { id: string; type: "project" | "thread" }) =>
        Promise.resolve(
          (type === "project" && id === project.id) || (type === "thread" && id === pinnedThread.id)
            ? { createdAt: 1, position: type === "project" ? 0 : 1, section: pinned, updatedAt: 1 }
            : undefined
        )
      ),
      list: vi.fn(() => page([pinned, section])),
      listMemberships: vi.fn(() =>
        page([
          {
            createdAt: 1,
            item: { id: project.id, type: "project" as const },
            position: 0,
            sectionId: pinned.id,
            updatedAt: 1,
          },
          {
            createdAt: 1,
            item: { id: pinnedThread.id, type: "thread" as const },
            position: 1,
            sectionId: pinned.id,
            updatedAt: 1,
          },
        ])
      ),
      listItems: vi.fn(({ sectionId }: { sectionId: string }) =>
        sectionId === pinned.id
          ? page([
              {
                createdAt: 1,
                position: 0,
                project,
                type: "project" as const,
                updatedAt: 1,
              },
              {
                createdAt: 1,
                position: 1,
                thread: pinnedThread,
                type: "thread" as const,
                updatedAt: 1,
              },
            ])
          : page([])
      ),
      moveItem: vi.fn(),
      removeItem: vi.fn(),
      update: vi.fn(),
    },
    threads: {
      archive: vi.fn(),
      fork: vi.fn(),
      list: vi.fn(({ sectionId }: { sectionId?: string | null } = {}) =>
        sectionId === pinned.id
          ? page([pinnedThread])
          : sectionId === null
            ? page([projectThread])
            : page([projectThread, pinnedThread])
      ),
      update: vi.fn(),
    },
    timeline: { get: vi.fn() },
  }
  return { api, data: new SidebarDataApi(async () => api as unknown as CypheriaApi) }
}

describe("SidebarDataApi", () => {
  it("projects direct server memberships into the preserved Sidebar view model", async () => {
    const { data } = setup()

    await expect(data.listProjects()).resolves.toMatchObject({
      data: [{ id: project.id, sectionId: pinned.id }],
    })
    await expect(data.listThreads({ sectionId: pinned.id })).resolves.toMatchObject({
      data: [{ id: "01996a3a-bcde-7000-8000-000000000002", sectionId: pinned.id }],
    })
    await expect(data.listThreads({ sectionId: null })).resolves.toMatchObject({
      data: [{ id: "01996a3a-bcde-7000-8000-000000000001", projectId: project.id }],
    })
  })

  it("routes Sidebar mutations only through Cypheria client facades", async () => {
    const { api, data } = setup()

    await data.moveItemToSection({ id: project.id, type: "project" }, section.id)
    await data.moveThreadToProject("01996a3a-bcde-7000-8000-000000000001", project.id)
    await data.updateProject(project.id, "Cypheria workspace", ["/repo", "/shared"])

    expect(api.sections.moveItem).toHaveBeenCalledWith({
      item: { id: project.id, type: "project" },
      sectionId: section.id,
    })
    expect(api.projects.moveThread).toHaveBeenCalledWith({
      projectId: project.id,
      threadId: "01996a3a-bcde-7000-8000-000000000001",
    })
    expect(api.projects.update).toHaveBeenCalledWith({
      name: "Cypheria workspace",
      projectId: project.id,
      roots: ["/repo", "/shared"],
    })
  })
})
