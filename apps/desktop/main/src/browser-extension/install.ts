import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { EXTENSION_IDS, NATIVE_HOST_NAME } from "@cypheria/browser-extension/protocol"
import { browserInstallations } from "@cypheria/cua/host"

const run = promisify(execFile)

/** Where each family on Windows looks up native messaging hosts, under HKCU. */
const WINDOWS_REGISTRY_ROOTS = [
  "Software\\Google\\Chrome",
  "Software\\Microsoft\\Edge",
  "Software\\BraveSoftware\\Brave-Browser",
  "Software\\Chromium",
  "Software\\Vivaldi",
]

export type NativeHostInstallation = {
  /** The installed host, or null when this build has no host for the platform. */
  readonly binary: string | null
  /** The manifests written, by browser family or registry root. */
  readonly manifests: readonly string[]
  readonly errors: readonly string[]
}

export const hostBinaryName = (platform: NodeJS.Platform = process.platform): string =>
  platform === "win32" ? "cypheria-browser-host.exe" : "cypheria-browser-host"

export const nativeHostManifest = (binary: string) => ({
  allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  description: "Cypheria browser extension host",
  name: NATIVE_HOST_NAME,
  path: binary,
  type: "stdio",
})

const digest = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex")

/** Writes a file only when its content changed, through a temporary file. */
const writeIfChanged = async (path: string, content: string): Promise<void> => {
  if ((await readFile(path, "utf8").catch(() => null)) === content) return
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, content)
  await rename(temporary, path)
}

/**
 * Installs the native host under `$CYPHERIA_HOME/bin/`, where the host finds the home from its
 * own path, and registers it with every Chromium browser the person has: a manifest in each
 * profile root's `NativeMessagingHosts` on macOS and Linux, and registry keys on Windows. The
 * registration is global per browser, so the Desktop that started last owns it.
 */
export const installNativeHost = async (options: {
  readonly cypheriaHome: string
  /** The host binary this build ships, if any. */
  readonly source: string | null
  readonly platform?: NodeJS.Platform
}): Promise<NativeHostInstallation> => {
  const platform = options.platform ?? process.platform
  const errors: string[] = []
  if (!options.source || !existsSync(options.source)) {
    return {
      binary: null,
      errors: ["This build of Cypheria Desktop has no browser host."],
      manifests: [],
    }
  }
  const binDir = join(options.cypheriaHome, "bin")
  const binary = join(binDir, hostBinaryName(platform))
  try {
    await mkdir(binDir, { recursive: true })
    const installed = existsSync(binary) ? await digest(binary) : null
    if (installed !== (await digest(options.source))) {
      const temporary = `${binary}.${process.pid}.tmp`
      await copyFile(options.source, temporary)
      if (platform !== "win32") await chmod(temporary, 0o755)
      await rename(temporary, binary)
    }
  } catch (error) {
    errors.push(
      `Could not install the browser host: ${error instanceof Error ? error.message : String(error)}`
    )
    return { binary: null, errors, manifests: [] }
  }
  const manifest = `${JSON.stringify(nativeHostManifest(binary), null, 2)}\n`
  const manifests: string[] = []
  if (platform === "win32") {
    const dir = join(options.cypheriaHome, "browser-extension")
    const path = join(dir, `${NATIVE_HOST_NAME}.json`)
    try {
      await mkdir(dir, { recursive: true })
      await writeIfChanged(path, manifest)
    } catch (error) {
      errors.push(
        `Could not write the host manifest: ${error instanceof Error ? error.message : String(error)}`
      )
      return { binary, errors, manifests }
    }
    for (const root of WINDOWS_REGISTRY_ROOTS) {
      const key = `HKCU\\${root}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`
      try {
        await run("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", path, "/f"], {
          windowsHide: true,
        })
        manifests.push(key)
      } catch (error) {
        errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { binary, errors, manifests }
  }
  for (const installation of browserInstallations(platform)) {
    // Only browsers the person has used have a profile root to register in.
    if (!existsSync(installation.userDataDir)) continue
    const dir = join(installation.userDataDir, "NativeMessagingHosts")
    try {
      await mkdir(dir, { recursive: true })
      await writeIfChanged(join(dir, `${NATIVE_HOST_NAME}.json`), manifest)
      manifests.push(installation.family)
    } catch (error) {
      errors.push(`${installation.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { binary, errors, manifests }
}
