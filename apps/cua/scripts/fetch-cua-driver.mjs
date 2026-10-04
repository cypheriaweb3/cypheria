// Downloads the pinned cua-driver release for this platform into vendor/cua-driver, verifying its
// SHA-256 digest. Desktop bundles that executable and starts it as its embedded daemon.
//
//   node scripts/fetch-cua-driver.mjs [--platform darwin|linux|win32] [--arch arm64|x64]
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

export const CUA_DRIVER_VERSION = "0.33.1"

/** Release assets that carry only the executables, with their published digests. */
const ASSETS = {
  "darwin-arm64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
    sha256: "8bb7aa27f5f33ae2fb7a8cfe0804d4b962487da6fd27fd3bc5d61fe039831d6c",
  },
  "darwin-x64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
    sha256: "8bb7aa27f5f33ae2fb7a8cfe0804d4b962487da6fd27fd3bc5d61fe039831d6c",
  },
  "linux-arm64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-arm64-binary.tar.gz`,
    sha256: "b0bfa5c7995d246aadaa2a5f8d26a4aae2d5557da45e04edc423ece7bdcaf258",
  },
  "linux-x64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64-binary.tar.gz`,
    sha256: "dad278ccb3dafb840fec9577bc9cab185c8089f1cc5057434199e962d91fea0c",
  },
  "win32-arm64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-arm64-binary.zip`,
    sha256: "85dcd59157a27d6c0c411579737fd49b3298a8d53fd20387d422b84913ce0f75",
  },
  "win32-x64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
    sha256: "e1ccd87887ab54b479cd56920417e032d4d9a9dd6c6f12da9f1ba8a5465afc45",
  },
}

const { values } = parseArgs({
  options: {
    arch: { default: process.arch, type: "string" },
    platform: { default: process.platform, type: "string" },
  },
})
const asset = ASSETS[`${values.platform}-${values.arch}`]
if (!asset) throw new Error(`cua-driver has no release for ${values.platform}-${values.arch}`)

const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}/${asset.name}`
const response = await fetch(url)
if (!response.ok) throw new Error(`Downloading ${url} failed: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const digest = createHash("sha256").update(bytes).digest("hex")
if (digest !== asset.sha256)
  throw new Error(`${asset.name} has digest ${digest}, expected ${asset.sha256}`)

const vendor = fileURLToPath(new URL("../vendor/cua-driver/", import.meta.url))
await rm(vendor, { force: true, recursive: true })
await mkdir(vendor, { recursive: true })
const archive = join(vendor, asset.name)
await writeFile(archive, bytes)
execFileSync("tar", ["-xf", archive, "-C", vendor])
await rm(archive)
const executable = values.platform === "win32" ? "cua-driver.exe" : "cua-driver"
if (!(await readdir(vendor)).includes(executable)) {
  throw new Error(`${asset.name} does not contain ${executable}`)
}
if (values.platform !== "win32") await chmod(join(vendor, executable), 0o755)
console.log(`cua-driver ${CUA_DRIVER_VERSION} → ${join(vendor, executable)}`)
