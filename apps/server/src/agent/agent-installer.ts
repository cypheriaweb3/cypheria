import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { arch, platform } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import type {
  AgentDistribution,
  AgentId,
  AgentRegistryEntry,
  AgentRegistryPlatform,
} from "@cypheria/protocol"
import extractZip from "extract-zip"
import { extract as extractTar } from "tar"

import { downloadBytes, sha256, writeJsonAtomic } from "./fs-utils.js"
import { NATIVE_AGENT_MANIFEST } from "./native-agent-manifest.js"
import type { ToolchainManager } from "./toolchain-manager.js"

export type AgentInstallReceipt = {
  agentId: AgentId
  args: string[]
  command: string
  environment?: Record<string, string>
  environmentFingerprint?: string
  installedAt: string
  integrity: "verified" | "unverified" | "not-applicable"
  kind: "binary" | "npx" | "uvx"
  source: string
  version: string
}

const registryPlatform = (): AgentRegistryPlatform => {
  const os = platform() === "win32" ? "windows" : platform()
  const cpu = arch() === "arm64" ? "aarch64" : arch() === "x64" ? "x86_64" : arch()
  return `${os}-${cpu}` as AgentRegistryPlatform
}

const splitNpmSpec = (spec: string): { name: string; version: string | undefined } => {
  const index = spec.lastIndexOf("@")
  if (index > 0) return { name: spec.slice(0, index), version: spec.slice(index + 1) }
  return { name: spec, version: undefined }
}

const toPythonRequirement = (spec: string): string => {
  const match = /^(.*)@([^@]+)$/.exec(spec)
  return match ? `${match[1]}==${match[2]}` : spec
}

const packageCommand = (spec: string): string =>
  toPythonRequirement(spec)
    .split(/[=[<>=!~]/, 1)[0]
    ?.replace(/^.*\//, "") ?? spec

const run = async (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error("Agent installation was interrupted"))
      return
    }
    const child = spawn(command, [...args], {
      detached: platform() !== "win32",
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stderr: Buffer[] = []
    let aborted = false
    let forceKill: NodeJS.Timeout | undefined
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (forceKill) clearTimeout(forceKill)
      signal?.removeEventListener("abort", abort)
      if (error) reject(error)
      else resolvePromise()
    }
    const abort = (): void => {
      aborted = true
      if (child.pid && platform() !== "win32") {
        try {
          process.kill(-child.pid, "SIGTERM")
        } catch {
          child.kill("SIGTERM")
        }
      } else child.kill("SIGTERM")
      forceKill = setTimeout(() => {
        if (child.pid && platform() !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            child.kill("SIGKILL")
          }
        } else child.kill("SIGKILL")
      }, 2_000)
      forceKill.unref()
    }
    signal?.addEventListener("abort", abort, { once: true })
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", (error) => finish(error))
    child.once("exit", (code) =>
      aborted
        ? finish(new Error("Agent installation was interrupted"))
        : code === 0
          ? finish()
          : finish(
              new Error(
                Buffer.concat(stderr).toString("utf8").slice(-8_192) ||
                  `${command} exited with ${code}`
              )
            )
    )
  })

const extract = async (archive: string, destination: string): Promise<void> => {
  await mkdir(destination, { recursive: true })
  if (archive.endsWith(".zip")) await extractZip(archive, { dir: destination })
  else if (/\.(?:tar\.gz|tgz|tar\.bz2|tbz2)$/.test(archive)) {
    await extractTar({
      cwd: destination,
      file: archive,
      filter: (path) => !path.replaceAll("\\", "/").split("/").includes(".."),
      preservePaths: false,
    })
  } else {
    throw new Error(`Unsupported archive format: ${archive}`)
  }
}

export class AgentInstaller {
  readonly #agentsHome: string
  readonly #cacheDir: string
  readonly #toolchains: ToolchainManager

  constructor(options: { cacheDir: string; cypheriaHome: string; toolchains: ToolchainManager }) {
    this.#agentsHome = join(options.cypheriaHome, "agents")
    this.#cacheDir = join(options.cacheDir, "agents")
    this.#toolchains = options.toolchains
  }

