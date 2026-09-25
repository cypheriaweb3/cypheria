import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import { z } from "zod"

import { createAgentRegistryPersistenceService } from "./agent.js"
import { openCypheriaDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createProjectThreadPersistenceService, PINNED_SECTION_ID } from "./project-thread.js"

const setup = async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "cypheria-project-thread-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: temporaryDirectory })
  await applyDatabaseMigrations(database.client)
  await createAgentRegistryPersistenceService(database.db).reconcile([
    { id: "codex", native: true },
  ])
  const projectThread = createProjectThreadPersistenceService(database.db)
  await projectThread.ensurePinnedSection(100)
  return {
    close: () => {
      database.close()
      rmSync(temporaryDirectory, { force: true, recursive: true })
    },
    projectThread,
  }
}

describe("project/thread persistence", () => {
  it("creates UUIDv7 records and maintains independent global ordering", async () => {
    const { close, projectThread } = await setup()
    const first = await projectThread.createProject({ name: "First", roots: ["/first"] }, 101)
    const second = await projectThread.createProject(
      { beforeProjectId: first.id, name: "Second", roots: ["/second"] },
      102
    )
    const thread = await projectThread.createThread(
      { agentId: "codex", cwd: "/first", title: "Thread" },
      103
    )

    expect(z.uuidv7().safeParse(first.id).success).toBe(true)
    expect(z.uuidv7().safeParse(thread.id).success).toBe(true)
    expect(thread.agentSessionId).toBeNull()
    expect((await projectThread.listProjects()).data.map(({ id }) => id)).toEqual([
      second.id,
      first.id,
    ])
    expect((await projectThread.listThreads()).data).toEqual([thread])
    expect((await projectThread.listSections()).data).toMatchObject([
      { id: PINNED_SECTION_ID, position: 0 },
    ])
    close()
  })

  it("maintains project membership timestamps, ordering, and materialized recency", async () => {
    const { close, projectThread } = await setup()
    const firstProject = await projectThread.createProject({ name: "First", roots: ["/work"] }, 101)
    const secondProject = await projectThread.createProject(
      { name: "Second", roots: ["/work"] },
      102
    )
    const firstThread = await projectThread.createThread(
      { agentId: "codex", cwd: "/work", recencyAt: 200, title: "First" },
      103
    )
    const secondThread = await projectThread.createThread(
      { agentId: "codex", cwd: "/work", recencyAt: 300, title: "Second" },
      104
    )

    await projectThread.moveThreadToProject(
      { projectId: firstProject.id, threadId: firstThread.id },
      105
    )
    await projectThread.moveThreadToProject(
      {
        beforeThreadId: firstThread.id,
        projectId: firstProject.id,
        threadId: secondThread.id,
      },
      106
    )
    expect((await projectThread.listProjectThreads(firstProject.id)).data).toMatchObject([
      { createdAt: 106, position: 0, thread: { id: secondThread.id } },
      { createdAt: 105, position: 1, thread: { id: firstThread.id } },
    ])
    expect((await projectThread.getProject(firstProject.id))?.recencyAt).toBe(300)
    const unchangedMembership = await projectThread.getThreadProject(firstThread.id)
    await projectThread.moveThreadToProject(
      {
        beforeThreadId: firstThread.id,
        projectId: firstProject.id,
        threadId: firstThread.id,
      },
      999
    )
    expect(await projectThread.getThreadProject(firstThread.id)).toEqual(unchangedMembership)

    await projectThread.moveThreadToProject(
      { projectId: secondProject.id, threadId: secondThread.id },
      107
    )
    expect((await projectThread.getProject(firstProject.id))?.recencyAt).toBe(200)
    expect((await projectThread.getProject(secondProject.id))?.recencyAt).toBe(300)
    expect(await projectThread.getThreadProject(secondThread.id)).toMatchObject({
      createdAt: 107,
      project: { id: secondProject.id },
    })
    expect((await projectThread.listProjectMemberships()).data).toMatchObject([
      { position: 0, projectId: firstProject.id, threadId: firstThread.id },
      { position: 0, projectId: secondProject.id, threadId: secondThread.id },
    ])

    await projectThread.touchThreadRecency(firstThread.id, 400, 108)
    expect((await projectThread.getProject(firstProject.id))?.recencyAt).toBe(400)
    await projectThread.touchThreadRecency(firstThread.id, 350, 109)
    expect(await projectThread.getThread(firstThread.id)).toMatchObject({
      recencyAt: 400,
      updatedAt: 108,
    })
    close()
  })

  it("interleaves project and thread section items and treats pinning as a move", async () => {
    const { close, projectThread } = await setup()
    const section = await projectThread.createSection({ name: "Work" }, 101)
    const project = await projectThread.createProject({ name: "Project", roots: ["/work"] }, 102)
    const thread = await projectThread.createThread({ agentId: "codex" }, 103)

    await projectThread.moveItemToSection(
      { item: { id: project.id, type: "project" }, sectionId: section.id },
      104
    )
    await projectThread.moveItemToSection(
      {
        beforeItem: { id: project.id, type: "project" },
        item: { id: thread.id, type: "thread" },
        sectionId: section.id,
      },
      105
    )
    expect((await projectThread.listSectionItems(section.id)).data).toMatchObject([
      { position: 0, thread: { id: thread.id }, type: "thread" },
      { position: 1, project: { id: project.id }, type: "project" },
    ])
    const unchangedMembership = await projectThread.getItemSection({
      id: thread.id,
      type: "thread",
    })
    await projectThread.moveItemToSection(
      {
        beforeItem: { id: project.id, type: "project" },
        item: { id: thread.id, type: "thread" },
        sectionId: section.id,
      },
      999
    )
    expect(await projectThread.getItemSection({ id: thread.id, type: "thread" })).toEqual(
      unchangedMembership
    )

    await projectThread.pinItem({ item: { id: thread.id, type: "thread" } }, 106)
    expect((await projectThread.listSectionItems(section.id)).data).toHaveLength(1)
    expect((await projectThread.listSectionItems(PINNED_SECTION_ID)).data).toMatchObject([
      { thread: { id: thread.id }, type: "thread" },
    ])
    expect((await projectThread.listSectionMemberships()).data).toEqual(
      expect.arrayContaining([
        {
          createdAt: expect.any(Number),
          item: { id: project.id, type: "project" },
          position: expect.any(Number),
          sectionId: section.id,
          updatedAt: expect.any(Number),
        },
        {
          createdAt: expect.any(Number),
          item: { id: thread.id, type: "thread" },
          position: expect.any(Number),
          sectionId: PINNED_SECTION_ID,
          updatedAt: expect.any(Number),
        },
      ])
    )
    await projectThread.unpinItem({ id: thread.id, type: "thread" }, 107)
    expect((await projectThread.listSectionItems(PINNED_SECTION_ID)).data).toHaveLength(0)
    close()
  })

  it("filters projectless and unsectioned threads and sorts direct section threads", async () => {
    const { close, projectThread } = await setup()
    const section = await projectThread.createSection({ name: "Work" }, 101)
    const project = await projectThread.createProject({ name: "Project", roots: ["/work"] }, 102)
    const first = await projectThread.createThread({ agentId: "codex", title: "First" }, 103)
    const second = await projectThread.createThread({ agentId: "codex", title: "Second" }, 104)
    const projectThreadRecord = await projectThread.createThread(
      {
        agentId: "codex",
        cwd: "/work",
        projectPlacement: { projectId: project.id },
        title: "Project",
      },
      105
    )

    await projectThread.moveItemToSection(
      { item: { id: second.id, type: "thread" }, sectionId: section.id },
      106
    )
    await projectThread.moveItemToSection(
      {
        beforeItem: { id: second.id, type: "thread" },
        item: { id: first.id, type: "thread" },
        sectionId: section.id,
      },
      107
    )

    expect(
      (
        await projectThread.listThreads({
          sectionId: section.id,
          sortDirection: "asc",
          sortKey: "sectionPosition",
        })
      ).data.map(({ id }) => id)
    ).toEqual([first.id, second.id])
    expect((await projectThread.listThreads({ sectionId: null })).data.map(({ id }) => id)).toEqual(
      [projectThreadRecord.id]
    )
    expect((await projectThread.listThreads({ projectId: null })).data.map(({ id }) => id)).toEqual(
      [first.id, second.id]
    )
    expect(
      (await projectThread.listThreads({ projectId: project.id })).data.map(({ id }) => id)
    ).toEqual([projectThreadRecord.id])
    close()
  })

  it("clears fork ancestry and preserves threads when deleting a project", async () => {
    const { close, projectThread } = await setup()
    const project = await projectThread.createProject({ name: "Project", roots: ["/work"] }, 101)
    const parent = await projectThread.createThread(
      { agentId: "codex", cwd: "/work", projectPlacement: { projectId: project.id } },
      102
    )
    const child = await projectThread.createThread(
      {
        agentId: "codex",
        cwd: "/work",
        forkedFromId: parent.id,
        projectPlacement: { projectId: project.id },
      },
      103
    )

    await projectThread.markThreadDeleting(parent.id, 104)
    expect(await projectThread.getThread(parent.id)).toBeUndefined()
    expect(await projectThread.listDeletedResources()).toContainEqual(
      expect.objectContaining({ type: "thread", value: expect.objectContaining({ id: parent.id }) })
    )
    await projectThread.purgeThread(parent.id, 104)
    expect(await projectThread.getThread(child.id)).toMatchObject({
      forkedFromId: null,
      updatedAt: 104,
    })
    await projectThread.markProjectDeleting(project.id, 105)
    expect(await projectThread.getProject(project.id)).toBeUndefined()
    await projectThread.purgeProject(project.id, 105)
    expect(await projectThread.getThread(child.id)).toBeDefined()
    expect(await projectThread.getThreadProject(child.id)).toBeUndefined()
    close()
  })

  it("archives threads without losing project or section placement", async () => {
    const { close, projectThread } = await setup()
    const project = await projectThread.createProject({ name: "Project", roots: ["/work"] }, 101)
    const section = await projectThread.createSection({ name: "Section" }, 102)
    const thread = await projectThread.createThread(
      {
        agentId: "codex",
        cwd: "/work",
        projectPlacement: { projectId: project.id },
        recencyAt: 200,
        sectionPlacement: { sectionId: section.id },
      },
      103
    )

    const archived = await projectThread.setThreadArchived(thread.id, 300, 104)
    expect(archived).toMatchObject({ archivedAt: 300, updatedAt: 104 })
    expect((await projectThread.listThreads()).data).toHaveLength(0)
    expect((await projectThread.listThreads({ archived: true })).data).toEqual([archived])
    expect((await projectThread.listProjectThreads(project.id)).data).toHaveLength(0)
    expect((await projectThread.listSectionItems(section.id)).data).toHaveLength(0)
    expect((await projectThread.getProject(project.id))?.recencyAt).toBeNull()

    const restored = await projectThread.setThreadArchived(thread.id, null, 105)
    expect(restored.archivedAt).toBeNull()
    expect((await projectThread.listProjectThreads(project.id)).data).toMatchObject([
      { thread: { id: thread.id } },
    ])
    expect((await projectThread.listSectionItems(section.id)).data).toMatchObject([
      { thread: { id: thread.id }, type: "thread" },
    ])
    expect((await projectThread.getProject(project.id))?.recencyAt).toBe(200)
    close()
  })

  it("keeps every project thread cwd in the project's saved roots", async () => {
    const { close, projectThread } = await setup()
    const project = await projectThread.createProject(
      { name: "Project", roots: ["/work", "/shared"] },
      101
    )
    const thread = await projectThread.createThread({ agentId: "codex", cwd: "/work" }, 102)

    await expect(
      projectThread.moveThreadToProject({ projectId: project.id, threadId: thread.id }, 103)
    ).resolves.toMatchObject({ project: { id: project.id } })
    await expect(
      projectThread.updateThread(thread.id, { cwd: "/work/child" }, 104)
    ).rejects.toMatchObject({ code: "THREAD_CWD_OUTSIDE_PROJECT" })
    await expect(
      projectThread.updateProject(project.id, { roots: ["/shared"] }, 105)
    ).rejects.toMatchObject({ code: "THREAD_CWD_OUTSIDE_PROJECT" })

    const outside = await projectThread.createThread({ agentId: "codex", cwd: "/elsewhere" }, 106)
    await expect(
      projectThread.moveThreadToProject({ projectId: project.id, threadId: outside.id }, 107)
    ).rejects.toMatchObject({ code: "THREAD_CWD_OUTSIDE_PROJECT" })
    expect(await projectThread.getThreadProject(outside.id)).toBeUndefined()
    close()
  })
})
