import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js"
import { create as createTar } from "tar"
import { afterEach, describe, expect, it } from "vitest"
import {
  AgentInstaller,
  type AgentInstallReceipt,
  extractAgentArchive,
  isNativeExecutable,
  selectAgentDistribution,
  selectNpxBin,
  uvxInstallPlan,
} from "./agent-installer.js"
import type { ToolchainManager } from "./toolchain-manager.js"

const temporaryDirectories: string[] = []

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "cypheria-agent-installer-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  )

const createGzipTar = async (
  source: string,
  archive: string,
  entries: readonly string[]
): Promise<void> => {
  const uncompressed = `${archive}.tar`
  createTar({ cwd: source, file: uncompressed, sync: true }, [...entries])
  await writeFile(archive, gzipSync(await readFile(uncompressed)))
}

const receipt = (version: string, installedAt: string): AgentInstallReceipt => ({
  agentId: "gemini",
  args: [],
  command: `/managed/gemini/${version}`,
  installedAt,
  integrity: "not-applicable",
  kind: "npx",
  source: `gemini@${version}`,
  version,
})

describe("AgentInstaller cleanup", () => {
  it("removes the empty agent root after uninstall", async () => {
    const home = await temporaryDirectory()
    const root = join(home, "agents", "gemini")
    await Promise.all([
      mkdir(join(root, "versions", "1.0.0"), { recursive: true }),
      mkdir(join(root, "staging", "partial"), { recursive: true }),
      mkdir(join(root, "receipts"), { recursive: true }),
    ])
    await writeFile(join(root, "current.json"), JSON.stringify(receipt("1.0.0", "2026-09-20")))

    const installer = new AgentInstaller({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      toolchains: {} as ToolchainManager,
    })
    await installer.uninstall("gemini")

    await expect(exists(root)).resolves.toBe(false)
  })

  it("preserves an agent root containing unrecognized files", async () => {
    const home = await temporaryDirectory()
    const root = join(home, "agents", "gemini")
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "keep.txt"), "unrecognized data")

    const installer = new AgentInstaller({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      toolchains: {} as ToolchainManager,
    })
    await installer.uninstall("gemini")

    await expect(readFile(join(root, "keep.txt"), "utf8")).resolves.toBe("unrecognized data")
  })

  it("removes interrupted files and every inactive Agent version", async () => {
    const home = await temporaryDirectory()
    const root = join(home, "agents", "gemini")
    const cache = join(home, "cache", "agents")
    const current = receipt("1.0.0", "2026-09-20T00:00:00.000Z")
    const interrupted = receipt("2.0.0", "2026-09-20T01:00:00.000Z")
    await Promise.all([
      mkdir(join(root, "staging", "partial"), { recursive: true }),
      mkdir(join(root, "versions", "1.0.0"), { recursive: true }),
      mkdir(join(root, "versions", "2.0.0"), { recursive: true }),
      mkdir(join(root, "versions", "orphan"), { recursive: true }),
      mkdir(join(root, "receipts"), { recursive: true }),
      mkdir(cache, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(root, "current.json"), JSON.stringify(current)),
      writeFile(join(root, "current.json.123.tmp"), "partial"),
      writeFile(join(root, "receipts", "1.0.0.json"), JSON.stringify(current)),
      writeFile(join(root, "receipts", "2.0.0.json"), JSON.stringify(interrupted)),
      writeFile(join(root, "receipts", "2.0.0.json.123.tmp"), "partial"),
      writeFile(join(cache, "download.zip"), "partial"),
    ])

    const installer = new AgentInstaller({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      toolchains: {} as ToolchainManager,
    })
    await installer.cleanupInterrupted()

    await expect(exists(join(root, "staging"))).resolves.toBe(false)
    await expect(exists(join(cache, "download.zip"))).resolves.toBe(false)
    await expect(exists(join(root, "current.json.123.tmp"))).resolves.toBe(false)
    await expect(exists(join(root, "receipts", "2.0.0.json.123.tmp"))).resolves.toBe(false)
    await expect(exists(join(root, "versions", "1.0.0"))).resolves.toBe(true)
    await expect(exists(join(root, "versions", "2.0.0"))).resolves.toBe(false)
    await expect(exists(join(root, "versions", "orphan"))).resolves.toBe(false)
    await expect(exists(join(root, "receipts", "2.0.0.json"))).resolves.toBe(false)
    await expect(exists(join(root, "receipts", "1.0.0.json"))).resolves.toBe(true)
    expect(JSON.parse(await readFile(join(root, "current.json"), "utf8"))).toEqual(current)
  })
})

