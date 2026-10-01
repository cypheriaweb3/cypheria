import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  createProjectlessWorkspace,
  isManagedProjectlessWorkspace,
  listManagedProjectlessWorkspaces,
  projectlessDateDirectory,
  projectlessDirectoryName,
  projectlessOutputsDirectory,
  pruneProjectlessDateDirectory,
} from "./projectless-workspace.js"

const roots: string[] = []
const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "cypheria-projectless-"))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("projectlessDirectoryName", () => {
  it("joins the first six words and lower-cases them", () => {
    expect(projectlessDirectoryName("Fix the Login bug in the API gateway today")).toBe(
      "fix-the-login-bug-in-the"
    )
  })

  it("falls back to new-chat when no ASCII word is present", () => {
    expect(projectlessDirectoryName("你好，世界")).toBe("new-chat")
    expect(projectlessDirectoryName("   ")).toBe("new-chat")
    expect(projectlessDirectoryName(null)).toBe("new-chat")
  })

  it("keeps at most 80 characters", () => {
    expect(projectlessDirectoryName(`${"a".repeat(200)} b`).length).toBe(80)
  })
})

describe("projectlessDateDirectory", () => {
  it("uses the local calendar day", () => {
    expect(projectlessDateDirectory(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
  })
})

describe("createProjectlessWorkspace", () => {
  it("creates <root>/<date>/<slug> with outputs and work", async () => {
    const root = await temporaryRoot()
    const path = await createProjectlessWorkspace({
      now: new Date(2026, 9, 1),
      root,
      text: "Fix the login bug",
    })
    expect(path).toBe(join(root, "2026-10-01", "fix-the-login-bug"))
    expect((await stat(projectlessOutputsDirectory(path))).isDirectory()).toBe(true)
    expect((await stat(join(path, "work"))).isDirectory()).toBe(true)
  })

  it("numbers repeated names from 2", async () => {
    const root = await temporaryRoot()
    const options = { now: new Date(2026, 9, 1), root, text: "same prompt" }
    const first = await createProjectlessWorkspace(options)
    const second = await createProjectlessWorkspace(options)
    const third = await createProjectlessWorkspace(options)
    expect([first, second, third].map((path) => path.split("/").at(-1))).toEqual([
      "same-prompt",
      "same-prompt-2",
      "same-prompt-3",
    ])
  })

  it("refuses a symbolic-link date directory", async () => {
    const root = await temporaryRoot()
    const elsewhere = await temporaryRoot()
    await symlink(elsewhere, join(root, "2026-10-01"))
    await expect(
      createProjectlessWorkspace({ now: new Date(2026, 9, 1), root, text: "x" })
    ).rejects.toThrow("real directory")
  })
})

describe("managed workspace discovery", () => {
  it("recognises only <root>/<date>/<slug>", async () => {
    const root = await temporaryRoot()
    expect(isManagedProjectlessWorkspace(root, join(root, "2026-10-01", "fix-it"))).toBe(true)
    expect(isManagedProjectlessWorkspace(root, join(root, "fix-it"))).toBe(false)
    expect(isManagedProjectlessWorkspace(root, join(root, "2026-10-01"))).toBe(false)
    expect(isManagedProjectlessWorkspace(root, join(root, "2026-10-01", "a", "b"))).toBe(false)
    expect(isManagedProjectlessWorkspace(root, join(root, "..", "2026-10-01", "fix-it"))).toBe(
      false
    )
    expect(isManagedProjectlessWorkspace(root, join(root, "notes", "fix-it"))).toBe(false)
  })

  it("lists Thread directories and ignores loose files", async () => {
    const root = await temporaryRoot()
    const a = await createProjectlessWorkspace({ now: new Date(2026, 9, 1), root, text: "a" })
    const b = await createProjectlessWorkspace({ now: new Date(2026, 9, 2), root, text: "b" })
    await writeFile(join(root, "stray.txt"), "x")
    await mkdir(join(root, "not-a-date", "child"), { recursive: true })
    expect((await listManagedProjectlessWorkspaces(root)).sort()).toEqual([a, b])
  })

  it("prunes an emptied date directory but never a populated one", async () => {
    const root = await temporaryRoot()
    const a = await createProjectlessWorkspace({ now: new Date(2026, 9, 1), root, text: "a" })
    const b = await createProjectlessWorkspace({ now: new Date(2026, 9, 1), root, text: "b" })
    await rm(a, { recursive: true })
    await pruneProjectlessDateDirectory(a)
    expect(await readdir(join(root, "2026-10-01"))).toEqual(["b"])
    await rm(b, { recursive: true })
    await pruneProjectlessDateDirectory(b)
    expect(await readdir(root)).toEqual([])
  })
})
