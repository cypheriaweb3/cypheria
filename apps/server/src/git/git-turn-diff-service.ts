import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GitBranchReview } from "@cypheria/protocol"
import type { GitExecutor } from "./git-executor.js"

type Capture = {
  id: string
  threadId: string
  commonGitDir: string
  root: string
  beforeRef: string
}
type Saved = {
  version: 1
  threadId: string
  commonGitDir: string
  beforeRef: string
  afterRef: string
  turnId: string
}

const threadKey = (threadId: string) => createHash("sha256").update(threadId).digest("hex")
const refPattern = /^refs\/cypheria\/turn-diffs\/[a-f0-9]{64}\/[a-f0-9-]{36}-(before|after)$/u

export class GitTurnDiffService {
  readonly #executor: GitExecutor
  readonly #root: string
  readonly #captures = new Map<string, Capture>()

  constructor(executor: GitExecutor, cypheriaHome: string) {
    this.#executor = executor
    this.#root = join(cypheriaHome, "git-turn-diffs")
  }

  async start(threadId: string, root: string, commonGitDir: string): Promise<string> {
    const id = randomUUID()
    const beforeRef = `refs/cypheria/turn-diffs/${threadKey(threadId)}/${id}-before`
    const beforeTree = await this.#snapshot(root)
    await this.#executor.run(root, ["update-ref", beforeRef, beforeTree])
    this.#captures.set(id, { id, threadId, commonGitDir, root, beforeRef })
    return id
  }

  async complete(id: string, turnId: string): Promise<void> {
    const capture = this.#captures.get(id)
    if (!capture) return
    this.#captures.delete(id)
    const afterRef = `refs/cypheria/turn-diffs/${threadKey(capture.threadId)}/${id}-after`
    try {
      const afterTree = await this.#snapshot(capture.root)
      await this.#executor.run(capture.root, ["update-ref", afterRef, afterTree])
      await mkdir(this.#root, { recursive: true, mode: 0o700 })
      const path = this.#recordPath(capture.threadId)
      const previous = await this.#read(capture.threadId).catch(() => null)
      const saved: Saved = {
        version: 1,
        threadId: capture.threadId,
        commonGitDir: capture.commonGitDir,
        beforeRef: capture.beforeRef,
        afterRef,
        turnId,
      }
      const temporary = `${path}.${id}.tmp`
      await writeFile(temporary, JSON.stringify(saved), { mode: 0o600, flag: "wx" })
      await rename(temporary, path)
      if (previous?.commonGitDir === capture.commonGitDir) {
        await Promise.allSettled([
          this.#deleteRef(capture.root, previous.beforeRef),
          this.#deleteRef(capture.root, previous.afterRef),
        ])
      }
    } catch (error) {
      await Promise.allSettled([
        this.#deleteRef(capture.root, capture.beforeRef),
        this.#deleteRef(capture.root, afterRef),
      ])
      throw error
    }
  }

  async discard(id: string): Promise<void> {
    const capture = this.#captures.get(id)
    if (!capture) return
    this.#captures.delete(id)
    await this.#deleteRef(capture.root, capture.beforeRef)
  }

  async review(
    threadId: string,
    root: string,
    commonGitDir: string
  ): Promise<GitBranchReview | null> {
    const saved = await this.#read(threadId)
    if (!saved) return null
    if (saved.commonGitDir !== commonGitDir)
      throw new Error("Last turn belongs to another repository")
    const [base, head] = await Promise.all([
      this.#resolveRef(root, saved.beforeRef),
      this.#resolveRef(root, saved.afterRef),
    ])
    const { stdout } = await this.#executor.run(
      root,
      ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", base, head],
      { readOnly: true }
    )
    const values = stdout.split("\0")
    const entries: GitBranchReview["entries"][number][] = []
    for (let index = 0; index + 1 < values.length; index += 2) {
      const code = values[index]
      const path = values[index + 1]
      if (!code || !path) continue
      if (code !== "A" && code !== "M" && code !== "D" && code !== "T" && code !== "U")
        throw new Error(`Unexpected last-turn diff status: ${code}`)
      entries.push({ code, path })
    }
    return { base, head, entries }
  }

  async assertSnapshot(
    threadId: string,
    root: string,
    commonGitDir: string,
    base: string,
    head: string
  ): Promise<void> {
    const current = await this.review(threadId, root, commonGitDir)
    if (!current || current.base !== base || current.head !== head)
      throw new Error("Last-turn snapshot changed; refresh the review")
  }

  async #snapshot(root: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-turn-diff-"))
    const env = { GIT_INDEX_FILE: join(directory, "index") }
    try {
      await this.#executor.run(root, ["read-tree", "--empty"], { env })
      await this.#executor.run(root, ["add", "-A", "--", "."], { env, timeoutMs: 120_000 })
      return (await this.#executor.run(root, ["write-tree"], { env })).stdout.trim()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async #resolveRef(root: string, ref: string): Promise<string> {
    if (!refPattern.test(ref)) throw new Error("Invalid last-turn reference")
    return (
      await this.#executor.run(root, ["rev-parse", "--verify", ref], { readOnly: true })
    ).stdout.trim()
  }

  async #deleteRef(root: string, ref: string): Promise<void> {
    if (!refPattern.test(ref)) throw new Error("Invalid last-turn reference")
    await this.#executor.run(root, ["update-ref", "-d", ref])
  }

  #recordPath(threadId: string): string {
    return join(this.#root, `${threadKey(threadId)}.json`)
  }

  async #read(threadId: string): Promise<Saved | null> {
    const raw = await readFile(this.#recordPath(threadId), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null
        throw error
      }
    )
    if (raw === null) return null
    const saved = JSON.parse(raw) as Saved
    if (
      saved.version !== 1 ||
      saved.threadId !== threadId ||
      typeof saved.commonGitDir !== "string" ||
      !refPattern.test(saved.beforeRef) ||
      !refPattern.test(saved.afterRef) ||
      typeof saved.turnId !== "string"
    )
      throw new Error("Invalid last-turn record")
    return saved
  }
}
