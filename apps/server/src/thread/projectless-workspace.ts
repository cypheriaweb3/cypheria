import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, rmdir } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"

/**
 * Managed workspaces of Threads that belong to no Project.
 *
 * Layout: `<root>/<YYYY-MM-DD>/<slug>/{outputs,work}`. The Thread directory is the working
 * directory and the Thread's only workspace root. The slug follows the official Codex desktop:
 * the first six `[a-z0-9]+` words of the opening text joined by `-`, at most 80 characters, and
 * `new-chat` when the text has none.
 */

export const PROJECTLESS_OUTPUTS_DIRECTORY = "outputs"
export const PROJECTLESS_WORK_DIRECTORY = "work"
const FALLBACK_SLUG = "new-chat"
const MAX_SLUG_LENGTH = 80
const MAX_SLUG_WORDS = 6
const NUMBERED_ATTEMPTS = 100
const RANDOM_ATTEMPTS = 5
const DATE_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/u
const SLUG_DIRECTORY = /^[a-z0-9][a-z0-9-]*$/u

export const projectlessDirectoryName = (text: string | null | undefined): string => {
  const words = (text ?? "").toLowerCase().match(/[a-z0-9]+/gu)
  if (!words || words.length === 0) return FALLBACK_SLUG
  return words.slice(0, MAX_SLUG_WORDS).join("-").slice(0, MAX_SLUG_LENGTH)
}

/** The date directory name uses the Server's local calendar day, like the Codex desktop. */
export const projectlessDateDirectory = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

export const projectlessOutputsDirectory = (workspace: string): string =>
  join(workspace, PROJECTLESS_OUTPUTS_DIRECTORY)

const assertRealDirectory = async (path: string): Promise<void> => {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Projectless workspace directory must be a real directory")
  }
}

const exists = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "EEXIST"

export const createProjectlessWorkspace = async (input: {
  now?: Date
  root: string
  text?: string | null
}): Promise<string> => {
  const root = resolve(input.root)
  await mkdir(root, { recursive: true })
  await assertRealDirectory(root)
  const dateDirectory = join(root, projectlessDateDirectory(input.now ?? new Date()))
  await mkdir(dateDirectory, { recursive: true })
  await assertRealDirectory(dateDirectory)
  const slug = projectlessDirectoryName(input.text)
  const candidates = [
    ...Array.from({ length: NUMBERED_ATTEMPTS }, (_, index) =>
      index === 0 ? slug : `${slug}-${index + 1}`
    ),
    ...Array.from({ length: RANDOM_ATTEMPTS }, () => `${slug}-${randomUUID()}`),
  ]
  for (const name of candidates) {
    const workspace = join(dateDirectory, name)
    try {
      await mkdir(workspace)
    } catch (error) {
      if (exists(error)) continue
      throw error
    }
    await mkdir(join(workspace, PROJECTLESS_OUTPUTS_DIRECTORY))
    await mkdir(join(workspace, PROJECTLESS_WORK_DIRECTORY))
    return workspace
  }
  throw new Error("Unable to create a unique projectless thread directory")
}

/** True only for `<root>/<date>/<slug>`, so a path is never deleted on a prefix match alone. */
export const isManagedProjectlessWorkspace = (root: string, path: string): boolean => {
  const parts = relative(resolve(root), resolve(path)).split(sep)
  const [date, name] = parts
  return (
    parts.length === 2 &&
    date !== undefined &&
    name !== undefined &&
    DATE_DIRECTORY.test(date) &&
    SLUG_DIRECTORY.test(name)
  )
}

export const listManagedProjectlessWorkspaces = async (root: string): Promise<string[]> => {
  const workspaces: string[] = []
  const dates = await readdir(resolve(root), { withFileTypes: true }).catch(() => [])
  for (const date of dates) {
    if (!date.isDirectory() || !DATE_DIRECTORY.test(date.name)) continue
    const children = await readdir(join(resolve(root), date.name), { withFileTypes: true }).catch(
      () => []
    )
    for (const child of children) {
      if (child.isDirectory() && SLUG_DIRECTORY.test(child.name)) {
        workspaces.push(join(resolve(root), date.name, child.name))
      }
    }
  }
  return workspaces
}

/** Removes the date directory once its last Thread directory is gone. Never recursive. */
export const pruneProjectlessDateDirectory = async (workspace: string): Promise<void> => {
  await rmdir(dirname(resolve(workspace))).catch(() => undefined)
}
