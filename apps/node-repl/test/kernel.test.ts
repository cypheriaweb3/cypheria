import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { KernelHarness } from "./kernel-harness.ts"

// Exercises the bundled kernel; `pnpm build:js` runs before the tests.
const kernelPath = fileURLToPath(new URL("../internal/assets/files/kernel.js", import.meta.url))

describe("node_repl kernel", () => {
  let kernel: KernelHarness

  beforeEach(() => {
    kernel = new KernelHarness(kernelPath)
  })

  afterEach(() => {
    kernel.close()
  })

  it("carries bindings across cells", async () => {
    await kernel.exec("const a = 1; let b = 2; var c = 3; function f() { return a + b + c }")
    const { result } = await kernel.exec("b++; console.log(a, b, c, typeof f)")
    expect(result).toMatchObject({ ok: true, output: "1 3 3 function", error: null })
  })

  it("warns when a carried const is reassigned", async () => {
    await kernel.exec("const a = 1")
    const { result } = await kernel.exec("a = 5; a")
    expect(result.output).toBe(
      "Warning: a was declared with const; use let for reassignable variables."
    )
  })

  it("keeps bindings committed before a failure", async () => {
    const failed = await kernel.exec("let x = 1; var y = 1; y = 2; throw new Error('boom')")
    expect(failed.result).toMatchObject({ ok: false, error: "boom" })
    const { result } = await kernel.exec("console.log(x, y)")
    expect(result.output).toBe("1 2")
  })

  it("separates named outputs from default output", async () => {
    const { result } = await kernel.exec(
      "nodeRepl.write('a'); nodeRepl.write('named', 'item'); console.log({ x: 1 })"
    )
    expect(result).toMatchObject({ output: "a{ x: 1 }", named_outputs: ["named"] })
  })

  it("emits images through the host", async () => {
    const { result, messages } = await kernel.exec(
      "await nodeRepl.emitImage('data:image/png;base64,AA=='); console.log('done')"
    )
    expect(result.output).toBe("done")
    expect(messages.find((message) => message.type === "emit_image")).toMatchObject({
      image_url: "data:image/png;base64,AA==",
    })
  })

  it("denies process and static imports", async () => {
    const processImport = await kernel.exec("await import('node:process')")
    expect(processImport.result.error).toBe(
      'Importing module "node:process" is not allowed in node_repl'
    )
    const staticImport = await kernel.exec("import fs from 'node:fs'")
    expect(staticImport.result.error).toContain('Top-level static import "node:fs"')
    const builtin = await kernel.exec("const fs = await import('node:fs'); typeof fs.readFileSync")
    expect(builtin.result.ok).toBe(true)
  })

  it("disallows string code generation", async () => {
    const { result } = await kernel.exec("eval('1')")
    expect(result.ok).toBe(false)
  })

  it("reports redacted source", async () => {
    const { messages } = await kernel.exec(
      "// note\nconst secret = 'abc'; const re = /x/; console.log(secret + '!')"
    )
    expect(messages.find((message) => message.type === "exec_redacted_source")?.source).toBe(
      '/* */\nconst id0 = ""; const id1 = /(?:)/; console.log(id0 + "")'
    )
  })
})
