import { randomUUID } from "node:crypto"
import { constants, createWriteStream } from "node:fs"
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { pipeline } from "node:stream/promises"

type Record = {
  version: 1
  commonGitDir: string
  path: string
  kind: "file" | "symlink" | "missing"
  mode: number | null
  linkTarget: string | null
  beforeRevision: string
  afterRevision: string | null
}

const undoIdPattern = /^[a-f0-9-]{36}$/u

export class GitReviewUndoStore {
  readonly #root: string

  constructor(cypheriaHome: string) {
    this.#root = join(cypheriaHome, "git-review-undo")
  }

  async capture(commonGitDir: string, path: string, beforeRevision: string): Promise<string> {
    const id = randomUUID()
    const directory = join(this.#root, id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null
        throw error
      })
      const record: Record = {
        version: 1,
        commonGitDir,
        path,
        kind: info?.isSymbolicLink() ? "symlink" : info?.isFile() ? "file" : "missing",
        mode: info?.isFile() ? info.mode & 0o777 : null,
        linkTarget: info?.isSymbolicLink() ? await readlink(path) : null,
        beforeRevision,
        afterRevision: null,
      }
      if (info && !info.isFile() && !info.isSymbolicLink()) {
        throw new Error("Git review undo requires a file or symlink")
      }
      if (info?.isFile()) {
        const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          if (!(await source.stat()).isFile()) throw new Error("Git review file changed")
          await pipeline(
            source.createReadStream({ autoClose: false }),
            createWriteStream(join(directory, "content"), { flags: "wx", mode: 0o600 })
          )
        } finally {
          await source.close()
        }
      }
      await writeFile(join(directory, "record.json"), JSON.stringify(record), {
        mode: 0o600,
        flag: "wx",
      })
      return id
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async complete(id: string, afterRevision: string): Promise<void> {
    const record = await this.#read(id)
    const path = join(this.#directory(id), "record.json")
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ ...record, afterRevision }), {
      mode: 0o600,
      flag: "wx",
    })
    await rename(temporary, path)
  }

  async discard(id: string): Promise<void> {
    await rm(this.#directory(id), { recursive: true, force: true })
  }

  async read(id: string): Promise<Readonly<Record>> {
    return this.#read(id)
  }

  async restore(id: string, commonGitDir: string, currentRevision: string): Promise<string> {
    const record = await this.#read(id)
    if (record.commonGitDir !== commonGitDir)
      throw new Error("Git review undo belongs to another repository")
    if (!record.afterRevision || record.afterRevision !== currentRevision) {
      throw new Error("File changed after revert; undo is unavailable")
    }
    const target = record.path
    const current = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (current && !current.isFile() && !current.isSymbolicLink()) {
      throw new Error("Git review undo target is no longer a file")
    }
    if (record.kind === "missing") {
      await rm(target, { force: true })
    } else {
      const temporary = join(dirname(target), `.cypheria-review-undo-${id}.tmp`)
      try {
        if (record.kind === "file") {
          await copyFile(join(this.#directory(id), "content"), temporary, constants.COPYFILE_EXCL)
          await chmod(temporary, record.mode ?? 0o600)
        } else {
          if (record.linkTarget === null) throw new Error("Git review undo link is invalid")
          await symlink(record.linkTarget, temporary)
        }
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    await this.discard(id)
    return target
  }

  #directory(id: string): string {
    if (!undoIdPattern.test(id)) throw new Error("Invalid Git review undo ID")
    return resolve(this.#root, id)
  }

  async #read(id: string): Promise<Record> {
    const record = JSON.parse(
      await readFile(join(this.#directory(id), "record.json"), "utf8")
    ) as Record
    if (
      record.version !== 1 ||
      typeof record.commonGitDir !== "string" ||
      typeof record.path !== "string" ||
      !["file", "symlink", "missing"].includes(record.kind) ||
      typeof record.beforeRevision !== "string" ||
      (record.afterRevision !== null && typeof record.afterRevision !== "string")
    ) {
      throw new Error("Invalid Git review undo record")
    }
    return record
  }
}
