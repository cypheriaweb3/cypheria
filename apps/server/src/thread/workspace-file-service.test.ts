import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import type { ServerMessage } from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { codexGeneratedImagesDir } from "../agent/codex-generated-images.js"
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

describe("WorkspaceFileService path resolution", () => {
  it("resolves model-written paths to a Thread root and nothing else", async () => {
    const { database, root, service, thread } = await setup()
    try {
      await mkdir(join(root, "src"), { recursive: true })
      await writeFile(join(root, "src", "app.ts"), "export {}\n")
      await writeFile(join(root, "outputs", "chart.png"), "png")
      await writeFile(join(root, "odd:12"), "x")
      const resolve = (path: string) => service.resolvePath({ path, threadId: thread.id })

      await expect(resolve(join(root, "src", "app.ts"))).resolves.toEqual({
        kind: "file",
        mimeType: expect.any(String),
        path: "src/app.ts",
        root,
        sizeBytes: 10,
      })
      await expect(resolve(`${join(root, "src", "app.ts")}#L12-L20`)).resolves.toMatchObject({
        endLine: 20,
        line: 12,
        path: "src/app.ts",
      })
      await expect(resolve(`${join(root, "src", "app.ts")}:7:3`)).resolves.toMatchObject({
        line: 7,
        path: "src/app.ts",
      })
      await expect(
        resolve(pathToFileURL(join(root, "outputs", "chart.png")).href)
      ).resolves.toMatchObject({
        kind: "file",
        mimeType: "image/png",
        path: "outputs/chart.png",
      })
      await expect(resolve("src/app.ts")).resolves.toMatchObject({ path: "src/app.ts" })
      await expect(resolve(join(root, "src"))).resolves.toEqual({
        kind: "directory",
        path: "src",
        root,
      })
      await expect(resolve(root)).resolves.toEqual({ kind: "directory", path: "", root })
      // A real file whose name looks like a line reference wins over the reading.
      await expect(resolve(join(root, "odd:12"))).resolves.toMatchObject({
        path: "odd:12",
      })
      await expect(resolve(join(root, "src", "gone.ts"))).resolves.toEqual({ kind: "missing" })
      await expect(resolve(join(tmpdir(), "elsewhere.txt"))).resolves.toEqual({ kind: "outside" })
      await expect(resolve(join(root, "..", "..", "x"))).resolves.toEqual({ kind: "outside" })
    } finally {
      database.close()
    }
  })

  it("treats a symbolic link that leads out of the root as outside", async () => {
    const { database, root, service, thread } = await setup()
    try {
      const outside = await mkdtemp(join(tmpdir(), "cypheria-outside-"))
      cleanup.push(outside)
      await writeFile(join(outside, "secret.txt"), "secret")
      await symlink(join(outside, "secret.txt"), join(root, "link.txt"))
      await expect(
        service.resolvePath({ path: join(root, "link.txt"), threadId: thread.id })
      ).resolves.toEqual({ kind: "outside" })
    } finally {
      database.close()
    }
  })
})

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

describe("WorkspaceFileService output roots", () => {
  it("reads a Codex session's generated images without making them writable or workspace roots", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-output-roots-"))
    cleanup.push(home)
    const root = join(home, "work")
    const codexHome = join(home, "codex-home")
    await mkdir(root, { recursive: true })
    const database = openCypheriaDatabase({ cypheriaHome: home })
    try {
      await applyDatabaseMigrations(database.client)
      await createAgentRegistryPersistenceService(database.db).reconcile([
        { id: "codex", native: true },
      ])
      const persistence = createProjectThreadPersistenceService(database.db)
      const thread = await persistence.createThread({
        agentId: "codex",
        agentSessionId: "019a-session",
        roots: [root],
      })
      const other = await persistence.createThread({
        agentId: "codex",
        agentSessionId: "019a-other",
        roots: [root],
      })
      const images = codexGeneratedImagesDir(codexHome, "019a-session")
      const otherImages = codexGeneratedImagesDir(codexHome, "019a-other")
      await mkdir(images, { recursive: true })
      await mkdir(otherImages, { recursive: true })
      await writeFile(join(images, "call_1.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))
      await writeFile(join(otherImages, "call_2.png"), "png")
      const service = new WorkspaceFileService({
        cypheriaHome: home,
        outputRoots: (record) =>
          record.agentId === "codex" && record.agentSessionId
            ? [codexGeneratedImagesDir(codexHome, record.agentSessionId)]
            : [],
        persistence,
        projectlessRoot: join(home, "managed"),
        publish: () => undefined,
      })

      await expect(
        service.resolvePath({ path: join(images, "call_1.png"), threadId: thread.id })
      ).resolves.toMatchObject({ kind: "file", path: "call_1.png", root: images })
      await expect(
        service.read({ path: "call_1.png", root: images, threadId: thread.id })
      ).resolves.toMatchObject({ kind: "binary" })
      // Another Thread's images stay out of reach.
      await expect(
        service.resolvePath({ path: join(otherImages, "call_2.png"), threadId: thread.id })
      ).resolves.toEqual({ kind: "outside" })
      await expect(
        service.read({ path: "call_2.png", root: otherImages, threadId: thread.id })
      ).rejects.toMatchObject({ code: "ROOT_NOT_ALLOWED" })
      await expect(
        service.write({
          content: "x",
          path: "call_1.png",
          root: images,
          threadId: thread.id,
          version: null,
        })
      ).rejects.toMatchObject({ code: "ROOT_READ_ONLY" })
      await expect(
        service.delete({ path: "call_1.png", root: images, threadId: thread.id })
      ).rejects.toMatchObject({ code: "ROOT_READ_ONLY" })
      // The output root is never a workspace root of the Thread.
      expect((await persistence.getThread(thread.id))?.roots).toEqual([root])
      expect(other.roots).toEqual([root])
    } finally {
      database.close()
    }
  })
})
