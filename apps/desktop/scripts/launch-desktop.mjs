import { spawn, spawnSync } from "node:child_process"
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, "..")
const electronExecutable = require("electron")

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`)
  }
}

const replacePlistString = (plistPath, key, value) => {
  run("plutil", ["-replace", key, "-string", value, plistPath])
}

const prepareMacApplication = async () => {
  const electronVersion = require("electron/package.json").version
  const sourceApplication = resolve(dirname(electronExecutable), "../..")
  const developmentDirectory = join(desktopDirectory, ".dev-app")
  const applicationPath = join(developmentDirectory, "Cypheria.app")
  const stampPath = join(developmentDirectory, "brand-stamp.json")
  const iconPath = join(desktopDirectory, "resources", "icons", "icon.icns")
  const iconStats = await stat(iconPath)
  const expectedStamp = JSON.stringify({
    electronVersion,
    iconModifiedAt: iconStats.mtimeMs,
    identityVersion: 2,
  })

  let currentStamp
  try {
    currentStamp = await readFile(stampPath, "utf8")
  } catch {
    currentStamp = undefined
  }

  if (currentStamp !== expectedStamp) {
    await rm(applicationPath, { force: true, recursive: true })
    await mkdir(developmentDirectory, { recursive: true })
    await cp(sourceApplication, applicationPath, {
      recursive: true,
      verbatimSymlinks: true,
    })

    const contentsPath = join(applicationPath, "Contents")
    const originalExecutable = join(contentsPath, "MacOS", "Electron")
    const brandedExecutable = join(contentsPath, "MacOS", "Cypheria")
    const plistPath = join(contentsPath, "Info.plist")

    await rename(originalExecutable, brandedExecutable)
    await cp(iconPath, join(contentsPath, "Resources", "cypheria.icns"))

    replacePlistString(plistPath, "CFBundleDisplayName", "Cypheria")
    replacePlistString(plistPath, "CFBundleExecutable", "Cypheria")
    replacePlistString(plistPath, "CFBundleIconFile", "cypheria.icns")
    replacePlistString(plistPath, "CFBundleIdentifier", "dev.cypheria.desktop.dev")
    replacePlistString(plistPath, "CFBundleName", "Cypheria")

    run("codesign", ["--force", "--deep", "--sign", "-", applicationPath])
    await writeFile(stampPath, expectedStamp)
  }

  return join(applicationPath, "Contents", "MacOS", "Cypheria")
}

const launch = async () => {
  const executable =
    process.platform === "darwin" ? await prepareMacApplication() : electronExecutable
  const child = spawn(executable, [desktopDirectory], {
    cwd: desktopDirectory,
    env: {
      ...process.env,
      CYPHERIA_DEVELOPMENT_SHELL: "1",
    },
    stdio: "inherit",
  })

  child.once("error", (error) => {
    throw error
  })
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exitCode = code ?? 1
  })
}

await launch()
