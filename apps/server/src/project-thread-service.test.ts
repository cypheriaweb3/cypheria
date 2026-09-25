import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  openCypheriaDatabase,
  PINNED_SECTION_ID,
} from "@cypheria/db"
import type {
  ProjectThreadClientMessage,
  ProjectThreadServerMessage,
  ServerMessage,
} from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { ProjectThreadService } from "./project-thread-service.js"

describe("ProjectThreadService", () => {
  it("initializes pinned state and dispatches project and section operations", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "cypheria-server-project-thread-test-"))
    const database = openCypheriaDatabase({ cypheriaHome: temporaryDirectory })
    try {
      await applyDatabaseMigrations(database.client)
      await createAgentRegistryPersistenceService(database.db).reconcile([
        { id: "codex", native: true },
      ])
      const persistence = createProjectThreadPersistenceService(database.db)
      const published: ServerMessage[] = []
      const service = new ProjectThreadService({
        persistence,
        publish: (message) => published.push(message),
      })
      await service.initialize()

      const dispatch = async (
        message: ProjectThreadClientMessage
      ): Promise<ProjectThreadServerMessage> => {
        const sent: ServerMessage[] = []
        await service.handle(message, (response) => sent.push(response))
        expect(sent).toHaveLength(1)
        return sent[0] as ProjectThreadServerMessage
      }

      const sections = await dispatch({
        payload: {},
        requestId: "sections",
        type: "section.list.request",
      })
      expect(sections.payload).toMatchObject({
        ok: true,
        value: { data: [{ id: PINNED_SECTION_ID, position: 0 }] },
      })

      const projectResponse = await dispatch({
        payload: { name: "Cypheria", roots: ["/tmp/cypheria"] },
        requestId: "project",
        type: "project.create.request",
      })
      if (projectResponse.type !== "project.create.response" || !projectResponse.payload.ok) {
        throw new Error("Expected project creation to succeed")
      }
      const project = projectResponse.payload.value
      expect(published.at(-1)).toMatchObject({
        payload: { id: project.id },
        type: "project.created.notification",
      })

      const thread = await persistence.createThread({ agentId: "codex", cwd: "/tmp/cypheria" })
      expect(
        (
          await dispatch({
            payload: { item: { id: project.id, type: "project" } },
            requestId: "unsectioned-project",
            type: "section.item.get.request",
          })
        ).payload
      ).toEqual({ ok: true, value: null })
      expect(
        (
          await dispatch({
            payload: { threadId: thread.id },
            requestId: "projectless-thread",
            type: "project.item.get.request",
          })
        ).payload
      ).toEqual({ ok: true, value: null })
      const membership = await dispatch({
        payload: { projectId: project.id, threadId: thread.id },
        requestId: "membership",
        type: "project.item.move.request",
      })
      if (membership.type !== "project.item.move.response" || !membership.payload.ok) {
        throw new Error("Expected project membership move to succeed")
      }
      expect(membership.payload.value).toMatchObject({ project: { id: project.id } })
      expect(published).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ projectId: project.id, threadId: thread.id }),
          type: "project.membership.upserted.notification",
        })
      )
      expect(
        (
          await dispatch({
            payload: {},
            requestId: "memberships",
            type: "project.membership.list.request",
          })
        ).payload
      ).toMatchObject({
        ok: true,
        value: { data: [{ projectId: project.id, threadId: thread.id }] },
      })
    } finally {
      database.close()
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it("returns stable project and section errors", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "cypheria-server-project-thread-test-"))
    const database = openCypheriaDatabase({ cypheriaHome: temporaryDirectory })
    try {
      await applyDatabaseMigrations(database.client)
      const service = new ProjectThreadService({
        persistence: createProjectThreadPersistenceService(database.db),
      })
      await service.initialize()
      const sent: ServerMessage[] = []

      await service.handle(
        {
          payload: { projectId: "01984de2-8f74-7c91-a3b2-5c5e937cf319" },
          requestId: "missing",
          type: "project.read.request",
        },
        (response) => sent.push(response)
      )

      expect(sent[0]).toMatchObject({
        payload: {
          error: { code: "PROJECT_NOT_FOUND", message: "Project was not found" },
          ok: false,
        },
        requestId: "missing",
        type: "project.read.response",
      })
    } finally {
      database.close()
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })
})