describe("extractAgentArchive", () => {
  it("extracts zip entries and reports byte progress", async () => {
    const root = await temporaryDirectory()
    const archive = join(root, "agent.zip")
    const destination = join(root, "extracted")
    const writer = new ZipWriter(new BlobWriter("application/zip"))
    await writer.add("bin/agent", new TextReader("agent executable"), { executable: true })
    await writer.add("README.md", new TextReader("documentation"))
    const blob = await writer.close()
    await writeFile(archive, new Uint8Array(await blob.arrayBuffer()))
    const progress: number[] = []

    await extractAgentArchive(archive, destination, {
      onProgress: (value) => progress.push(value),
    })

    await expect(readFile(join(destination, "bin", "agent"), "utf8")).resolves.toBe(
      "agent executable"
    )
    await expect(readFile(join(destination, "README.md"), "utf8")).resolves.toBe("documentation")
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(
      progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0))
    ).toBe(true)
  })

  it("rejects links from tar archives", async () => {
    const root = await temporaryDirectory()
    const source = join(root, "source")
    const archive = join(root, "agent.tar.gz")
    await mkdir(source)
    await symlink("../../outside", join(source, "agent"))
    await createGzipTar(source, archive, ["agent"])

    await expect(extractAgentArchive(archive, join(root, "extracted"))).rejects.toThrow(
      /unsupported SymbolicLink/
    )
  })

  it("rejects hard links from tar archives", async () => {
    const root = await temporaryDirectory()
    const source = join(root, "source")
    const archive = join(root, "agent.tar.gz")
    await mkdir(source)
    await writeFile(join(source, "agent"), "executable")
    await link(join(source, "agent"), join(source, "agent-link"))
    await createGzipTar(source, archive, ["agent", "agent-link"])

    await expect(extractAgentArchive(archive, join(root, "extracted"))).rejects.toThrow(
      /unsupported Link/
    )
  })

  it("extracts bzip2 tar archives allowed by the registry format", async () => {
    const root = await temporaryDirectory()
    const archive = join(root, "goose.tar.bz2")
    const destination = join(root, "extracted")
    // A tiny tar containing a single `goose` file, compressed with bzip2.
    const fixture =
      "QlpoOTFBWSZTWbTI3GsAAHv/uP66G4BQAf/iPmb9eP+3/8AASA4AACQgCDABWamYV6pqeiGnqA0BoyAAAAGgDQDIxAZIamk2pDTEaNGmTI0wjQNMgNGgxMIxAkkianhNTyGk0MjTRoAAAGQAaDQzU3Y/ldqx4Cln9EetJr9dwQe1XNxjgKGSutLWgeBE7IcySIrDrLAr9689XBYk6hMARjASNQylKgnPYNKU3RNg0/opAMApIZZrlDXBlnwUTTCCMw2+/eV4q04laIFh5npiIF73blZ8BSi3kywSeDyqCZRqGfOkgBlIYN6mmMtPDJRWrIYKWsMlDoDw/VDa4EcVcWF0otYe020MBGAoDozEXxFFZEVKLHAXX0UQbd674ip2fWFgmZbduIum6uczL7hwZQ5pUDGTMeAK6AcZnFDYRBQoTri8ESHV+SAZoIhwe9JSgsFBU6obIRTuDj007kYEt4TbDweC02LoKZPKysgZgSqJQK2tNymI9VQKEP5WA0hXISIjyKbWjUqtqxDOPxGUbKypGEf4u5IpwoSFpkbjWA=="
    await writeFile(archive, Buffer.from(fixture, "base64"))

    await extractAgentArchive(archive, destination)

    await expect(readFile(join(destination, "goose"), "utf8")).resolves.toBe("goose executable")
  })
})

