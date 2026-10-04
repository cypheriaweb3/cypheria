import { Buffer } from "node:buffer"
import crypto from "node:crypto"
import { performance } from "node:perf_hooks"
import { TextDecoder, TextEncoder } from "node:util"
import vm from "node:vm"

/**
 * vm contexts start with very few globals. Populate common Node/web globals so
 * snippets and dependencies behave like a normal modern JS runtime.
 */
export function createRuntimeContext(options?: vm.CreateContextOptions): vm.Context {
  const runtimeContext = vm.createContext({}, options)
  Object.assign(runtimeContext, {
    globalThis: runtimeContext,
    global: runtimeContext,
    Buffer,
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    structuredClone,
    fetch,
    Headers,
    Request,
    Response,
    performance,
    crypto: crypto.webcrypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    setImmediate,
    clearImmediate,
    atob: (data: string) => Buffer.from(data, "base64").toString("binary"),
    btoa: (data: string) => Buffer.from(data, "binary").toString("base64"),
  })
  return runtimeContext
}
