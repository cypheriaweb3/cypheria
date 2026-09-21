import { createHash } from "node:crypto"
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
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

const declaredResponseBytes = (response: Response): number => {
  const identityLength = Number(response.headers.get("x-identity-content-length") ?? 0)
  if (Number.isFinite(identityLength) && identityLength > 0) return identityLength
  if (response.headers.has("content-encoding")) return 0
  const transferLength = Number(response.headers.get("content-length") ?? 0)
  return Number.isFinite(transferLength) ? transferLength : 0
}

export const downloadBytes = async (
  url: string,
  options: { maxBytes?: number; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Uint8Array> => {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`)
  const declared = declaredResponseBytes(response)
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024
  if (declared > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`)
  return bytes
}

export const downloadFile = async (
  url: string,
  destination: string,
  options: {
    maxBytes?: number
    onProgress?: (value: number) => void
    signal?: AbortSignal
    timeoutMs?: number
  } = {}
): Promise<{ bytes: number; sha256: string }> => {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`)
  if (!response.body) throw new Error("Download response has no body")

  const declared = declaredResponseBytes(response)
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024
  if (declared > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`)

  await ensureParent(destination)
  const file = await open(destination, "w", 0o600)
  const reader = response.body.getReader()
  const hash = createHash("sha256")
  let bytes = 0
  options.onProgress?.(0)
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`)
      hash.update(chunk.value)
      let offset = 0
      while (offset < chunk.value.byteLength) {
        const { bytesWritten } = await file.write(
          chunk.value,
          offset,
          chunk.value.byteLength - offset
        )
        offset += bytesWritten
      }
      if (declared > 0) options.onProgress?.(Math.min(bytes / declared, 1))
    }
    if (declared > 0 && bytes !== declared) {
      throw new Error(`Download ended after ${bytes} of ${declared} bytes`)
    }
    options.onProgress?.(1)
    return { bytes, sha256: hash.digest("hex") }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    await file.close()
  }
}
