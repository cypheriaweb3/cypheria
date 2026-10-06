import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"
import { promisify } from "node:util"

import type { GitExecutor } from "../git/git-executor.js"
import { CATALOG_FILES, type CatalogSource, isInside } from "./marketplace-catalog.js"

const execFileAsync = promisify(execFile)
const GITHUB = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/u
const REVISION_HASH_LENGTH = 12

/**
 * A revision's directory name: the manifest version, or `local` without a usable one, and the
 * first 12 hex digits of the SHA-256 of its files, such as `1.2.0-2a8ad9f74633`. The hash keeps
 * apart revisions whose files changed without a new version.
 */
export const revisionDirectory = (revision: { sha256: string; version: string | null }): string => {
  const version =
    revision.version && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u.test(revision.version)
      ? revision.version
      : "local"
  return `${version}-${revision.sha256.slice(0, REVISION_HASH_LENGTH)}`
}
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[A-Za-z0-9._^~<>=*-]+)?$/u

export type MarketplaceSource = {
  refName?: string | null
  source: string
  sparsePaths?: readonly string[] | null
}

/** Splits `owner/repo#ref` and expands GitHub shorthand into a clone URL. */
export const gitRemote = (
  source: string,
  refName?: string | null
): { ref: string | null; url: string } => {
  const [base = source, embedded] = source.split(/#(?=[^/]*$)/u)
  const ref = refName ?? embedded ?? null
  return { ref, url: GITHUB.test(base) ? `https://github.com/${base}.git` : base }
}

const isHostedJson = (source: string): boolean =>
  /^https?:\/\//iu.test(source) && /\.json(?:[?#].*)?$/iu.test(source)

const isLocal = (source: string): boolean =>
  source.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(source)

/**
 * A SHA-256 over the relative paths and contents of a plugin directory's files, without `.git`
 * and `node_modules`, so a refresh that leaves the files as they were keeps the same value.
 */
export const contentFingerprint = async (directory: string): Promise<string | null> => {
  const hash = createHash("sha256")
  const walk = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const child = join(path, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) {
        hash
          .update(relative(directory, child))
          .update("\0")
          .update(await readFile(child))
      }
    }
  }
  try {
    await walk(directory)
  } catch {
    return null
  }
  return hash.digest("hex")
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  )

/**
 * Owns `$CYPHERIA_HOME/marketplaces/`: Cypheria-owned marketplaces, the sources of plugins
 * their catalogs point to, and standalone packages. Only paths inside the root are written or
 * removed; a local directory the user names is referenced in place and never modified.
 */
export class MarketplaceStore {
  readonly root: string
  /**
   * Immutable copies of installed plugin revisions, laid out like Codex's plugin cache:
   * `cache/<marketplaceId>/<pluginName>/<version>-<sha256 prefix>/`.
   */
  readonly snapshotRoot: string
  readonly #git: Pick<GitExecutor, "run">
  readonly #fetch: typeof fetch
  readonly #npm: (args: string[], cwd: string) => Promise<string>

  constructor(options: {
    cypheriaHome: string
    fetch?: typeof fetch
    git: Pick<GitExecutor, "run">
    npm?: (args: string[], cwd: string) => Promise<string>
  }) {
    this.root = join(options.cypheriaHome, "marketplaces")
    this.snapshotRoot = join(options.cypheriaHome, "plugins", "cache")
    this.#git = options.git
    this.#fetch = options.fetch ?? fetch
    this.#npm =
      options.npm ??
      (async (args, cwd) => {
        const { stdout } = await execFileAsync("npm", args, {
          cwd,
          encoding: "utf8",
          env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
          maxBuffer: 16 * 1024 * 1024,
          timeout: 120_000,
          windowsHide: true,
        })
        return stdout
      })
  }

  directoryFor(marketplaceId: string): string {
    return join(this.root, marketplaceId)
  }

  /** Whether Cypheria wrote `path` and may replace or delete it. */
  owns(path: string): boolean {
    const target = resolve(path)
    return target !== this.root && isInside(this.root, target)
  }

  /**
   * Fetches a marketplace source into a staging directory and returns it. A local directory is
   * returned as is. Call `commit` once the catalog is checked, or `discard` to drop it.
   */
  async stage(input: MarketplaceSource): Promise<{ path: string; staged: boolean }> {
    if (isLocal(input.source)) {
      if (input.source.endsWith(".json")) {
        const staging = await this.#staging()
        await cp(input.source, join(staging, CATALOG_FILES.claude))
        return { path: staging, staged: true }
      }
      return { path: input.source, staged: false }
    }
    const staging = await this.#staging()
    try {
      if (isHostedJson(input.source)) {
        await this.#download(input.source, join(staging, CATALOG_FILES.claude))
      } else {
        await this.#clone(staging, input.source, input.refName, input.sparsePaths)
      }
      return { path: staging, staged: true }
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      throw error
    }
  }

