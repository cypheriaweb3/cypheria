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
  it("initializes pinned state and dispatches project and thread operations", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "cypheria-server-project-thread-test-"))
    const database = openCypheriaDatabase({ cypheriaHome: temporaryDirectory })
    try {
      await applyDatabaseMigrations(database.client)
      await createAgentRegistryPersistenceService(database.db).reconcile([
        { id: "codex", native: true },
      ])
      const persistence = createProjectThreadPersistenceService(database.db)
      const service = new ProjectThreadService({ persistence })
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
      if (!projectResponse.payload.ok || projectResponse.type !== "project.create.response") {
        throw new Error("Expected project creation to succeed")
      }
      const project = projectResponse.payload.value

      const threadResponse = await dispatch({
        payload: {
          agentId: "codex",
          projectPlacement: { projectId: project.id },
          title: "Implement project/thread state",
        },
        requestId: "thread",
        type: "thread.create.request",
      })
      if (!threadResponse.payload.ok || threadResponse.type !== "thread.create.response") {
        throw new Error("Expected thread creation to succeed")
      }
      expect(threadResponse.payload.value).toMatchObject({
        agentId: "codex",
        agentSessionId: null,
      })
      await expect(
        persistence.getThreadProject(threadResponse.payload.value.id)
      ).resolves.toMatchObject({ project: { id: project.id } })
    } finally {
      database.close()
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it("returns stable project/thread errors", async () => {
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
