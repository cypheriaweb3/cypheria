import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import type { ServerMessage } from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { WorkspaceFileService } from "./workspace-file-service.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

const setup = async () => {
  const home = await mkdtemp(join(tmpdir(), "cypheria-workspace-files-"))
  cleanup.push(home)
  const root = join(home, "managed", "2026-10-01", "thread")
  await mkdir(join(root, "work"), { recursive: true })
  await mkdir(join(root, "outputs"), { recursive: true })
  const database = openCypheriaDatabase({ cypheriaHome: home })
  await applyDatabaseMigrations(database.client)
  await createAgentRegistryPersistenceService(database.db).reconcile([
    { id: "codex", native: true },
  ])
  const persistence = createProjectThreadPersistenceService(database.db)
  const thread = await persistence.createThread({ agentId: "codex", roots: [root] })
  const messages: ServerMessage[] = []
  const service = new WorkspaceFileService({
    cypheriaHome: home,
    persistence,
    projectlessRoot: join(home, "managed"),
    publish: (message) => messages.push(message),
  })
  return { database, messages, root, service, thread }
}

describe("WorkspaceFileService cleanup", () => {
  it("lists and deletes only unreferenced <date>/<slug> workspaces", async () => {
    const { database, root, service } = await setup()
    try {
      const orphan = join(root, "..", "orphan")
      await mkdir(orphan, { recursive: true })
      await mkdir(join(root, "..", "..", "loose"), { recursive: true })
      const listed = await service.listCleanup()
      expect(listed.items.map(({ path }) => path)).toEqual([orphan])
      await expect(service.deleteCleanup([root])).resolves.toMatchObject({
        deleted: [],
        failed: [{ path: root }],
      })
      await expect(service.deleteCleanup([join(root, "..", "..", "loose")])).resolves.toMatchObject(
        { deleted: [], failed: [{ message: expect.stringContaining("managed") }] }
      )
      await expect(service.deleteCleanup([orphan])).resolves.toEqual({
        deleted: [orphan],
        failed: [],
      })
    } finally {
      database.close()
    }
  })
})

describe("WorkspaceFileService", () => {
  it("loads direct children with pagination and includes hidden files", async () => {
    const { database, root, service, thread } = await setup()
    try {
      await writeFile(join(root, ".hidden"), "hidden")
      await writeFile(join(root, "visible.txt"), "visible")
      const first = await service.listDirectory({
        limit: 2,
        path: "",
        root,
        threadId: thread.id,
      })
      expect(first.data.map(({ name }) => name)).toEqual(["outputs", "work"])
      expect(first.nextCursor).not.toBeNull()
      const second = await service.listDirectory({
        cursor: first.nextCursor ?? undefined,
        limit: 10,
        path: "",
        root,
        threadId: thread.id,
      })
      expect(second.data.map(({ name }) => name)).toEqual([".hidden", "visible.txt"])
    } finally {
      database.close()
    }
  })

  it("rejects traversal and symlinks that escape the selected root", async () => {
    const { database, root, service, thread } = await setup()
    try {
      await expect(
        service.read({ path: "../secret", root, threadId: thread.id })
      ).rejects.toMatchObject({ code: "INVALID_PATH" })
      await symlink(tmpdir(), join(root, "outside"))
      await expect(
        service.listDirectory({ limit: 10, path: "outside", root, threadId: thread.id })
      ).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" })
    } finally {
      database.close()
    }
  })

  it("returns bounded binary files with an opaque stream identity", async () => {
    const { database, root, service, thread } = await setup()
    try {
      await writeFile(join(root, "image.png"), Buffer.from([0, 1, 2, 3]))
      const transfer = await service.readForTransfer({
        path: "image.png",
        root,
        threadId: thread.id,
      })
      expect(transfer.result).toMatchObject({
        kind: "binary",
        mimeType: "image/png",
        sizeBytes: 4,
      })
      expect(transfer.bytes).toEqual(new Uint8Array([0, 1, 2, 3]))
    } finally {
      database.close()
    }
  })

  it("returns metadata instead of streaming text beyond the preview limit", async () => {
    const { database, root, service, thread } = await setup()
    try {
      await writeFile(join(root, "large.txt"), "x".repeat(2 * 1024 * 1024 + 1))
      const transfer = await service.readForTransfer({
        path: "large.txt",
        root,
        threadId: thread.id,
      })
      expect(transfer).toMatchObject({
        result: { kind: "metadata", reason: "too-large" },
      })
      expect(transfer.bytes).toBeUndefined()
    } finally {
      database.close()
    }
  })

  it("uses opaque versions and restores quarantined files without overwriting", async () => {
    const { database, messages, root, service, thread } = await setup()
    try {
      await writeFile(join(root, "note.txt"), "one")
      const opened = await service.read({ path: "note.txt", root, threadId: thread.id })
      expect(opened.kind).toBe("text")
      await writeFile(join(root, "note.txt"), "external")
      await expect(
        service.write({
          content: "two",
          path: "note.txt",
          root,
          threadId: thread.id,
          version: opened.version,
        })
      ).rejects.toMatchObject({ code: "FILE_VERSION_CONFLICT" })
      const fresh = await service.read({ path: "note.txt", root, threadId: thread.id })
      await service.write({
        content: "two",
        path: "note.txt",
        root,
        threadId: thread.id,
        version: fresh.version,
      })
      const deleted = await service.delete({ path: "note.txt", root, threadId: thread.id })
      await service.restore({ restoreToken: deleted.restoreToken, threadId: thread.id })
      await expect(readFile(join(root, "note.txt"), "utf8")).resolves.toBe("two")
      expect(messages.map(({ type }) => type)).toEqual([
        "thread.files.changed.notification",
        "thread.files.changed.notification",
        "thread.files.changed.notification",
      ])
    } finally {
      database.close()
    }
  })
})
