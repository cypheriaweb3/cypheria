import { randomUUID } from "node:crypto"
import {
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProjectThreadPersistenceService } from "@cypheria/db"
import type {
  ServerMessage,
  ThreadPathResolution,
  WorkspaceFileEntry,
  WorkspaceFileReadResult,
} from "@cypheria/protocol"
import {
  isManagedProjectlessWorkspace,
  listManagedProjectlessWorkspaces,
  pruneProjectlessDateDirectory,
} from "./projectless-workspace.js"

const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024
const BINARY_PREVIEW_LIMIT = 16 * 1024 * 1024

export class WorkspaceFileError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

type FileLocation = { path: string; root: string; threadId: string }
type WorkspaceFileChange = {
  kind: "created" | "changed" | "moved" | "deleted" | "restored"
  path: string
  previousPath?: string
  root: string
}

const isInside = (root: string, path: string): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)

type PathCandidate = { endLine?: number; line?: number; path: string }

/** The readings of a model-written path, most literal first. */
const pathCandidates = (value: string, cwd: string): PathCandidate[] => {
  const toAbsolute = (text: string): string | null => {
    try {
      if (text.startsWith("file:")) return fileURLToPath(text)
      if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) {
        return join(homedir(), text.slice(1))
      }
      return isAbsolute(text) ? text : resolve(cwd, text)
    } catch {
      return null
    }
  }
  const candidates: PathCandidate[] = []
  const literal = toAbsolute(value)
  if (literal) candidates.push({ path: literal })
  const hash = /^(.+?)#L(\d+)(?:-L?(\d+))?$/u.exec(value)
  const colon = /^(.+?):(\d+)(?::\d+)?$/u.exec(value)
  const match = hash ?? colon
  if (match?.[1] && match[2]) {
    const path = toAbsolute(match[1])
    const line = Number(match[2])
    const endLine = match[3] ? Number(match[3]) : undefined
    if (path && line > 0) {
      candidates.push({
        ...(endLine && endLine >= line ? { endLine } : {}),
        line,
        path,
      })
    }
  }
  return candidates
}

export class WorkspaceFileService {
  readonly #persistence: ProjectThreadPersistenceService
  readonly #pendingChanges = new Map<string, WorkspaceFileChange[]>()
  #projectlessRoot: string
  readonly #publish: (message: ServerMessage) => void
  readonly #quarantineRoot: string

  constructor(options: {
    cypheriaHome: string
    persistence: ProjectThreadPersistenceService
    projectlessRoot: string
    publish: (message: ServerMessage) => void
  }) {
    this.#persistence = options.persistence
    this.#projectlessRoot = resolve(options.projectlessRoot)
    this.#publish = options.publish
    this.#quarantineRoot = join(resolve(options.cypheriaHome), "quarantine", "files")
  }

  setProjectlessRoot(path: string): void {
    this.#projectlessRoot = resolve(path)
  }

