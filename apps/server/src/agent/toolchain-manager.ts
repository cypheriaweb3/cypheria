import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { arch, platform } from "node:os"
import { basename, dirname, join, sep } from "node:path"
import type { ToolchainId, ToolchainView } from "@cypheria/protocol"
import extractZip from "extract-zip"
import { extract as extractTar } from "tar"

import { downloadBytes, readJsonFile, sha256, writeJsonAtomic } from "./fs-utils.js"

type ToolchainRecord = {
  activeVersion: string | null
  availableVersion: string | null
  error: string | null
  executable: string | null
  installedVersions: string[]
  state: ToolchainView["state"]
}

type ToolchainManifest = {
  schemaVersion: 1
  toolchains: Record<ToolchainId, ToolchainRecord>
}

export type PythonEnvironmentManifest = {
  dedicated?: boolean
  indexes?: readonly string[]
  package: string
  pythonVersion: string
  requirements: readonly string[]
  uvVersion: string
}

const emptyRecord = (): ToolchainRecord => ({
  activeVersion: null,
  availableVersion: null,
  error: null,
  executable: null,
  installedVersions: [],
  state: "missing",
})

const emptyManifest = (): ToolchainManifest => ({
  schemaVersion: 1,
  toolchains: { node: emptyRecord(), python: emptyRecord(), uv: emptyRecord() },
})

const executableName = (name: string): string => (platform() === "win32" ? `${name}.exe` : name)

const run = async (
  executable: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8").trim())
      else
        reject(
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              `${basename(executable)} exited with ${code}`
          )
        )
    })
  })

const uvTarget = (): string => {
  const key = `${platform()}-${arch()}`
  const targets: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "win32-x64": "x86_64-pc-windows-msvc",
  }
  const target = targets[key]
  if (!target) throw new Error(`Unsupported uv platform: ${key}`)
  return target
}

const nodeTarget = (): { archive: string; directory: string } => {
  const architecture = arch() === "arm64" ? "arm64" : arch() === "x64" ? "x64" : undefined
  if (!architecture) throw new Error(`Unsupported Node architecture: ${arch()}`)
  if (platform() === "win32")
    return { archive: `win-${architecture}.zip`, directory: `win-${architecture}` }
  if (platform() === "darwin")
    return { archive: `darwin-${architecture}.tar.gz`, directory: `darwin-${architecture}` }
  if (platform() === "linux")
    return { archive: `linux-${architecture}.tar.gz`, directory: `linux-${architecture}` }
  throw new Error(`Unsupported Node platform: ${platform()}`)
}

const safeArchiveEntry = (entry: string): boolean => {
  const normalized = entry.replaceAll("\\", "/")
  return !normalized.startsWith("/") && !normalized.split("/").includes("..")
}

const extractArchive = async (archivePath: string, destination: string): Promise<void> => {
  await mkdir(destination, { recursive: true })
  if (archivePath.endsWith(".zip")) {
    await extractZip(archivePath, { dir: destination })
    return
  }
  await extractTar({
    cwd: destination,
    file: archivePath,
    filter: safeArchiveEntry,
    preservePaths: false,
  })
}

const findExecutable = async (root: string, name: string): Promise<string> => {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const found = await findExecutable(path, name).catch(() => undefined)
      if (found) return found
    }
  }
  throw new Error(`Archive does not contain ${name}`)
}

export type ToolchainManagerOptions = {
  cacheDir: string
  cypheriaHome: string
  fetchImpl?: typeof fetch
}

export class ToolchainManager {
  readonly #cacheDir: string
  readonly #cacheRoot: string
  readonly #currentPath: string
  readonly #fetch: typeof fetch
  readonly #home: string
  readonly #manifestPath: string
  readonly #locks = new Map<string, Promise<unknown>>()
  readonly #leases = new Map<string, number>()
  #manifest = emptyManifest()
  #updateCheckTimer: NodeJS.Timeout | undefined

