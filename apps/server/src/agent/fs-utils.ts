import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export const ensureParent = async (path: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
}

export const readJsonFile = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await ensureParent(path)
  const staging = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  try {
    await rename(staging, path)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

export const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex")

export const downloadBytes = async (
  url: string,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<Uint8Array> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`)
  const declared = Number(response.headers.get("content-length") ?? 0)
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024
  if (declared > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`)
  return bytes
}