  async listDirectory(input: FileLocation & { cursor?: string; limit: number }) {
    const { root, target } = await this.#location(input, "read")
    const directory = await stat(target).catch(() => undefined)
    if (!directory?.isDirectory())
      throw new WorkspaceFileError("NOT_A_DIRECTORY", "Directory not found")
    const entries = await readdir(target, { withFileTypes: true })
    entries.sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1
      if (!left.isDirectory() && right.isDirectory()) return 1
      return left.name.localeCompare(right.name)
    })
    const offset = input.cursor ? this.#decodeCursor(input.cursor) : 0
    const selected = entries.slice(offset, offset + input.limit)
    const data = await Promise.all(
      selected.map((entry) =>
        this.#entry(root, join(target, entry.name), this.#joinPath(input.path, entry.name))
      )
    )
    const next = offset + data.length
    return { data, nextCursor: next < entries.length ? this.#encodeCursor(next) : null }
  }

  async search(input: { limit: number; query: string; threadId: string }) {
    const thread = await this.#thread(input.threadId)
    const query = input.query.toLocaleLowerCase()
    const data: WorkspaceFileEntry[] = []
    for (const root of thread.roots) {
      const queue = [""]
      let queueIndex = 0
      while (queueIndex < queue.length && data.length < input.limit) {
        const path = queue[queueIndex] as string
        queueIndex += 1
        const target = await this.#safeTarget(root, path, "read")
        const children = await readdir(target, { withFileTypes: true }).catch(() => [])
        const entries = await Promise.all(
          children.map((child) => {
            const childPath = this.#joinPath(path, child.name)
            return this.#entry(root, join(target, child.name), childPath)
          })
        )
        for (const entry of entries) {
          if (`${entry.path}\n${entry.name}`.toLocaleLowerCase().includes(query)) data.push(entry)
          if (entry.kind === "directory") queue.push(entry.path)
          if (data.length >= input.limit) break
        }
      }
      if (data.length >= input.limit) break
    }
    return { data }
  }

  async read(input: FileLocation): Promise<WorkspaceFileReadResult> {
    return (await this.readForTransfer(input)).result
  }

  async readForTransfer(
    input: FileLocation
  ): Promise<{ bytes?: Uint8Array; result: WorkspaceFileReadResult }> {
    const { root, target } = await this.#location(input, "read")
    const info = await stat(target).catch(() => undefined)
    if (!info?.isFile()) throw new WorkspaceFileError("FILE_NOT_FOUND", "File not found")
    const metadata = {
      mimeType: this.#mime(input.path),
      modifiedAt: info.mtime.toISOString(),
      path: input.path,
      root,
      sizeBytes: info.size,
      version: this.#version(info),
    }
    if (info.size > BINARY_PREVIEW_LIMIT) {
      return { result: { ...metadata, kind: "metadata", reason: "too-large" } }
    }
    const bytes = await readFile(target)
    if (!bytes.includes(0)) {
      try {
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        if (info.size > TEXT_PREVIEW_LIMIT) {
          return { result: { ...metadata, kind: "metadata", reason: "too-large" } }
        }
        return {
          result: {
            ...metadata,
            content,
            kind: "text",
          },
        }
      } catch {
        // Invalid UTF-8 is transferred as binary below.
      }
    }
    const streamId = randomUUID()
    return { bytes: new Uint8Array(bytes), result: { ...metadata, kind: "binary", streamId } }
  }

  async create(input: FileLocation & { kind: "file" | "directory" }) {
    const { root, target } = await this.#location(input, "write")
    await this.#assertMissing(target)
    if (input.kind === "directory") await mkdir(target)
    else await open(target, "wx").then((handle) => handle.close())
    const entry = await this.#entry(root, target, input.path)
    this.#changed(input.threadId, { kind: "created", path: input.path, root })
    return entry
  }

  async write(input: FileLocation & { content: string; version: string | null }) {
    const { root, target } = await this.#location(input, "write")
    const current = await stat(target).catch(() => undefined)
    if (!current?.isFile()) throw new WorkspaceFileError("FILE_NOT_FOUND", "File not found")
    if (input.version === null || input.version !== this.#version(current)) {
      throw new WorkspaceFileError("FILE_VERSION_CONFLICT", "The file changed since it was opened")
    }
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, input.content, { flag: "wx" })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    this.#changed(input.threadId, { kind: "changed", path: input.path, root })
    return this.read(input)
  }

  async move(input: FileLocation & { destinationPath: string }) {
    const source = await this.#location(input, "write")
    const destination = await this.#location(
      { path: input.destinationPath, root: input.root, threadId: input.threadId },
      "write"
    )
    await this.#assertMissing(destination.target)
    await rename(source.target, destination.target)
    const entry = await this.#entry(source.root, destination.target, input.destinationPath)
    this.#changed(input.threadId, {
      kind: "moved",
      path: input.destinationPath,
      previousPath: input.path,
      root: source.root,
    })
    return entry
  }

  async delete(input: FileLocation) {
    const { root, target } = await this.#location(input, "write")
    await lstat(target).catch(() => {
      throw new WorkspaceFileError("FILE_NOT_FOUND", "File not found")
    })
    const restoreToken = randomUUID()
    const directory = join(this.#quarantineRoot, restoreToken)
    await mkdir(directory, { recursive: true })
    const payload = join(directory, "payload")
    let relocated = false
    try {
      await this.#relocate(target, payload)
      relocated = true
      await writeFile(
        join(directory, "metadata.json"),
        JSON.stringify({ path: input.path, root, threadId: input.threadId })
      )
    } catch (error) {
      const failures: unknown[] = [error]
      if (relocated) await this.#relocate(payload, target).catch((cause) => failures.push(cause))
      await rm(directory, { force: true, recursive: true }).catch((cause) => failures.push(cause))
      if (failures.length > 1) {
        throw new AggregateError(failures, "File deletion and quarantine rollback failed")
      }
      throw error
    }
    this.#changed(input.threadId, { kind: "deleted", path: input.path, root })
    return { restoreToken }
  }

  async restore(input: { restoreToken: string; threadId: string }) {
    const directory = join(this.#quarantineRoot, input.restoreToken)
    const metadata = JSON.parse(await readFile(join(directory, "metadata.json"), "utf8")) as {
      path: string
      root: string
      threadId: string
    }
    if (metadata.threadId !== input.threadId) {
      throw new WorkspaceFileError(
        "RESTORE_TOKEN_INVALID",
        "Restore token belongs to another thread"
      )
    }
    const { root, target } = await this.#location(
      { ...metadata, threadId: input.threadId },
      "write"
    )
    await this.#assertMissing(target)
    await this.#relocate(join(directory, "payload"), target)
    await rm(directory, { force: true, recursive: true }).catch(() => undefined)
    const entry = await this.#entry(root, target, metadata.path)
    this.#changed(input.threadId, { kind: "restored", path: metadata.path, root })
    return entry
  }

  /**
   * Resolves a path a model wrote to the Thread root that holds it. The path may be absolute, start
   * with `~`, be a `file:` URL, or be relative to the working directory, and may end in a line
   * reference (`#L12`, `#L12-L20`, `:12`, `:12:3`). Anything that is not inside a Thread root,
   * including a symbolic link that leads out of one, is `outside`.
   */
  async resolvePath(input: { path: string; threadId: string }): Promise<ThreadPathResolution> {
    const thread = await this.#thread(input.threadId)
    const cwd = thread.roots[0] ?? this.#projectlessRoot
    let first: ThreadPathResolution | undefined
    for (const candidate of pathCandidates(input.path, cwd)) {
      const resolved = await this.#resolveInRoots(thread.roots, candidate.path)
      if (resolved.kind === "missing" || resolved.kind === "outside") {
        first ??= resolved
        continue
      }
      return resolved.kind === "file"
        ? {
            ...resolved,
            ...(candidate.line ? { line: candidate.line } : {}),
            ...(candidate.endLine ? { endLine: candidate.endLine } : {}),
          }
        : resolved
    }
    return first ?? { kind: "missing" }
  }

  async #resolveInRoots(roots: readonly string[], absolute: string): Promise<ThreadPathResolution> {
    const target = resolve(absolute)
    const real = await realpath(target).catch(() => null)
    for (const root of roots) {
      const rootReal = await realpath(root).catch(() => null)
      if (!rootReal) continue
      if (real === null) {
        // Missing: say so only when the path would be inside a root, so nothing about the rest of
        // the file system is revealed.
        if (isInside(resolve(root), target) || isInside(rootReal, target))
          return { kind: "missing" }
        continue
      }
      if (!isInside(rootReal, real)) continue
      const path = relative(rootReal, real).split(sep).join("/")
      const info = await stat(real).catch(() => undefined)
      if (info?.isDirectory()) return { kind: "directory", path, root }
      if (info?.isFile()) {
        return {
          kind: "file",
          mimeType: this.#mime(path),
          path,
          root,
          sizeBytes: info.size,
        }
      }
      return { kind: "missing" }
    }
    return { kind: "outside" }
  }

  async listCleanup() {
    const items = []
    for (const path of await listManagedProjectlessWorkspaces(this.#projectlessRoot)) {
      if ((await this.#persistence.countProjectlessRootReferences(path)) > 0) continue
      const info = await stat(path).catch(() => undefined)
      items.push({
        createdAt: info ? Math.floor(info.birthtimeMs / 1000) : null,
        kind: "projectless" as const,
        path,
        sizeBytes: null,
      })
    }
    return { items }
  }

  async deleteCleanup(paths: readonly string[]) {
    const deleted: string[] = []
    const failed: Array<{ message: string; path: string }> = []
    for (const value of paths) {
      const path = resolve(value)
      try {
        if (!isManagedProjectlessWorkspace(this.#projectlessRoot, path)) {
          throw new WorkspaceFileError(
            "INVALID_WORKSPACE",
            "Path is not a managed projectless workspace"
          )
        }
        if ((await this.#persistence.countProjectlessRootReferences(path)) > 0) {
          throw new WorkspaceFileError("WORKSPACE_REFERENCED", "Workspace is still referenced")
        }
        await rm(path, { recursive: true })
        await pruneProjectlessDateDirectory(path)
        deleted.push(path)
      } catch (error) {
        failed.push({ message: error instanceof Error ? error.message : String(error), path })
      }
    }
    return { deleted, failed }
  }

  async #location(input: FileLocation, operation: "read" | "write") {
    const thread = await this.#thread(input.threadId)
    const root = resolve(input.root)
    if (!thread.roots.includes(root))
      throw new WorkspaceFileError("ROOT_NOT_ALLOWED", "Root is not part of this thread")
    return { root, target: await this.#safeTarget(root, input.path, operation) }
  }

  async #thread(threadId: string) {
    const thread = await this.#persistence.getThread(threadId)
    if (!thread) throw new WorkspaceFileError("THREAD_NOT_FOUND", "Thread was not found")
    return thread
  }

  async #safeTarget(root: string, path: string, operation: "read" | "write") {
    if (path.includes("\0") || isAbsolute(path))
      throw new WorkspaceFileError("INVALID_PATH", "Path must be root-relative")
    const segments = path.split("/").filter(Boolean)
    if (segments.some((segment) => segment === "." || segment === "..")) {
      throw new WorkspaceFileError("INVALID_PATH", "Path traversal is not allowed")
    }
    const target = resolve(root, ...segments)
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new WorkspaceFileError("INVALID_PATH", "Path escapes the workspace root")
    }
    const rootReal = await realpath(root)
    if (operation === "write") {
      let ancestor = dirname(target)
      while (ancestor !== root && ancestor.startsWith(`${root}${sep}`)) {
        const info = await lstat(ancestor).catch(() => undefined)
        if (info?.isSymbolicLink())
          throw new WorkspaceFileError("SYMLINK_WRITE_FORBIDDEN", "Cannot modify through a symlink")
        ancestor = dirname(ancestor)
      }
    }
    const existingReal = await realpath(target).catch(() => null)
    if (
      existingReal &&
      existingReal !== rootReal &&
      !existingReal.startsWith(`${rootReal}${sep}`)
    ) {
      throw new WorkspaceFileError("SYMLINK_ESCAPE", "Symlink target is outside the workspace root")
    }
    return target
  }

  async #entry(root: string, target: string, path: string): Promise<WorkspaceFileEntry> {
    const info = await lstat(target)
    const kind = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file"
    let hasChildren: boolean | null = null
    if (kind === "directory") hasChildren = (await readdir(target)).length > 0
    return {
      hasChildren,
      kind,
      modifiedAt: info.mtime.toISOString(),
      name: basename(target),
      path,
      root,
      sizeBytes: kind === "file" ? info.size : null,
    }
  }

  async #assertMissing(path: string) {
    if (
      await lstat(path)
        .then(() => true)
        .catch(() => false)
    ) {
      throw new WorkspaceFileError("PATH_EXISTS", "Destination already exists")
    }
  }

  async #relocate(source: string, destination: string): Promise<void> {
    try {
      await rename(source, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
      await cp(source, destination, {
        errorOnExist: true,
        force: false,
        recursive: true,
        verbatimSymlinks: true,
      })
      try {
        await rm(source, { recursive: true })
      } catch (removeError) {
        await rm(destination, { force: true, recursive: true }).catch(() => undefined)
        throw removeError
      }
    }
  }

  #version(info: { ino: number | bigint; mtimeMs: number; size: number }) {
    return Buffer.from(`${info.ino}:${info.size}:${info.mtimeMs}`).toString("base64url")
  }

  #mime(path: string) {
    const extension = path.toLowerCase().split(".").at(-1)
    return (
      (
        {
          css: "text/css",
          csv: "text/csv",
          gif: "image/gif",
          html: "text/html",
          ico: "image/x-icon",
          jpeg: "image/jpeg",
          jpg: "image/jpeg",
          js: "text/javascript",
          json: "application/json",
          jsx: "text/javascript",
          md: "text/markdown",
          pdf: "application/pdf",
          png: "image/png",
          svg: "image/svg+xml",
          tsv: "text/tab-separated-values",
          ts: "text/typescript",
          tsx: "text/typescript",
          txt: "text/plain",
          webp: "image/webp",
          yaml: "application/yaml",
          yml: "application/yaml",
        } as Record<string, string>
      )[extension ?? ""] ?? "application/octet-stream"
    )
  }

  #joinPath(parent: string, name: string) {
    return parent ? `${parent}/${name}` : name
  }

  #encodeCursor(offset: number) {
    return Buffer.from(String(offset)).toString("base64url")
  }

  #decodeCursor(cursor: string) {
    const offset = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10)
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new WorkspaceFileError("INVALID_CURSOR", "Invalid cursor")
    return offset
  }

  #changed(threadId: string, change: WorkspaceFileChange) {
    const pending = this.#pendingChanges.get(threadId)
    if (pending) {
      pending.push(change)
      return
    }
    this.#pendingChanges.set(threadId, [change])
    queueMicrotask(() => {
      const changes = this.#pendingChanges.get(threadId)
      this.#pendingChanges.delete(threadId)
      if (!changes?.length) return
      this.#publish({
        payload: { changes, threadId },
        type: "thread.files.changed.notification",
      })
    })
  }
}