  async commit(staging: string, marketplaceId: string): Promise<string> {
    const target = this.directoryFor(marketplaceId)
    await rm(target, { force: true, recursive: true })
    await rename(staging, target)
    return target
  }

  async discard(staging: { path: string; staged: boolean }): Promise<void> {
    if (staging.staged && this.owns(staging.path)) {
      await rm(staging.path, { force: true, recursive: true })
    }
  }

  /** Brings a Cypheria-owned marketplace directory up to date with its source. */
  async refresh(input: MarketplaceSource & { localPath: string }): Promise<void> {
    if (!this.owns(input.localPath)) return
    if (isHostedJson(input.source)) {
      await this.#download(input.source, join(input.localPath, CATALOG_FILES.claude))
      return
    }
    if (isLocal(input.source)) {
      await cp(input.source, join(input.localPath, CATALOG_FILES.claude))
      return
    }
    const { ref } = gitRemote(input.source, input.refName)
    await this.#git.run(input.localPath, ["fetch", "--depth", "1", "origin", ref ?? "HEAD"], {
      timeoutMs: 180_000,
    })
    await this.#git.run(input.localPath, ["reset", "--hard", "FETCH_HEAD"])
  }

  async remove(path: string): Promise<void> {
    if (this.owns(path)) await rm(path, { force: true, recursive: true })
  }

  /** Fetches a catalog entry whose files live outside its marketplace. */
  async fetchPluginSource(
    marketplaceId: string,
    pluginName: string,
    source: Exclude<CatalogSource, { kind: "local" }>
  ): Promise<string> {
    if (!PLUGIN_NAME.test(pluginName)) throw new Error(`Invalid plugin name ${pluginName}`)
    const target = join(this.root, ".sources", marketplaceId, pluginName)
    const staging = await this.#staging()
    try {
      const fetched =
        source.kind === "git"
          ? await this.#clone(staging, source.url, source.ref).then(() =>
              source.path ? join(staging, source.path) : staging
            )
          : await this.#npmPack(
              staging,
              source.version ? `${source.package}@${source.version}` : source.package
            )
      if (!isInside(staging, fetched)) throw new Error("The plugin path escapes its repository")
      await mkdir(dirname(target), { recursive: true })
      await rm(target, { force: true, recursive: true })
      await rename(fetched, target)
      return target
    } finally {
      await rm(staging, { force: true, recursive: true })
    }
  }

  /** Fetches or references a standalone package and returns its directory. */
  async fetchStandalone(input: {
    source: string
    sourceType: "git" | "local" | "npm"
  }): Promise<{ path: string; suggestedName: string }> {
    if (input.sourceType === "local") {
      const path = resolve(input.source)
      if (!isLocal(input.source)) throw new Error("Use an absolute path for a local package")
      if (
        !(await stat(path).then(
          (entry) => entry.isDirectory(),
          () => false
        ))
      ) {
        throw new Error(`${path} is not a directory`)
      }
      return { path, suggestedName: basename(path) }
    }
    const staging = await this.#staging()
    try {
      if (input.sourceType === "npm") {
        if (!NPM_NAME.test(input.source)) throw new Error("The npm package name is not valid")
        const path = await this.#npmPack(staging, input.source)
        const name = input.source.replace(/^@[^/]+\//u, "").replace(/@.*$/u, "")
        return { path: await this.#keepStandalone(path), suggestedName: name }
      }
      const { ref, url } = gitRemote(input.source)
      await this.#clone(staging, url, ref)
      const name = basename(url).replace(/\.git$/u, "")
      return { path: await this.#keepStandalone(staging), suggestedName: name }
    } finally {
      await rm(staging, { force: true, recursive: true })
    }
  }

  /** Moves a fetched package to `standalone-plugins/<name>` once its real name is known. */
  async renameStandalone(path: string, name: string): Promise<string> {
    if (!PLUGIN_NAME.test(name)) throw new Error(`Invalid plugin name ${name}`)
    const target = join(this.root, "standalone-plugins", name)
    if (!this.owns(path) || resolve(path) === target) return path
    await rm(target, { force: true, recursive: true })
    await rename(path, target)
    return target
  }

  async #keepStandalone(path: string): Promise<string> {
    const target = join(this.root, "standalone-plugins", `.incoming-${randomUUID()}`)
    await mkdir(dirname(target), { recursive: true })
    await rename(path, target)
    return target
  }

  async #staging(): Promise<string> {
    const path = join(this.root, `.staging-${randomUUID()}`)
    await mkdir(path, { recursive: true })
    return path
  }

  async #clone(
    target: string,
    source: string,
    refName?: string | null,
    sparsePaths?: readonly string[] | null
  ): Promise<void> {
    const { ref, url } = gitRemote(source, refName)
    if (url.startsWith("-")) throw new Error("Invalid repository URL")
    await this.#git.run(
      target,
      [
        "clone",
        "--depth",
        "1",
        ...(ref ? ["--branch", ref] : []),
        ...(sparsePaths?.length ? ["--filter=blob:none", "--sparse"] : []),
        "--",
        url,
        ".",
      ],
      { timeoutMs: 300_000 }
    )
    if (sparsePaths?.length) {
      await this.#git.run(target, ["sparse-checkout", "set", "--", ...sparsePaths])
    }
  }

  async #download(url: string, file: string): Promise<void> {
    const response = await this.#fetch(url, { redirect: "follow" })
    if (!response.ok) throw new Error(`Downloading ${url} failed with ${response.status}`)
    const text = await response.text()
    if (text.length > 8_000_000) throw new Error("The marketplace file is too large")
    JSON.parse(text)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
  }

  /** Downloads an npm package tarball and unpacks it; returns the package directory. */
  async #npmPack(directory: string, spec: string): Promise<string> {
    if (spec.startsWith("-")) throw new Error("Invalid npm package")
    const output = await this.#npm(["pack", "--json", "--ignore-scripts", "--", spec], directory)
    const [packed] = JSON.parse(output) as { filename: string }[]
    if (!packed?.filename) throw new Error(`npm did not pack ${spec}`)
    await execFileAsync(
      "tar",
      ["-xzf", join(directory, basename(packed.filename)), "-C", directory],
      {
        timeout: 60_000,
        windowsHide: true,
      }
    )
    const unpacked = join(directory, "package")
    if (!(await exists(unpacked))) throw new Error(`The ${spec} tarball has no package directory`)
    return unpacked
  }

  /** Removes staging directories left by an interrupted operation. */
  /**
   * The immutable copy of one revision of a plugin, which Agents that load a plugin from its
   * directory install from, so refreshing the marketplace never changes files they are using.
   */
  async snapshot(
    pluginId: string,
    source: string,
    revision: { sha256: string; version: string | null }
  ): Promise<string> {
    if (!PLUGIN_ID.test(pluginId) || !/^[a-f0-9]{64}$/u.test(revision.sha256)) {
      throw new Error(`Invalid plugin revision ${pluginId}`)
    }
    const target = join(this.#revisionsOf(pluginId), revisionDirectory(revision))
    if (await exists(target)) return target
    const staging = join(this.#revisionsOf(pluginId), `.staging-${randomUUID()}`)
    await mkdir(dirname(staging), { recursive: true })
    try {
      await cp(source, staging, {
        filter: (path) => basename(path) !== ".git",
        recursive: true,
        verbatimSymlinks: true,
      })
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      if (!(await exists(target))) throw error
    }
    return target
  }

  /**
   * Removes a plugin's revisions other than those whose SHA-256 is in `keep`, or all of them when
   * `keep` is empty.
   */
  async removeSnapshots(pluginId: string, keep: ReadonlySet<string>): Promise<void> {
    if (!PLUGIN_ID.test(pluginId)) return
    const directory = this.#revisionsOf(pluginId)
    const kept = new Set([...keep].map((sha256) => sha256.slice(0, REVISION_HASH_LENGTH)))
    const entries = await readdir(directory).catch(() => [] as string[])
    for (const entry of entries) {
      if (!kept.has(entry.slice(-REVISION_HASH_LENGTH))) {
        await rm(join(directory, entry), { force: true, recursive: true })
      }
    }
    if (!keep.size) await rm(directory, { force: true, recursive: true })
  }

  /** `<marketplaceId>/<pluginName>/` under the cache, for a plugin id `<pluginName>@<marketplaceId>`. */
  #revisionsOf(pluginId: string): string {
    const at = pluginId.lastIndexOf("@")
    return join(this.snapshotRoot, pluginId.slice(at + 1), pluginId.slice(0, at))
  }

  async cleanup(): Promise<void> {
    const entries = await readdir(this.root).catch(() => [] as string[])
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(".staging-"))
        .map((entry) => rm(join(this.root, entry), { force: true, recursive: true }))
    )
  }
}