describe("npm executable detection", () => {
  it("distinguishes native npm bins from JavaScript launchers", async () => {
    const root = await temporaryDirectory()
    const native = join(root, "native-bin")
    const script = join(root, "script-bin")
    await Promise.all([
      writeFile(native, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00])),
      writeFile(script, "#!/usr/bin/env node\nconsole.log('ok')\n"),
    ])

    await expect(isNativeExecutable(native)).resolves.toBe(true)
    await expect(isNativeExecutable(script)).resolves.toBe(false)
  })

  it("uses npx's documented bin selection rules", () => {
    expect(selectNpxBin("@scope/example", { other: "cli.js", example: "main.js" })).toBe("main.js")
    expect(selectNpxBin("example", { first: "cli.js", second: "cli.js" })).toBe("cli.js")
    expect(() => selectNpxBin("example", { first: "a.js", second: "b.js" })).toThrow(
      /unambiguous npx executable/
    )
  })
})

describe("managed agent launch receipts", () => {
  it("uses the active managed Node.js release for JavaScript launchers", async () => {
    const home = await temporaryDirectory()
    const root = join(home, "agents", "codex")
    const oldNode = join(home, "toolchains", "node", "versions", "22.0.0", "bin", "node")
    const activeNode = join(home, "toolchains", "node", "versions", "24.0.0", "bin", "node")
    const current: AgentInstallReceipt = {
      agentId: "codex",
      args: [join(root, "versions", "1.0.0", "codex.js")],
      command: oldNode,
      installedAt: "2026-09-29T14:57:01.000Z",
      integrity: "not-applicable",
      kind: "npx",
      source: "@openai/codex@1.0.0",
      version: "1.0.0",
    }
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "current.json"), JSON.stringify(current))

    const installer = new AgentInstaller({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      toolchains: {
        executable: (id: string) => (id === "node" ? activeNode : undefined),
      } as ToolchainManager,
    })

    await expect(installer.readCurrent("codex")).resolves.toMatchObject({
      command: activeNode,
    })
  })

  it("isolates legacy ACP runtime working directories under the managed Agent home", async () => {
    const home = await temporaryDirectory()
    const root = join(home, "agents", "cline")
    const legacy: AgentInstallReceipt = {
      agentId: "cline",
      args: ["serve", "acp"],
      command: join(root, "versions", "3.0.62", "cline"),
      installedAt: "2026-09-29T14:57:01.000Z",
      integrity: "verified",
      kind: "binary",
      source: "https://example.com/cline.tar.gz",
      version: "3.0.62",
    }
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "current.json"), JSON.stringify(legacy))

    const installer = new AgentInstaller({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      toolchains: {} as ToolchainManager,
    })

    await expect(installer.readCurrent("cline")).resolves.toMatchObject({
      workingDirectory: join(root, "home"),
    })
    await expect(exists(join(root, "home"))).resolves.toBe(true)
  })

  it("uses uvx command semantics without an agent-specific workaround", () => {
    expect(uvxInstallPlan("gemini", "0.61.0", "gemini-cli@0.61.0", ["--acp"])).toEqual({
      additionalPackages: [],
      args: ["--acp"],
      command: "gemini-cli",
      requirement: "gemini-cli==0.61.0",
    })
  })

  it("prefers a current-platform binary, then npx, then uvx", () => {
    const distribution = {
      binary: {
        "darwin-aarch64": { archive: "https://example.com/agent.zip", cmd: "./agent" },
      },
      npx: { package: "example-agent@1.0.0" },
      uvx: { package: "example-agent@1.0.0" },
    } as const

    expect(selectAgentDistribution(distribution, "darwin-aarch64")?.kind).toBe("binary")
    expect(selectAgentDistribution(distribution, "linux-x86_64")?.kind).toBe("npx")
    expect(selectAgentDistribution({ uvx: distribution.uvx }, "linux-x86_64")?.kind).toBe("uvx")
  })
})
