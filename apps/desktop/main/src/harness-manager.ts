import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { chmod, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { delimiter, join, relative, resolve } from "node:path"
import { arch, platform } from "node:process"
import { Readable, Writable } from "node:stream"
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import * as pty from "node-pty"
import type { ConnectionProxySettings } from "../../ipc/src/connections.js"
import type {
  HarnessEvent,
  HarnessId,
  HarnessInstallReceipt,
  HarnessView,
} from "../../ipc/src/index.js"
import { buildConnectionProxyEnvironment } from "./connection-proxy.js"

type HarnessRecord = {
  availableVersion?: string | null
  enabled: boolean
  installedVersion: string | null
  lastUpdateCheckAt?: string | null
  receiptPath: string | null
}
type HarnessState = { harnesses: Partial<Record<HarnessId, HarnessRecord>>; version: 1 }
type FileSnapshot = { modifiedAt: string; path: string; size: number }
type TerminalRecord = { harnessId: HarnessId; process: pty.IPty }

type Descriptor = {
  description: string
  displayName: string
  executable: (root: string) => string
  id: HarnessId
  install: (context: InstallContext) => Promise<void>
  installerArguments: readonly string[]
  installerSource: string
  serveArgs: readonly string[]
  terminalHints: readonly string[]
  updateCheck: "supported" | "nativeAuto" | "unsupported"
  versionArgs: readonly string[]
}

type InstallContext = {
  env: NodeJS.ProcessEnv
  osHome: string
  root: string
  runtime: string
  run: (command: string, args: readonly string[]) => Promise<void>
}

const HARNESS_IDS = ["grok-build", "cursor", "gemini", "hermes", "opencode"] as const

const shellInstaller =
  (url: string, args: readonly string[] = []) =>
  async (context: InstallContext): Promise<void> => {
    if (platform === "win32") throw new Error("This managed installer currently requires WSL.")
    const script = join(context.root, "installer.sh")
    await context.run("curl", ["-fsSL", url, "-o", script])
    await chmod(script, 0o700)
    await context.run("/bin/bash", [script, ...args])
  }

const descriptors: Record<HarnessId, Descriptor> = {
  "grok-build": {
    description: "xAI coding agent",
    displayName: "Grok Build",
    executable: (root) => join(root, "runtime", "bin", platform === "win32" ? "grok.exe" : "grok"),
    id: "grok-build",
    install: shellInstaller("https://x.ai/cli/install.sh"),
    installerArguments: [],
    installerSource: "https://x.ai/cli/install.sh",
    serveArgs: ["agent", "stdio"],
    terminalHints: ["grok login", "grok inspect", "grok mcp list"],
    updateCheck: "supported",
    versionArgs: ["version"],
  },
  cursor: {
    description: "Cursor coding agent",
    displayName: "Cursor",
    executable: (root) => join(root, "os-home", ".local", "bin", "cursor-agent"),
    id: "cursor",
    install: shellInstaller("https://cursor.com/install"),
    installerArguments: [],
    installerSource: "https://cursor.com/install",
    serveArgs: ["acp"],
    terminalHints: ["cursor-agent login", "cursor-agent status", "cursor-agent --help"],
    updateCheck: "nativeAuto",
    versionArgs: ["--version"],
  },
  gemini: {
    description: "Google Gemini CLI",
    displayName: "Gemini CLI",
    executable: (root) =>
      join(root, "runtime", "node_modules", ".bin", platform === "win32" ? "gemini.cmd" : "gemini"),
    id: "gemini",
    install: async ({ run, runtime }) =>
      run(platform === "win32" ? "npm.cmd" : "npm", [
        "install",
        "--prefix",
        runtime,
        "--no-save",
        "@google/gemini-cli@latest",
      ]),
    installerArguments: [
      "install",
      "--prefix",
      "<managed-runtime>",
      "--no-save",
      "@google/gemini-cli@latest",
    ],
    installerSource: "npm:@google/gemini-cli@latest",
    serveArgs: ["--acp"],
    terminalHints: ["gemini", "gemini mcp --help", "gemini extensions --help"],
    updateCheck: "supported",
    versionArgs: ["--version"],
  },
  hermes: {
    description: "Nous Research agent",
    displayName: "Hermes",
    executable: (root) => join(root, "os-home", ".local", "bin", "hermes"),
    id: "hermes",
    install: async (context) => {
      const script = join(context.root, "installer.sh")
      await context.run("curl", [
        "-fsSL",
        "https://hermes-agent.nousresearch.com/install.sh",
        "-o",
        script,
      ])
      await chmod(script, 0o700)
      await context.run("/bin/bash", [
        script,
        "--skip-setup",
        "--skip-browser",
        "--skip-computer-use",
        "--non-interactive",
        "--dir",
        join(context.runtime, "hermes-agent"),
        "--hermes-home",
        join(context.root, "home"),
      ])
    },
    installerArguments: [
      "--skip-setup",
      "--skip-browser",
      "--skip-computer-use",
      "--non-interactive",
      "--dir",
      "<managed-runtime>/hermes-agent",
      "--hermes-home",
      "<managed-home>",
    ],
    installerSource: "https://hermes-agent.nousresearch.com/install.sh",
    serveArgs: ["acp"],
    terminalHints: ["hermes model", "hermes setup", "hermes doctor"],
    updateCheck: "supported",
    versionArgs: ["--version"],
  },
  opencode: {
    description: "Open source coding agent",
    displayName: "OpenCode",
    executable: (root) => join(root, "os-home", ".opencode", "bin", "opencode"),
    id: "opencode",
    install: shellInstaller("https://opencode.ai/install", ["--no-modify-path"]),
    installerArguments: ["--no-modify-path"],
    installerSource: "https://opencode.ai/install",
    serveArgs: ["acp"],
    terminalHints: ["opencode auth login", "opencode auth list", "opencode models"],
    updateCheck: "supported",
    versionArgs: ["--version"],
  },
}

const emptyState = (): HarnessState => ({ harnesses: {}, version: 1 })

export const buildHarnessEnvironment = (
  cypheriaHome: string,
  id: HarnessId,
  proxySettings: ConnectionProxySettings,
  baseEnvironment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv => {
  const root = join(cypheriaHome, "harnesses", id)
  const osHome = join(root, "os-home")
  const runtime = join(root, "runtime")
  const home = join(root, "home")
  const binDirs = [
    join(runtime, "bin"),
    join(runtime, "node_modules", ".bin"),
    join(osHome, ".local", "bin"),
    join(osHome, ".opencode", "bin"),
  ]
  const env: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    ...buildConnectionProxyEnvironment(baseEnvironment, proxySettings),
    HOME: osHome,
    USERPROFILE: osHome,
    PATH: `${binDirs.join(delimiter)}${delimiter}${baseEnvironment.PATH ?? ""}`,
  }
  if (id === "grok-build") {
    env.GROK_HOME = home
    env.GROK_BIN_DIR = join(runtime, "bin")
  }
  if (id === "gemini") env.GEMINI_CLI_HOME = home
  if (id === "hermes") {
    env.HERMES_HOME = home
    env.HERMES_INSTALL_DIR = join(runtime, "hermes-agent")
  }
  if (id === "opencode") {
    env.XDG_CONFIG_HOME = join(home, "config")
    env.XDG_DATA_HOME = join(home, "data")
    env.XDG_CACHE_HOME = join(home, "cache")
    env.OPENCODE_CONFIG_DIR = join(home, "config", "opencode")
    env.OPENCODE_DISABLE_AUTOUPDATE = "true"
  }
  return env
}

const hashFile = async (path: string): Promise<string> =>
  new Promise((resolveHash, reject) => {
    const hash = createHash("sha256")
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolveHash(hash.digest("hex")))
  })