  async cleanupInterrupted(): Promise<void> {
    await mkdir(this.#agentsHome, { recursive: true })
    await rm(this.#cacheDir, { force: true, recursive: true })
    await mkdir(this.#cacheDir, { recursive: true })
    const agents = await readdir(this.#agentsHome, { withFileTypes: true })
    await Promise.all(
      agents
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.#cleanupAgentRoot(join(this.#agentsHome, entry.name)))
    )
  }

  async install(
    agentId: AgentId,
    entry?: AgentRegistryEntry,
    options: { onProgress?: (value: number) => void; signal?: AbortSignal } = {}
  ): Promise<AgentInstallReceipt> {
    await mkdir(this.#agentsHome, { recursive: true })
    const native = Object.hasOwn(NATIVE_AGENT_MANIFEST, agentId)
      ? NATIVE_AGENT_MANIFEST[agentId as keyof typeof NATIVE_AGENT_MANIFEST]
      : undefined
    if (native)
      return this.#installNpx(
        agentId,
        native.cliVersion,
        `${native.cliPackage}@${native.cliVersion}`,
        [],
        undefined,
        native.launcher,
        options
      )
    if (!entry) throw new Error(`No installation descriptor is available for ${agentId}`)
    const binary = entry.distribution.binary?.[registryPlatform()]
    if (binary) return this.#installBinary(agentId, entry.version, binary, options)
    if (entry.distribution.npx)
      return this.#installNpx(
        agentId,
        entry.version,
        entry.distribution.npx.package,
        entry.distribution.npx.args,
        entry.distribution.npx.env,
        "node",
        options
      )
    if (entry.distribution.uvx)
      return this.#installUvx(
        agentId,
        entry.version,
        entry.distribution.uvx.package,
        entry.distribution.uvx.args,
        entry.distribution.uvx.env,
        options
      )
    throw new Error(`Agent ${agentId} has no distribution for ${registryPlatform()}`)
  }

  async uninstall(agentId: AgentId): Promise<void> {
    const root = join(this.#agentsHome, agentId)
    await Promise.all([
      rm(join(root, "versions"), { force: true, recursive: true }),
      rm(join(root, "staging"), { force: true, recursive: true }),
      rm(join(root, "receipts"), { force: true, recursive: true }),
      rm(join(root, "current.json"), { force: true }),
    ])
  }

  async readCurrent(agentId: AgentId): Promise<AgentInstallReceipt | undefined> {
    try {
      return JSON.parse(
        await readFile(join(this.#agentsHome, agentId, "current.json"), "utf8")
      ) as AgentInstallReceipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  async readReceipts(agentId: AgentId): Promise<AgentInstallReceipt[]> {
    const root = join(this.#agentsHome, agentId, "receipts")
    const files = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    return Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(
          async (file) =>
            JSON.parse(await readFile(join(root, file), "utf8")) as AgentInstallReceipt
        )
    )
  }

  async #installNpx(
    agentId: AgentId,
    version: string,
    packageSpec: string,
    args: readonly string[] = [],
    environment?: Record<string, string>,
    launcher: "executable" | "node" = "node",
    options: { onProgress?: (value: number) => void; signal?: AbortSignal } = {}
  ): Promise<AgentInstallReceipt> {
    options.signal?.throwIfAborted()
    options.onProgress?.(0.05)
    let node = this.#toolchains.executable("node")
    if (!node) {
      await this.#toolchains.update("node")
      node = this.#toolchains.executable("node")
    }
    if (!node) throw new Error("Managed Node.js is unavailable")
    options.signal?.throwIfAborted()
    options.onProgress?.(0.2)
    const npm = join(dirname(node), platform() === "win32" ? "npm.cmd" : "npm")
    const staging = join(this.#agentsHome, agentId, "staging", randomUUID())
    await mkdir(staging, { recursive: true })
    try {
      await run(
        npm,
        ["install", "--prefix", staging, "--no-audit", "--no-fund", "--no-save", packageSpec],
        this.#toolchains.environment(),
        options.signal
      )
      options.onProgress?.(0.72)
      const parsed = splitNpmSpec(packageSpec)
      const packageJsonPath = join(
        staging,
        "node_modules",
        ...parsed.name.split("/"),
        "package.json"
      )
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
        bin?: string | Record<string, string>
      }
      const bin =
        typeof packageJson.bin === "string"
          ? packageJson.bin
          : Object.values(packageJson.bin ?? {})[0]
      if (!bin) throw new Error(`${packageSpec} does not expose an executable`)
      const destination = join(this.#agentsHome, agentId, "versions", version)
      await mkdir(dirname(destination), { recursive: true })
      await rm(destination, { force: true, recursive: true })
      await rename(staging, destination)
      const receipt: AgentInstallReceipt = {
        agentId,
        args: [...args],
        command: node,
        ...(environment ? { environment } : {}),
        installedAt: new Date().toISOString(),
        integrity: "not-applicable",
        kind: "npx",
        source: packageSpec,
        version,
      }
      const executable = join(destination, "node_modules", ...parsed.name.split("/"), bin)
      if (launcher === "executable") {
        if (platform() !== "win32") await chmod(executable, 0o755)
        receipt.command = executable
      } else {
        receipt.args = [executable, ...receipt.args]
      }
      await this.#activate(receipt)
      options.onProgress?.(1)
      return receipt
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      await this.#cleanupAgentRoot(join(this.#agentsHome, agentId))
      throw error
    }
  }

  async #installUvx(
    agentId: AgentId,
    version: string,
    packageSpec: string,
    args: readonly string[] = [],
    environment?: Record<string, string>,
    options: { onProgress?: (value: number) => void; signal?: AbortSignal } = {}
  ): Promise<AgentInstallReceipt> {
    options.signal?.throwIfAborted()
    options.onProgress?.(0.05)
    for (const toolchain of ["uv", "python"] as const) {
      if (!this.#toolchains.executable(toolchain)) await this.#toolchains.update(toolchain)
    }
    const pythonVersion =
      this.#toolchains.list().find(({ id }) => id === "python")?.activeVersion ?? "unknown"
    const uvVersion =
      this.#toolchains.list().find(({ id }) => id === "uv")?.activeVersion ?? "unknown"
    const pythonEnvironment = await this.#toolchains.createPythonEnvironment({
      package: packageSpec,
      pythonVersion,
      requirements: [toPythonRequirement(packageSpec)],
      uvVersion,
    })
    options.signal?.throwIfAborted()
    options.onProgress?.(0.85)
    const executable = join(
      pythonEnvironment.path,
      "venv",
      platform() === "win32" ? "Scripts" : "bin",
      executableName(packageCommand(packageSpec))
    )
    const receipt: AgentInstallReceipt = {
      agentId,
      args: [...args],
      command: executable,
      ...(environment ? { environment } : {}),
      environmentFingerprint: pythonEnvironment.fingerprint,
      installedAt: new Date().toISOString(),
      integrity: "not-applicable",
      kind: "uvx",
      source: packageSpec,
      version,
    }
    try {
      await this.#activate(receipt)
      options.onProgress?.(1)
      return receipt
    } catch (error) {
      await this.#cleanupAgentRoot(join(this.#agentsHome, agentId))
      throw error
    }
  }

  async #installBinary(
    agentId: AgentId,
    version: string,
    distribution: NonNullable<AgentDistribution["binary"]>[AgentRegistryPlatform],
    options: { onProgress?: (value: number) => void; signal?: AbortSignal } = {}
  ): Promise<AgentInstallReceipt> {
    if (!distribution) throw new Error("Binary distribution is missing")
    options.signal?.throwIfAborted()
    options.onProgress?.(0.05)
    const bytes = await downloadBytes(distribution.archive, { signal: options.signal })
    options.onProgress?.(0.5)
    if (distribution.sha256 && sha256(bytes).toLowerCase() !== distribution.sha256.toLowerCase()) {
      throw new Error("Agent archive checksum mismatch")
    }
    const staging = join(this.#agentsHome, agentId, "staging", randomUUID())
    const extension = distribution.archive.match(/(\.tar\.gz|\.tar\.bz2|\.tgz|\.tbz2|\.zip)$/)?.[1]
    const archivePath = join(this.#cacheDir, `${randomUUID()}${extension ?? ".raw"}`)
    await mkdir(dirname(archivePath), { recursive: true })
    await mkdir(staging, { recursive: true })
    await writeFile(archivePath, bytes)
    try {
      if (extension) await extract(archivePath, staging)
      else {
        const commandName = distribution.cmd.replace(/^\.\//, "")
        const target = resolve(staging, commandName)
        if (!target.startsWith(`${resolve(staging)}${sep}`))
          throw new Error("Binary command escapes install directory")
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, bytes, { mode: 0o755 })
      }
      options.signal?.throwIfAborted()
      options.onProgress?.(0.75)
      const relativeCommand = distribution.cmd.replace(/^\.\//, "")
      if (relativeCommand.split(/[\\/]/).includes(".."))
        throw new Error("Binary command escapes install directory")
      const destination = join(this.#agentsHome, agentId, "versions", version)
      await mkdir(dirname(destination), { recursive: true })
      await rm(destination, { force: true, recursive: true })
      await rename(staging, destination)
      const command = resolve(destination, relativeCommand)
      if (platform() !== "win32") await chmod(command, 0o755)
      const receipt: AgentInstallReceipt = {
        agentId,
        args: [...(distribution.args ?? [])],
        command,
        ...(distribution.env ? { environment: distribution.env } : {}),
        installedAt: new Date().toISOString(),
        integrity: distribution.sha256 ? "verified" : "unverified",
        kind: "binary",
        source: distribution.archive,
        version,
      }
      await this.#activate(receipt)
      options.onProgress?.(1)
      return receipt
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      await this.#cleanupAgentRoot(join(this.#agentsHome, agentId))
      throw error
    } finally {
      await rm(archivePath, { force: true })
    }
  }

  async #activate(receipt: AgentInstallReceipt): Promise<void> {
    const root = join(this.#agentsHome, receipt.agentId)
    await writeJsonAtomic(join(root, "receipts", `${receipt.version}.json`), receipt)
    await writeJsonAtomic(join(root, "current.json"), receipt)
  }

  async #cleanupAgentRoot(root: string): Promise<void> {
    await rm(join(root, "staging"), { force: true, recursive: true })
    await this.#cleanupAtomicFiles(root)
    await this.#cleanupIncompleteVersions(root)
  }

  async #cleanupAtomicFiles(root: string): Promise<void> {
    const directories = [root, join(root, "receipts")]
    for (const directory of directories) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return []
          throw error
        }
      )
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".tmp"))
          .map((entry) => rm(join(directory, entry.name), { force: true }))
      )
    }
  }