  constructor(options: ToolchainManagerOptions) {
    this.#cacheRoot = options.cacheDir
    this.#cacheDir = join(options.cacheDir, "toolchains")
    this.#fetch = options.fetchImpl ?? fetch
    this.#home = join(options.cypheriaHome, "toolchains")
    this.#currentPath = join(this.#home, "current.json")
    this.#manifestPath = join(this.#home, "manifest.json")
  }

  async start(): Promise<void> {
    await mkdir(this.#home, { recursive: true })
    await Promise.all([
      rm(join(this.#home, "staging"), { force: true, recursive: true }),
      rm(this.#cacheDir, { force: true, recursive: true }),
    ])
    await Promise.all([
      mkdir(join(this.#home, "staging"), { recursive: true }),
      mkdir(this.#cacheDir, { recursive: true }),
    ])
    this.#manifest = (await readJsonFile<ToolchainManifest>(this.#manifestPath)) ?? emptyManifest()
  }

  startAutomaticUpdateChecks(intervalMs = 60 * 60 * 1_000): void {
    if (this.#updateCheckTimer) return
    this.#updateCheckTimer = setInterval(() => {
      void this.checkUpdates().catch(() => {
        // A failed background check must not disturb installed toolchains. The next
        // interval, or an explicit protocol request, will retry it.
      })
    }, intervalMs)
    this.#updateCheckTimer.unref()
  }

  stop(): void {
    if (this.#updateCheckTimer) clearInterval(this.#updateCheckTimer)
    this.#updateCheckTimer = undefined
  }

  list(): ToolchainView[] {
    return (["node", "python", "uv"] as const).map((id) => {
      const record = this.#manifest.toolchains[id]
      return {
        activeVersion: record.activeVersion,
        availableVersion: record.availableVersion,
        error: record.error,
        id,
        installedVersions: [...record.installedVersions],
        state: record.state,
        updateAvailable: Boolean(
          record.availableVersion && record.availableVersion !== record.activeVersion
        ),
      }
    })
  }

  executable(id: ToolchainId): string | undefined {
    return this.#manifest.toolchains[id].executable ?? undefined
  }

  async bootstrapMissing(): Promise<void> {
    for (const id of ["uv", "node", "python"] as const) {
      if (!this.executable(id)) await this.update(id)
    }
  }

  async checkUpdates(): Promise<ToolchainView[]> {
    const [nodeVersion, uvVersion] = await Promise.all([
      this.#latestNodeVersion(),
      this.#latestUvVersion(),
    ])
    this.#manifest.toolchains.node.availableVersion = nodeVersion
    this.#manifest.toolchains.uv.availableVersion = uvVersion
    const uv = this.executable("uv")
    if (uv) {
      const output = await run(
        uv,
        ["python", "list", "--managed-python", "--all-versions", "--output-format", "json"],
        { env: this.environment() }
      )
      const versions = JSON.parse(output) as { version?: string }[]
      this.#manifest.toolchains.python.availableVersion =
        versions.find(({ version }) => version && !version.includes("-"))?.version ?? null
    }
    await this.#save()
    return this.list()
  }

  async update(id: ToolchainId): Promise<ToolchainView> {
    return this.#serialize(`toolchain:${id}`, async () => {
      const record = this.#manifest.toolchains[id]
      record.state = "updating"
      record.error = null
      await this.#save()
      try {
        if (id === "node") await this.#installNode()
        else if (id === "uv") await this.#installUv()
        else await this.#installPython()
        record.state = "ready"
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error)
        record.state = "errored"
        throw error
      } finally {
        await this.#save()
      }
      return this.list().find((item) => item.id === id) as ToolchainView
    })
  }

  environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const node = this.executable("node")
    const python = this.executable("python")
    const uv = this.executable("uv")
    const paths = [node && dirname(node), python && dirname(python), uv && dirname(uv)].filter(
      Boolean
    )
    return {
      ...process.env,
      ...extra,
      COREPACK_HOME: join(this.#cacheRoot, "corepack"),
      PATH: [...(paths as string[]), process.env.PATH ?? ""].join(sep),
      UV_CACHE_DIR: join(this.#cacheRoot, "uv"),
      UV_MANAGED_PYTHON: "1",
      UV_PYTHON_DOWNLOADS: "manual",
      UV_PYTHON_INSTALL_DIR: join(this.#home, "python", "versions"),
      UV_TOOL_BIN_DIR: join(this.#home, "python", "bin"),
      UV_TOOL_DIR: join(this.#home, "python", "tools"),
      npm_config_cache: join(this.#cacheRoot, "npm"),
      npm_config_prefix: join(this.#home, "node", "prefix"),
    }
  }

  async createPythonEnvironment(
    manifest: PythonEnvironmentManifest
  ): Promise<{ fingerprint: string; path: string }> {
    const uv = this.executable("uv")
    const python = this.executable("python")
    if (!uv || !python) throw new Error("Managed uv and Python are required")
    const resolver = join(this.#home, "staging", `python-lock-${randomUUID()}`)
    const inputPath = join(resolver, "requirements.in")
    const lockPath = join(resolver, "requirements.lock")
    await mkdir(resolver, { recursive: true })
    await writeFile(inputPath, `${[...manifest.requirements].sort().join("\n")}\n`)
    try {
      await run(
        uv,
        [
          "pip",
          "compile",
          "--python",
          python,
          "--generate-hashes",
          "--no-header",
          "--output-file",
          lockPath,
          ...(manifest.indexes?.flatMap((index) => ["--index", index]) ?? []),
          inputPath,
        ],
        { env: this.environment() }
      )
      const lockedRequirements = (await readFile(lockPath, "utf8")).trim()
      const pythonBuild = await run(
        python,
        [
          "-c",
          "import platform,sys;print(sys.implementation.cache_tag+'|'+platform.python_build()[0])",
        ],
        { env: this.environment() }
      )
      const canonical = JSON.stringify({
        dedicated: manifest.dedicated ?? false,
        indexes: [...(manifest.indexes ?? [])].sort(),
        lockedRequirements,
        package: manifest.dedicated ? manifest.package : undefined,
        platform: `${platform()}-${arch()}`,
        pythonBuild,
        pythonVersion: manifest.pythonVersion,
        uvVersion: manifest.uvVersion,
      })
      const fingerprint = sha256(canonical)
      const destination = join(this.#home, "python-envs", fingerprint)
      if (
        await stat(destination).then(
          () => true,
          () => false
        )
      )
        return { fingerprint, path: destination }
      return await this.#serialize(`python-env:${fingerprint}`, async () => {
        if (
          await stat(destination).then(
            () => true,
            () => false
          )
        )
          return { fingerprint, path: destination }
        const staging = join(this.#home, "staging", `python-env-${randomUUID()}`)
        const requirementsPath = join(staging, "requirements.lock")
        await mkdir(staging, { recursive: true })
        await writeFile(requirementsPath, `${lockedRequirements}\n`)
        try {
          await run(uv, ["venv", "--python", python, join(staging, "venv")], {
            env: this.environment(),
          })
          await run(
            uv,
            [
              "pip",
              "sync",
              "--require-hashes",
              "--python",
              join(staging, "venv", platform() === "win32" ? "Scripts/python.exe" : "bin/python"),
              requirementsPath,
              ...(manifest.indexes?.flatMap((index) => ["--index", index]) ?? []),
            ],
            { env: this.environment() }
          )
          await writeJsonAtomic(join(staging, "environment.json"), {
            ...manifest,
            fingerprint,
            lockedRequirements,
            platform: `${platform()}-${arch()}`,
            pythonBuild,
          })
          await mkdir(dirname(destination), { recursive: true })
          await rename(staging, destination)
          await this.#makeImmutable(destination)
        } catch (error) {
          await rm(staging, { force: true, recursive: true })
          throw error
        }
        return { fingerprint, path: destination }
      })
    } finally {
      await rm(resolver, { force: true, recursive: true })
    }
  }

  acquireEnvironment(fingerprint: string): () => void {
    this.#leases.set(fingerprint, (this.#leases.get(fingerprint) ?? 0) + 1)
    return () => {
      const next = (this.#leases.get(fingerprint) ?? 1) - 1
      if (next > 0) this.#leases.set(fingerprint, next)
      else this.#leases.delete(fingerprint)
    }
  }

  async garbageCollectPythonEnvironments(
    referencedFingerprints: ReadonlySet<string>,
    retentionMs = 7 * 24 * 60 * 60 * 1_000
  ): Promise<string[]> {
    const root = join(this.#home, "python-envs")
    const entries = await readdir(root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return []
        throw error
      }
    )
    const removed: string[] = []
    const cutoff = Date.now() - retentionMs
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fingerprint = entry.name
      if (referencedFingerprints.has(fingerprint) || this.#leases.has(fingerprint)) continue
      const path = join(root, fingerprint)
      const metadata = await stat(path)
      if (metadata.mtimeMs > cutoff) continue
      await this.#makeWritable(path)
      await rm(path, { force: true, recursive: true })
      removed.push(fingerprint)
    }
    return removed
  }

  async #installNode(): Promise<void> {
    const version = await this.#latestNodeVersion()
    const target = nodeTarget()
    const extension = target.archive.endsWith(".zip") ? ".zip" : ".tar.gz"
    const archiveName = `node-v${version}-${target.archive}`
    const baseUrl = `https://nodejs.org/dist/v${version}`
    const [archive, sumsResponse] = await Promise.all([
      downloadBytes(`${baseUrl}/${archiveName}`),
      this.#fetch(`${baseUrl}/SHASUMS256.txt`, { signal: AbortSignal.timeout(20_000) }),
    ])
    if (!sumsResponse.ok) throw new Error("Unable to download Node checksums")
    const expected = (await sumsResponse.text())
      .split("\n")
      .find((line) => line.endsWith(`  ${archiveName}`))
      ?.split(/\s+/)[0]
    if (!expected || sha256(archive) !== expected) throw new Error("Node archive checksum mismatch")
    const staging = join(this.#home, "staging", `node-${randomUUID()}`)
    const archivePath = join(this.#cacheDir, `${randomUUID()}${extension}`)
    await mkdir(staging, { recursive: true })
    await writeFile(archivePath, archive)
    try {
      await extractArchive(archivePath, staging)
      const root = join(staging, `node-v${version}-${target.directory}`)
      const destination = join(this.#home, "node", "versions", version)
      await mkdir(dirname(destination), { recursive: true })
      await rm(destination, { force: true, recursive: true })
      await rename(root, destination)
      await rm(staging, { force: true, recursive: true })
      const executable = join(destination, platform() === "win32" ? "node.exe" : "bin/node")
      this.#activate("node", version, executable)
    } finally {
      await rm(archivePath, { force: true })
    }
  }

  async #installUv(): Promise<void> {
    const response = await this.#fetch(
      "https://api.github.com/repos/astral-sh/uv/releases/latest",
      {
        headers: { accept: "application/vnd.github+json", "user-agent": "cypheria" },
        signal: AbortSignal.timeout(20_000),
      }
    )
    if (!response.ok) throw new Error(`Unable to resolve uv release: HTTP ${response.status}`)
    const release = (await response.json()) as {
      assets: { browser_download_url: string; name: string }[]
      tag_name: string
    }
    const version = release.tag_name.replace(/^v/, "")
    const target = uvTarget()
    const suffix = platform() === "win32" ? ".zip" : ".tar.gz"
    const asset = release.assets.find(({ name }) => name === `uv-${target}${suffix}`)
    if (!asset) throw new Error(`uv release does not support ${target}`)
    const checksumAsset = release.assets.find(({ name }) => name === `${asset.name}.sha256`)
    if (!checksumAsset) throw new Error(`uv release does not publish a checksum for ${asset.name}`)
    const [archive, checksumBytes] = await Promise.all([
      downloadBytes(asset.browser_download_url),
      downloadBytes(checksumAsset.browser_download_url),
    ])
    const expected = Buffer.from(checksumBytes).toString("utf8").trim().split(/\s+/, 1)[0]
    if (
      !expected ||
      !/^[a-fA-F0-9]{64}$/.test(expected) ||
      sha256(archive) !== expected.toLowerCase()
    ) {
      throw new Error("uv archive checksum mismatch")
    }
    const archivePath = join(this.#cacheDir, `${randomUUID()}${suffix}`)
    const staging = join(this.#home, "staging", `uv-${randomUUID()}`)
    await mkdir(staging, { recursive: true })
    await writeFile(archivePath, archive)
    try {
      await extractArchive(archivePath, staging)
      const source = await findExecutable(staging, executableName("uv"))
      const destination = join(this.#home, "uv", "versions", version)
      await mkdir(destination, { recursive: true })
      const executable = join(destination, executableName("uv"))
      await cp(source, executable)
      await chmod(executable, 0o755)
      this.#activate("uv", version, executable)
    } finally {
      await Promise.all([
        rm(archivePath, { force: true }),
        rm(staging, { force: true, recursive: true }),
      ])
    }
  }

  async #installPython(): Promise<void> {
    const uv = this.executable("uv")
    if (!uv) throw new Error("Managed uv must be installed before Python")
    const installDir = join(this.#home, "python", "versions")
    const env = this.environment({ UV_PYTHON_DOWNLOADS: "automatic" })
    await run(uv, ["python", "install", "--managed-python", "--install-dir", installDir], {
      cwd: this.#home,
      env,
    })
    const executable = await run(uv, ["python", "find", "--managed-python"], {
      cwd: this.#home,
      env,
    })
    const version = (await run(executable, ["--version"], { env })).replace(/^Python\s+/, "")
    this.#activate("python", version, executable)
  }

  async #latestNodeVersion(): Promise<string> {
    const response = await this.#fetch("https://nodejs.org/dist/index.json", {
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`Unable to resolve Node releases: HTTP ${response.status}`)
    const releases = (await response.json()) as { lts: boolean | string; version: string }[]
    const release = releases.find(({ lts, version }) => Boolean(lts) && !version.includes("-"))
    if (!release) throw new Error("No stable Node LTS release is available")
    return release.version.replace(/^v/, "")
  }

  async #latestUvVersion(): Promise<string> {
    const response = await this.#fetch(
      "https://api.github.com/repos/astral-sh/uv/releases/latest",
      {
        headers: { accept: "application/vnd.github+json", "user-agent": "cypheria" },
        signal: AbortSignal.timeout(20_000),
      }
    )
    if (!response.ok) throw new Error(`Unable to resolve uv release: HTTP ${response.status}`)
    return ((await response.json()) as { tag_name: string }).tag_name.replace(/^v/, "")
  }

  #activate(id: ToolchainId, version: string, executable: string): void {
    const record = this.#manifest.toolchains[id]
    record.activeVersion = version
    record.availableVersion = version
    record.executable = executable
    record.installedVersions = [...new Set([...record.installedVersions, version])].sort()
    record.error = null
  }

  async #save(): Promise<void> {
    await Promise.all([
      writeJsonAtomic(this.#manifestPath, this.#manifest),
      writeJsonAtomic(
        this.#currentPath,
        Object.fromEntries(
          Object.entries(this.#manifest.toolchains).map(([id, record]) => [
            id,
            {
              executable: record.executable,
              version: record.activeVersion,
            },
          ])
        )
      ),
    ])
  }

  async #serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.#locks.set(key, next)
    try {
      return await next
    } finally {
      if (this.#locks.get(key) === next) this.#locks.delete(key)
    }
  }

  async #makeImmutable(root: string): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) {
          await this.#makeImmutable(path)
          await chmod(path, 0o555)
        } else if (entry.isFile()) {
          const current = await stat(path)
          await chmod(path, current.mode & 0o111 ? 0o555 : 0o444)
        }
      })
    )
    await chmod(root, 0o555)
  }

  async #makeWritable(root: string): Promise<void> {
    await chmod(root, 0o755).catch(() => undefined)
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) await this.#makeWritable(path)
        else if (entry.isFile()) await chmod(path, 0o644).catch(() => undefined)
      })
    )
  }
}
