import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { ToolchainManager } from "./toolchain-manager.js"

const homes: string[] = []
const createTemporaryDirectory = (prefix: string) => mkdtemp(join(tmpdir(), prefix))
const removeTemporaryDirectory = (path: string) => rm(path, { force: true, recursive: true })

const createManager = async () => {
  const home = await createTemporaryDirectory("cypheria-toolchains-")
  homes.push(home)
  const bin = join(home, "fake-bin")
  const uv = join(bin, "uv")
  const python = join(bin, "python")
  await mkdir(bin, { recursive: true })
  await writeFile(
    uv,
    `#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "pip" && args[1] === "compile") {
  const output = args[args.indexOf("--output-file") + 1];
  const input = await readFile(args.at(-1), "utf8");
  await writeFile(output, input.trim().split(/\\s+/).map((item) => item + " --hash=sha256:" + "a".repeat(64)).join("\\n") + "\\n");
} else if (args[0] === "venv") {
  const root = args.at(-1);
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(join(root, "bin", "python"), "");
}
`,
    { mode: 0o755 }
  )
  await writeFile(python, "#!/bin/sh\nprintf 'cpython-314|main'\n", { mode: 0o755 })
  await chmod(uv, 0o755)
  await chmod(python, 0o755)
  await mkdir(join(home, "toolchains"), { recursive: true })
  await writeFile(
    join(home, "toolchains", "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      toolchains: {
        node: {
          activeVersion: null,
          availableVersion: null,
          error: null,
          executable: null,
          installedVersions: [],
          state: "missing",
        },
        python: {
          activeVersion: "3.14.0",
          availableVersion: "3.14.0",
          error: null,
          executable: python,
          installedVersions: ["3.14.0"],
          state: "ready",
        },
        uv: {
          activeVersion: "0.9.0",
          availableVersion: "0.9.0",
          error: null,
          executable: uv,
          installedVersions: ["0.9.0"],
          state: "ready",
        },
      },
    })
  )
  const manager = new ToolchainManager({ cacheDir: join(home, "cache"), cypheriaHome: home })
  await manager.start()
  return { home, manager }
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(removeTemporaryDirectory))
})

describe("ToolchainManager Python environments", () => {
  it("lets an isolated operation override managed environment defaults", async () => {
    const { manager } = await createManager()
    const isolatedTools = "/isolated/tools"
    const isolatedBin = "/isolated/bin"

    expect(
      manager.environment({ UV_TOOL_BIN_DIR: isolatedBin, UV_TOOL_DIR: isolatedTools })
    ).toMatchObject({
      UV_TOOL_BIN_DIR: isolatedBin,
      UV_TOOL_DIR: isolatedTools,
    })
  })

  it("reuses an immutable environment by resolved dependency fingerprint", async () => {
    const { manager } = await createManager()
    const manifest = {
      package: "demo",
      pythonVersion: "3.14.0",
      requirements: ["demo==1.0.0"],
      uvVersion: "0.9.0",
    }
    const [first, second] = await Promise.all([
      manager.createPythonEnvironment(manifest),
      manager.createPythonEnvironment(manifest),
    ])
    expect(second).toEqual(first)
    expect(JSON.parse(await readFile(join(first.path, "environment.json"), "utf8"))).toMatchObject({
      fingerprint: first.fingerprint,
      lockedRequirements: expect.stringContaining("--hash=sha256:"),
    })

    const different = await manager.createPythonEnvironment({
      ...manifest,
      requirements: ["demo==2.0.0"],
    })
    expect(different.fingerprint).not.toBe(first.fingerprint)
    expect(await manager.garbageCollectPythonEnvironments(new Set(), -1)).toEqual(
      expect.arrayContaining([first.fingerprint, different.fingerprint])
    )
  })

  it("keeps referenced or leased environments during garbage collection", async () => {
    const { manager } = await createManager()
    const environment = await manager.createPythonEnvironment({
      package: "demo",
      pythonVersion: "3.14.0",
      requirements: ["demo==1.0.0"],
      uvVersion: "0.9.0",
    })
    expect(
      await manager.garbageCollectPythonEnvironments(new Set([environment.fingerprint]), -1)
    ).toEqual([])
    const release = manager.acquireEnvironment(environment.fingerprint)
    expect(await manager.garbageCollectPythonEnvironments(new Set(), -1)).toEqual([])
    release()
    expect(await manager.garbageCollectPythonEnvironments(new Set(), -1)).toEqual([
      environment.fingerprint,
    ])
  })
})