  async #cleanupIncompleteVersions(root: string): Promise<void> {
    const current = await readFile(join(root, "current.json"), "utf8")
      .then((value) => JSON.parse(value) as AgentInstallReceipt)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
    const receiptsRoot = join(root, "receipts")
    const receiptFiles = await readdir(receiptsRoot, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return []
        throw error
      }
    )
    const validVersions = new Set<string>()
    for (const entry of receiptFiles) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      const path = join(receiptsRoot, entry.name)
      const receipt = JSON.parse(await readFile(path, "utf8")) as AgentInstallReceipt
      const incomplete =
        !current ||
        (receipt.version !== current.version &&
          Date.parse(receipt.installedAt) > Date.parse(current.installedAt))
      if (incomplete) await rm(path, { force: true })
      else validVersions.add(receipt.version)
    }
    if (current) validVersions.add(current.version)
    const versionsRoot = join(root, "versions")
    const versions = await readdir(versionsRoot, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return []
        throw error
      }
    )
    await Promise.all(
      versions
        .filter((entry) => entry.isDirectory() && !validVersions.has(entry.name))
        .map((entry) => rm(join(versionsRoot, entry.name), { force: true, recursive: true }))
    )
  }
}

const executableName = (value: string): string => (platform() === "win32" ? `${value}.exe` : value)