const snapshotFiles = async (root: string): Promise<FileSnapshot[]> => {
  if (!existsSync(root)) return []
  const result: FileSnapshot[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() || entry.isSymbolicLink()) {
        const info = await stat(absolute)
        result.push({
          modifiedAt: info.mtime.toISOString(),
          path: relative(root, absolute),
          size: info.size,
        })
      }
    }
  }
  await visit(root)
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

const runCapture = async (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  onOutput?: (text: string) => void
): Promise<string> =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString()
      output += text
      onOutput?.(text)
    })
    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString()
      output += text
      onOutput?.(text)
    })
    child.once("error", reject)
    child.once("exit", (code) =>
      code === 0
        ? resolveRun(output.trim())
        : reject(
            new Error(`${command} exited with code ${code ?? "unknown"}.\n${output.slice(-4000)}`)
          )
    )
  })

const normalizedVersion = (version: string): string => version.trim().replace(/^[^\d]*(?=\d)/u, "")

const newestVersionInOutput = (output: string, installedVersion: string): string | null => {
  const versions = output.match(/v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/gu) ?? []
  return (
    versions.at(-1) ??
    (/up[ -]?to[ -]?date|latest version/iu.test(output) ? installedVersion : null)
  )
}

const smokeTestAcp = async (
  descriptor: Descriptor,
  executable: string,
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<void> => {
  const child = spawn(executable, descriptor.serveArgs, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString()
  })
  try {
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
    await client({ name: "Cypheria" }).connectWith(stream, async (context) => {
      const response = await Promise.race([
        context.request(methods.agent.initialize, {
          clientCapabilities: { terminal: true },
          clientInfo: { name: "Cypheria", version: "0.0.0" },
          protocolVersion: PROTOCOL_VERSION,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ACP initialize timed out.")), 15_000)
        ),
      ])
      if (response.protocolVersion !== PROTOCOL_VERSION)
        throw new Error(`Unsupported ACP protocol version ${response.protocolVersion}.`)
    })
  } catch (error) {
    throw new Error(`ACP initialize failed.${stderr ? `\n${stderr.slice(-2000)}` : ""}`, {
      cause: error,
    })
  } finally {
    child.kill()
  }
}

export type HarnessManager = ReturnType<typeof createHarnessManager>

export const createHarnessManager = (options: {
  cypheriaHome: string
  getProxySettings: () => ConnectionProxySettings
  onEvent: (event: HarnessEvent) => void
}) => {
  const harnessesRoot = join(options.cypheriaHome, "harnesses")
  const statePath = join(harnessesRoot, "state.json")
  const terminals = new Map<string, TerminalRecord>()
  const installing = new Set<HarnessId>()
  let state = emptyState()

  const rootFor = (id: HarnessId) => join(harnessesRoot, id)
  const readState = async () => {
    await mkdir(harnessesRoot, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(statePath, "utf8")) as HarnessState
      state = parsed.version === 1 ? parsed : emptyState()
    } catch {
      state = emptyState()
    }
  }
  const writeState = async () => {
    const temporary = `${statePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, statePath)
  }

  const envFor = (id: HarnessId): NodeJS.ProcessEnv =>
    buildHarnessEnvironment(options.cypheriaHome, id, options.getProxySettings())

  const prepare = async (id: HarnessId) => {
    const root = rootFor(id)
    await Promise.all(
      ["runtime", "home", "os-home", "receipts"].map((name) =>
        mkdir(join(root, name), { recursive: true })
      )
    )
  }

  const viewFor = (id: HarnessId): HarnessView => {
    const descriptor = descriptors[id]
    const record = state.harnesses[id]
    const executablePath = descriptor.executable(rootFor(id))
    return {
      description: descriptor.description,
      displayName: descriptor.displayName,
      enabled: record?.enabled ?? false,
      executablePath,
      id,
      installState: installing.has(id)
        ? "installing"
        : existsSync(executablePath)
          ? "installed"
          : "notInstalled",
      installedVersion: record?.installedVersion ?? null,
      availableVersion: record?.availableVersion ?? null,
      lastUpdateCheckAt: record?.lastUpdateCheckAt ?? null,
      managedHome: join(rootFor(id), "home"),
      receiptPath: record?.receiptPath ?? null,
      terminalHints: [...descriptor.terminalHints],
      updateAvailable: Boolean(
        record?.availableVersion &&
          record.installedVersion &&
          normalizedVersion(record.availableVersion) !== normalizedVersion(record.installedVersion)
      ),
      updateCheck: descriptor.updateCheck,
    }
  }

  const list = async (): Promise<HarnessView[]> => {
    if (!existsSync(statePath)) await readState()
    return HARNESS_IDS.map(viewFor)
  }

  const install = async (id: HarnessId): Promise<HarnessView> => {
    if (installing.has(id)) throw new Error(`${descriptors[id].displayName} is already installing.`)
    installing.add(id)
    options.onEvent({
      harnessId: id,
      message: "Resolving and installing the latest version…",
      type: "install.progress",
    })
    try {
      await prepare(id)
      const root = rootFor(id)
      const before = await snapshotFiles(root)
      const env = envFor(id)
      const runtime = join(root, "runtime")
      const run = async (command: string, args: readonly string[]) => {
        options.onEvent({
          harnessId: id,
          message: `$ ${command} ${args.join(" ")}`,
          type: "install.progress",
        })
        await runCapture(command, args, env, root, (message) =>
          options.onEvent({ harnessId: id, message, type: "install.progress" })
        )
      }
      await descriptors[id].install({ env, osHome: join(root, "os-home"), root, run, runtime })
      const executable = descriptors[id].executable(root)
      if (!existsSync(executable))
        throw new Error(`Installer completed but executable was not found at ${executable}.`)
      const versionOutput = await runCapture(executable, descriptors[id].versionArgs, env, root)
      const version =
        versionOutput
          .split(/\r?\n/u)
          .find((line) => line.trim())
          ?.trim() ?? "unknown"
      options.onEvent({
        harnessId: id,
        message: "Verifying ACP v1 initialization…",
        type: "install.progress",
      })
      await smokeTestAcp(descriptors[id], executable, env, process.cwd())
      const after = await snapshotFiles(root)
      const beforeByPath = new Map(before.map((file) => [file.path, file]))
      const changedFiles = after.filter(
        (file) => JSON.stringify(beforeByPath.get(file.path)) !== JSON.stringify(file)
      )
      const receipt: HarnessInstallReceipt = {
        architecture: arch,
        changedFiles,
        executable,
        executableSha256: await hashFile(resolve(executable)),
        harnessId: id,
        installedAt: new Date().toISOString(),
        installer: id === "gemini" ? "npm" : "official-latest-installer",
        installerArguments: descriptors[id].installerArguments.map((argument) =>
          argument
            .replace("<managed-runtime>", join(root, "runtime"))
            .replace("<managed-home>", join(root, "home"))
        ),
        installerSource: descriptors[id].installerSource,
        managedEnvironment: Object.fromEntries(
          Object.entries(env)
            .filter(([key]) =>
              [
                "HOME",
                "USERPROFILE",
                "GROK_HOME",
                "GROK_BIN_DIR",
                "GEMINI_CLI_HOME",
                "HERMES_HOME",
                "HERMES_INSTALL_DIR",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_CACHE_HOME",
                "OPENCODE_CONFIG_DIR",
              ].includes(key)
            )
            .map(([key, value]) => [key, value ?? ""])
        ),
        platform,
        version,
      }
      const receiptPath = join(root, "receipts", `${Date.now()}.json`)
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
      state.harnesses[id] = {
        availableVersion: version,
        enabled: state.harnesses[id]?.enabled ?? false,
        installedVersion: version,
        lastUpdateCheckAt: new Date().toISOString(),
        receiptPath,
      }
      await writeState()
      options.onEvent({
        harnessId: id,
        message: `${descriptors[id].displayName} ${version} installed.`,
        type: "install.completed",
      })
      return viewFor(id)
    } catch (error) {
      options.onEvent({
        harnessId: id,
        message: error instanceof Error ? error.message : String(error),
        type: "install.failed",
      })
      throw error
    } finally {
      installing.delete(id)
    }
  }

  const setEnabled = async (id: HarnessId, enabled: boolean): Promise<HarnessView> => {
    const view = viewFor(id)
    if (enabled && view.installState !== "installed")
      throw new Error("Install the harness before enabling it.")
    state.harnesses[id] = {
      availableVersion: view.availableVersion,
      enabled,
      installedVersion: view.installedVersion,
      lastUpdateCheckAt: view.lastUpdateCheckAt,
      receiptPath: view.receiptPath,
    }
    await writeState()
    return viewFor(id)
  }

  const checkUpdate = async (id: HarnessId): Promise<HarnessView> => {
    const view = viewFor(id)
    if (view.installState !== "installed" || !view.installedVersion)
      throw new Error("Install the harness before checking for updates.")
    if (descriptors[id].updateCheck !== "supported") return view

    const root = rootFor(id)
    const env = envFor(id)
    let availableVersion: string | null = null
    if (id === "gemini") {
      const output = await runCapture(
        "npm",
        ["view", "@google/gemini-cli", "version", "--json"],
        env,
        root
      )
      const parsed = JSON.parse(output) as unknown
      availableVersion = typeof parsed === "string" ? parsed : null
    } else if (id === "opencode") {
      const output = await runCapture(
        "curl",
        [
          "-fsSL",
          "--max-time",
          "15",
          "https://api.github.com/repos/anomalyco/opencode/releases/latest",
        ],
        env,
        root
      )
      const parsed = JSON.parse(output) as { tag_name?: unknown }
      availableVersion = typeof parsed.tag_name === "string" ? parsed.tag_name : null
    } else {
      const output = await runCapture(
        descriptors[id].executable(root),
        ["update", "--check"],
        env,
        root
      )
      availableVersion = newestVersionInOutput(output, view.installedVersion)
    }

    const record = state.harnesses[id]
    state.harnesses[id] = {
      availableVersion,
      enabled: record?.enabled ?? false,
      installedVersion: view.installedVersion,
      lastUpdateCheckAt: new Date().toISOString(),
      receiptPath: record?.receiptPath ?? null,
    }
    await writeState()
    return viewFor(id)
  }

  const openTerminal = async (id: HarnessId, cwd?: string) => {
    await prepare(id)
    if (!existsSync(descriptors[id].executable(rootFor(id))))
      throw new Error("Install the harness before opening its terminal.")
    const terminalId = randomUUID()
    const shell = process.env.SHELL || "/bin/zsh"
    const child = pty.spawn(shell, ["-l"], {
      cols: 100,
      cwd: cwd && existsSync(cwd) ? cwd : process.cwd(),
      env: envFor(id) as Record<string, string>,
      name: "xterm-256color",
      rows: 28,
    })
    terminals.set(terminalId, { harnessId: id, process: child })
    child.onData((data) => options.onEvent({ data, terminalId, type: "terminal.output" }))
    child.onExit(({ exitCode }) => {
      terminals.delete(terminalId)
      options.onEvent({ exitCode, terminalId, type: "terminal.exited" })
    })
    const descriptor = descriptors[id]
    setTimeout(
      () =>
        options.onEvent({
          data: `\r\n\x1b[1;36mCypheria managed ${descriptor.displayName} terminal\x1b[0m\r\nHome: ${join(rootFor(id), "home")}\r\nChanges here affect only this Cypheria-managed harness.\r\nUseful commands: ${descriptor.terminalHints.join(" | ")}\r\n\r\n`,
          terminalId,
          type: "terminal.output",
        }),
      50
    )
    return { harnessId: id, terminalId, title: descriptor.displayName }
  }

  const writeTerminal = (terminalId: string, data: string) => {
    const terminal = terminals.get(terminalId)
    if (!terminal) throw new Error("Terminal is closed.")
    terminal.process.write(data)
    return { written: true as const }
  }
  const resizeTerminal = (terminalId: string, cols: number, rows: number) => {
    const terminal = terminals.get(terminalId)
    if (!terminal) throw new Error("Terminal is closed.")
    terminal.process.resize(cols, rows)
    return { resized: true as const }
  }
  const closeTerminal = (terminalId: string) => {
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminals.delete(terminalId)
      terminal.process.kill()
    }
    return { closed: true as const }
  }
  const closeAllTerminals = () => {
    for (const terminalId of [...terminals.keys()]) closeTerminal(terminalId)
    return { closed: true as const }
  }

  return {
    checkUpdate,
    closeAllTerminals,
    closeTerminal,
    install,
    list,
    openTerminal,
    readState,
    resizeTerminal,
    setEnabled,
    writeTerminal,
  }
}
