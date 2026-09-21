import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream, openAsBlob } from "node:fs"
import { chmod, mkdir, open, readdir, readFile, realpath, rename, rm } from "node:fs/promises"
import { arch, platform } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type {
  AgentDistribution,
  AgentId,
  AgentRegistryEntry,
  AgentRegistryPlatform,
} from "@cypheria/protocol"
import { BlobReader, ZipReader } from "@zip.js/zip.js"
import { extract as extractTar, type TarOptionsWithAliasesAsyncNoFile } from "tar"
import unbzip2Stream from "unbzip2-stream"

import { agentCompatibilityRule } from "./agent-compatibility-manifest.js"
import { downloadFile, writeJsonAtomic } from "./fs-utils.js"
import { NATIVE_AGENT_MANIFEST } from "./native-agent-manifest.js"
import type { ToolchainManager } from "./toolchain-manager.js"

export type AgentInstallReceipt = {
  agentId: AgentId
  args: string[]
  command: string
  environment?: Record<string, string>
  installedAt: string
  integrity: "verified" | "unverified" | "not-applicable"
  kind: "binary" | "npx" | "uvx"
  source: string
  version: string
  workingDirectory?: string
}

export type SelectedAgentDistribution =
  | {
      definition: NonNullable<AgentDistribution["binary"]>[AgentRegistryPlatform]
      kind: "binary"
      source: string
    }
  | {
      definition: NonNullable<AgentDistribution["npx"]>
      kind: "npx"
      source: string
    }
  | {
      definition: NonNullable<AgentDistribution["uvx"]>
      kind: "uvx"
      source: string
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

export const selectNpxBin = (
  packageName: string,
  bin: string | Record<string, string> | undefined
): string => {
  if (typeof bin === "string") return bin
  const entries = Object.entries(bin ?? {})
  const targets = new Set(entries.map(([, target]) => target))
  if (targets.size === 1 && entries[0]) return entries[0][1]
  const unscopedName = packageName.replace(/^@[^/]+\//, "")
  const named = bin?.[unscopedName]
  if (named) return named
  throw new Error(`${packageName} does not expose one unambiguous npx executable`)
}

const toPythonRequirement = (spec: string): string => {
  const match = /^(.*)@([^@]+)$/.exec(spec)
  return match ? `${match[1]}==${match[2]}` : spec
}

const packageCommand = (spec: string): string =>
  toPythonRequirement(spec)
    .split(/[=[<>=!~]/, 1)[0]
    ?.replace(/^.*\//, "") ?? spec

export const uvxInstallPlan = (
  agentId: AgentId,
  version: string,
  packageSpec: string,
  args: readonly string[]
): {
  additionalPackages: string[]
  args: string[]
  command: string
  requirement: string
} => {
  const compatibility = agentCompatibilityRule(agentId, version)
  return {
    additionalPackages: [...(compatibility?.additionalPythonPackages ?? [])],
    args: [...args],
    command: packageCommand(packageSpec),
    requirement: toPythonRequirement(packageSpec),
  }
}

/**
 * Registry entries may publish more than one distribution. Cypheria prefers a
 * native binary for the current platform, then npx, then uvx. Keeping this in a
 * pure function makes the policy explicit and independently testable.
 */
export const selectAgentDistribution = (
  distribution: AgentDistribution,
  target: AgentRegistryPlatform = registryPlatform()
): SelectedAgentDistribution | undefined => {
  const binary = distribution.binary?.[target]
  if (binary) return { definition: binary, kind: "binary", source: binary.archive }
  if (distribution.npx)
    return {
      definition: distribution.npx,
      kind: "npx",
      source: distribution.npx.package,
    }
  if (distribution.uvx)
    return {
      definition: distribution.uvx,
      kind: "uvx",
      source: distribution.uvx.package,
    }
  return undefined
}

export const isNativeExecutable = async (path: string): Promise<boolean> => {
  const file = await open(path, "r")
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    if (bytesRead < 2) return false
    if (header[0] === 0x4d && header[1] === 0x5a) return true
    if (bytesRead < 4) return false
    const magic = header.readUInt32BE(0)
    return (
      magic === 0x7f454c46 ||
      magic === 0xfeedface ||
      magic === 0xcefaedfe ||
      magic === 0xfeedfacf ||
      magic === 0xcffaedfe ||
      magic === 0xcafebabe ||
      magic === 0xbebafeca
    )
  } finally {
    await file.close()
  }
}

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

export const extractAgentArchive = async (
  archive: string,
  destination: string,
  options: { onProgress?: (value: number) => void; signal?: AbortSignal } = {}
): Promise<void> => {
  await mkdir(destination, { recursive: true })
  if (archive.endsWith(".zip")) {
    const reader = new ZipReader(new BlobReader(await openAsBlob(archive)), {
      checkCrc32: true,
      strictness: "strict",
    })
    try {
      const entries = await reader.getEntries({
        checkAmbiguity: true,
        filenameValidation: "strict",
      })
      if (entries.some((entry) => entry.symlink)) {
        throw new Error("Agent archive contains an unsupported symbolic link")
      }
      const totalBytes = entries.reduce(
        (total, entry) => total + (entry.directory ? 0 : entry.uncompressedSize),
        0
      )
      let completedBytes = 0
      options.onProgress?.(0)
      for (const entry of entries) {
        options.signal?.throwIfAborted()
        const target = resolve(destination, entry.filename)
        if (
          target !== resolve(destination) &&
          !target.startsWith(`${resolve(destination)}${sep}`)
        ) {
          throw new Error(`Agent archive entry escapes install directory: ${entry.filename}`)
        }
        if (entry.directory) {
          await mkdir(target, { recursive: true })
          continue
        }
        await mkdir(dirname(target), { recursive: true })
        const file = createWriteStream(target, { mode: entry.executable ? 0o755 : 0o644 })
        try {
          await entry.getData(Writable.toWeb(file), {
            checkCrc32: true,
            onprogress: (value) => {
              const extracted = completedBytes + value
              options.onProgress?.(totalBytes > 0 ? Math.min(extracted / totalBytes, 1) : 1)
            },
            signal: options.signal,
          })
        } catch (error) {
          file.destroy()
          throw error
        }
        completedBytes += entry.uncompressedSize
      }
      options.onProgress?.(1)
    } finally {
      await reader.close()
    }
  } else if (/\.(?:tar\.gz|tgz|tar\.bz2|tbz2)$/.test(archive)) {
    options.signal?.throwIfAborted()
    options.onProgress?.(0)
    let unsafeEntry: Error | undefined
    const tarOptions: TarOptionsWithAliasesAsyncNoFile = {
      cwd: destination,
      filter: (path, entry) => {
        const normalized = path.replaceAll("\\", "/")
        if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
          unsafeEntry ??= new Error(`Agent archive entry escapes install directory: ${path}`)
          return false
        }
        const unsupportedType =
          "type" in entry
            ? ["Link", "SymbolicLink", "CharacterDevice", "BlockDevice", "FIFO"].includes(
                entry.type
              )
              ? entry.type
              : undefined
            : entry.isSymbolicLink()
              ? "SymbolicLink"
              : entry.isCharacterDevice()
                ? "CharacterDevice"
                : entry.isBlockDevice()
                  ? "BlockDevice"
                  : entry.isFIFO()
                    ? "FIFO"
                    : undefined
        if (unsupportedType) {
          unsafeEntry ??= new Error(
            `Agent archive contains unsupported ${unsupportedType}: ${path}`
          )
          return false
        }
        return true
      },
      preservePaths: false,
    }
    if (/\.(?:tar\.bz2|tbz2)$/.test(archive)) {
      // ACP registry FORMAT.md allows bzip2-compressed tar archives (Goose
      // currently publishes this format). node-tar only decompresses gzip, so
      // feed it a streaming bzip2 decoder instead of treating the file as tar.
      await pipeline(
        createReadStream(archive),
        unbzip2Stream(),
        extractTar(tarOptions),
        ...(options.signal ? [{ signal: options.signal }] : [])
      )
    } else {
      await extractTar({ ...tarOptions, file: archive })
    }
    if (unsafeEntry) throw unsafeEntry
    options.signal?.throwIfAborted()
    options.onProgress?.(1)
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
    const selected = selectAgentDistribution(entry.distribution)
    if (selected?.kind === "binary")
      return this.#installBinary(agentId, entry.version, selected.definition, options)
    if (selected?.kind === "npx")
      return this.#installNpx(
        agentId,
        entry.version,
        selected.definition.package,
        selected.definition.args,
        selected.definition.env,
        "npx",
        options
      )
    if (selected?.kind === "uvx")
      return this.#installUvx(
        agentId,
        entry.version,
        selected.definition.package,
        selected.definition.args,
        selected.definition.env,
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

  async #installNpx(
    agentId: AgentId,
    version: string,
    packageSpec: string,
    args: readonly string[] = [],
    environment?: Record<string, string>,
    launcher: "executable" | "node" | "npx" = "node",
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
      const bin = selectNpxBin(parsed.name, packageJson.bin)
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
      } else if (launcher === "node") {
        receipt.args = [executable, ...receipt.args]
      } else {
        // FORMAT.md defines npx distributions as `npx <package> [args]`.
        // Invoke npm's own npx implementation so multi-bin packages use npm's
        // documented executable-selection rules instead of choosing a bin here.
        const npxCli =
          platform() === "win32"
            ? join(dirname(node), "node_modules", "npm", "bin", "npx-cli.js")
            : resolve(dirname(node), "../lib/node_modules/npm/bin/npx-cli.js")
        receipt.args = [npxCli, "--yes", "--offline", packageSpec, ...receipt.args]
        receipt.workingDirectory = destination
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
    const uv = this.#toolchains.executable("uv")
    const python = this.#toolchains.executable("python")
    if (!uv || !python) throw new Error("Managed uv and Python are unavailable")
    const launch = uvxInstallPlan(agentId, version, packageSpec, args)
    const staging = join(this.#agentsHome, agentId, "staging", randomUUID())
    const stagingTools = join(staging, "tools")
    const stagingBin = join(staging, "bin")
    await mkdir(staging, { recursive: true })
    try {
      // `uv tool install` materializes the same isolated environment and
      // command selection used by `uvx`, without launching the ACP server
      // during installation. The selected command is then run from this fixed
      // environment, so starting a session never resolves newer dependencies.
      await run(
        uv,
        [
          "tool",
          "install",
          "--force",
          "--python",
          python,
          ...launch.additionalPackages.flatMap((requirement) => ["--with", requirement]),
          launch.requirement,
        ],
        this.#toolchains.environment({
          UV_TOOL_BIN_DIR: stagingBin,
          UV_TOOL_DIR: stagingTools,
        }),
        options.signal
      )
      options.signal?.throwIfAborted()
      options.onProgress?.(0.85)
      const stagingExecutable = join(stagingBin, executableName(launch.command))
      const resolvedStaging = await realpath(staging)
      const resolvedStagingExecutable = await realpath(stagingExecutable)
      const relativeExecutable = relative(resolvedStaging, resolvedStagingExecutable)
      if (
        isAbsolute(relativeExecutable) ||
        relativeExecutable === ".." ||
        relativeExecutable.startsWith(`..${sep}`)
      ) {
        throw new Error("uvx command resolves outside install directory")
      }
      const destination = join(this.#agentsHome, agentId, "versions", version)
      await mkdir(dirname(destination), { recursive: true })
      await rm(destination, { force: true, recursive: true })
      await rename(staging, destination)
      const executable = join(destination, relativeExecutable)
      const nativeExecutable = await isNativeExecutable(executable).catch(() => false)
      const receipt: AgentInstallReceipt = {
        agentId,
        args: nativeExecutable ? launch.args : [executable, ...launch.args],
        command: nativeExecutable
          ? executable
          : join(dirname(executable), platform() === "win32" ? "python.exe" : "python"),
        ...(environment ? { environment } : {}),
        installedAt: new Date().toISOString(),
        integrity: "not-applicable",
        kind: "uvx",
        source: packageSpec,
        version,
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

  async #installBinary(
    agentId: AgentId,
    version: string,
    distribution: NonNullable<AgentDistribution["binary"]>[AgentRegistryPlatform],
    options: { onProgress?: (value: number) => void; signal?: AbortSignal } = {}
  ): Promise<AgentInstallReceipt> {
    if (!distribution) throw new Error("Binary distribution is missing")
    options.signal?.throwIfAborted()
    let lastReportedProgress = 0
    const reportProgress = (value: number): void => {
      const progress = Math.max(lastReportedProgress, Math.min(value, 1))
      if (progress < 1 && progress - lastReportedProgress < 0.005) return
      lastReportedProgress = progress
      options.onProgress?.(progress)
    }
    reportProgress(0.05)
    const staging = join(this.#agentsHome, agentId, "staging", randomUUID())
    const extension = new URL(distribution.archive).pathname.match(
      /(\.tar\.gz|\.tar\.bz2|\.tgz|\.tbz2|\.zip)$/
    )?.[1]
    const archivePath = join(this.#cacheDir, `${randomUUID()}${extension ?? ".raw"}`)
    await mkdir(dirname(archivePath), { recursive: true })
    await mkdir(staging, { recursive: true })
    try {
      const downloaded = await downloadFile(distribution.archive, archivePath, {
        onProgress: (value) => reportProgress(0.05 + value * 0.4),
        signal: options.signal,
        timeoutMs: 10 * 60_000,
      })
      if (
        distribution.sha256 &&
        downloaded.sha256.toLowerCase() !== distribution.sha256.toLowerCase()
      ) {
        throw new Error("Agent archive checksum mismatch")
      }
      if (extension) {
        await extractAgentArchive(archivePath, staging, {
          onProgress: (value) => reportProgress(0.45 + value * 0.45),
          signal: options.signal,
        })
      } else {
        const commandName = distribution.cmd.replace(/^\.\//, "")
        const target = resolve(staging, commandName)
        if (!target.startsWith(`${resolve(staging)}${sep}`))
          throw new Error("Binary command escapes install directory")
        await mkdir(dirname(target), { recursive: true })
        await rename(archivePath, target)
        if (platform() !== "win32") await chmod(target, 0o755)
      }
      options.signal?.throwIfAborted()
      reportProgress(0.9)
      const relativeCommand = distribution.cmd.replace(/^\.\//, "")
      if (relativeCommand.split(/[\\/]/).includes(".."))
        throw new Error("Binary command escapes install directory")
      const stagingCommand = resolve(staging, relativeCommand)
      const resolvedStaging = await realpath(staging)
      const resolvedStagingCommand = await realpath(stagingCommand)
      const relativeResolvedCommand = relative(resolvedStaging, resolvedStagingCommand)
      if (
        isAbsolute(relativeResolvedCommand) ||
        relativeResolvedCommand === ".." ||
        relativeResolvedCommand.startsWith(`..${sep}`)
      ) {
        throw new Error("Binary command resolves outside install directory")
      }
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
      reportProgress(1)
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
