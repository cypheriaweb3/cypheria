import { createHash, randomUUID } from "node:crypto"
import { type FSWatcher, watch } from "node:fs"
import { lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import type { OpenAIResourceWriteResult } from "@cypheria/protocol"

/** The largest file an App reads or writes through its host. */
export const MAX_FILE_RESOURCE_BYTES = 20 * 1024 * 1024
export const FILE_RESOURCE_SCHEME = "cypheria-resource"

type Binding = {
  readonly instanceId: string
  readonly path: string
  readonly uri: string
  watcher: FSWatcher | null
}

const within = (root: string, path: string): boolean => {
  const inside = relative(root, path)
  return inside === "" || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))
}

const etagOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 32)

/** UTF-8 text without NUL bytes reads as text; anything else as base64. */
const asText = (bytes: Buffer): string | null => {
  if (bytes.includes(0)) return null
  const text = bytes.toString("utf8")
  return Buffer.from(text, "utf8").equals(bytes) ? text : null
}

/**
 * Files opened by file entry points, served by the host rather than the plugin's server. Each
 * opening gets an opaque `cypheria-resource://` URI bound to one canonical path inside the
 * Thread's workspace roots; Apps never see the path.
 */
export class FileResourceStore {
  readonly #bindings = new Map<string, Binding>()

  /** The canonical path of `path` if it is a regular file inside one of `roots`. */
  async resolve(roots: readonly string[], path: string): Promise<string> {
    if (!isAbsolute(path)) throw new Error("Files are opened by absolute path")
    let canonical: string
    try {
      canonical = await realpath(path)
    } catch {
      throw new Error("The file does not exist")
    }
    const canonicalRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => null)))
    if (!canonicalRoots.some((root) => root && within(root, canonical))) {
      throw new Error("The file is outside the chat's workspace")
    }
    if (!(await stat(canonical)).isFile()) throw new Error("Only files can be opened")
    return canonical
  }

  bind(instanceId: string, path: string): string {
    const uri = `${FILE_RESOURCE_SCHEME}://${instanceId}/${randomUUID()}`
    this.#bindings.set(uri, { instanceId, path, uri, watcher: null })
    return uri
  }

  /** The path an instance's URI names, for the instance alone. */
  path(instanceId: string, uri: string): string | null {
    const binding = this.#bindings.get(uri)
    return binding?.instanceId === instanceId ? binding.path : null
  }

  async read(
    instanceId: string,
    uri: string,
    representation: "text" | "blob" | "auto"
  ): Promise<{ contents: Record<string, unknown>[] }> {
    const path = this.path(instanceId, uri)
    if (!path) throw new Error("This App cannot read that resource")
    const size = (await stat(path)).size
    if (size > MAX_FILE_RESOURCE_BYTES) throw new Error("The file is too large to open")
    const bytes = await readFile(path)
    const text = representation === "blob" ? null : asText(bytes)
    if (representation === "text" && text === null) throw new Error("The file is not text")
    return {
      contents: [
        {
          _meta: { "openai/resource": { etag: etagOf(bytes), writable: true } },
          ...(text === null ? { blob: bytes.toString("base64") } : { text }),
          uri,
        },
      ],
    }
  }

  async write(
    instanceId: string,
    params: { blob?: string; ifMatch?: string; text?: string; uri: string }
  ): Promise<OpenAIResourceWriteResult> {
    const path = this.path(instanceId, params.uri)
    if (!path) throw new Error("This App cannot write that resource")
    const bytes =
      params.text === undefined
        ? Buffer.from(params.blob ?? "", "base64")
        : Buffer.from(params.text, "utf8")
    if (bytes.byteLength > MAX_FILE_RESOURCE_BYTES) {
      return { maxBytes: MAX_FILE_RESOURCE_BYTES, outcome: "too-large" }
    }
    if ((await lstat(path)).isSymbolicLink()) throw new Error("The file was replaced by a link")
    const current = etagOf(await readFile(path))
    if (params.ifMatch && params.ifMatch !== current) return { etag: current, outcome: "conflict" }
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
    const mode = (await stat(path)).mode
    await writeFile(temporary, bytes, { mode })
    await rename(temporary, path)
    return { etag: etagOf(bytes), outcome: "saved" }
  }

  /** Watches the file and calls `onChange` until unsubscribed or released. */
  subscribe(instanceId: string, uri: string, onChange: () => void): void {
    const binding = this.#bindings.get(uri)
    if (!binding || binding.instanceId !== instanceId || binding.watcher) return
    let timer: NodeJS.Timeout | undefined
    binding.watcher = watch(binding.path, () => {
      clearTimeout(timer)
      timer = setTimeout(onChange, 100)
    })
    binding.watcher.on("error", () => this.unsubscribe(instanceId, uri))
  }

  unsubscribe(instanceId: string, uri: string): void {
    const binding = this.#bindings.get(uri)
    if (binding?.instanceId !== instanceId) return
    binding.watcher?.close()
    binding.watcher = null
  }

  /** Forgets an instance's files. */
  release(instanceId: string): void {
    for (const [uri, binding] of this.#bindings) {
      if (binding.instanceId !== instanceId) continue
      binding.watcher?.close()
      this.#bindings.delete(uri)
    }
  }
}
