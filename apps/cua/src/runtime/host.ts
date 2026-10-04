import type { CuaImage, CuaRequest } from "../protocol.ts"

/** The parts of the `node_repl` global the runtime uses. */
type NodeRepl = {
  readonly env: Readonly<Record<string, string>>
  write(value: unknown): void
  emitImage(image: unknown): PromiseLike<void>
  rpc?: (service: string, request: unknown) => PromiseLike<unknown>
}

export const nodeRepl = (): NodeRepl => {
  const repl = (globalThis as { nodeRepl?: NodeRepl }).nodeRepl
  if (!repl) throw new Error("The cua runtime must run inside cua_repl.")
  return repl
}

/** Sends one request to the Cypheria host that owns every UI action. */
export const call = async <T>(request: CuaRequest): Promise<T> => {
  const rpc = nodeRepl().rpc
  if (!rpc) throw new Error("cua_repl has no host connection. Ask the user to restart the task.")
  return (await rpc("cua", request)) as T
}

/** Adds text to the tool result, in order with the model's own `nodeRepl.write` output. */
export const writeText = (text: string): void => {
  if (text) nodeRepl().write(`${text.trimEnd()}\n\n`)
}

export const emitImage = async (image: CuaImage): Promise<void> => {
  await nodeRepl().emitImage(`data:${image.mimeType};base64,${image.dataBase64}`)
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Decodes base64 without `Buffer` or `atob`, which the REPL context does not provide. */
export const decodeBase64 = (value: string): Uint8Array => {
  const clean = value.replace(/[^A-Za-z0-9+/]/gu, "")
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let index = 0
  for (const character of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(character)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[index++] = (buffer >> bits) & 0xff
    }
  }
  return bytes.subarray(0, index)
}

/**
 * An absolute URL for what the model wrote: `localhost:3000` and loopback hosts become `http://`,
 * other bare hosts `https://`.
 */
export const absoluteUrl = (value: string): string => {
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) || /^(about|data|file):/iu.test(value)) return value
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/iu.test(value)
  return `${loopback ? "http" : "https"}://${value}`
}

/** A function or source text as page JavaScript. */
export const scriptSource = (script: string | ((...args: never[]) => unknown)): string =>
  typeof script === "function" ? String(script) : script
