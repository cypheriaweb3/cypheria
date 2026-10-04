import { describe, expect, it } from "vitest"
import { buildModuleSource } from "../src/kernel/cell-source.ts"

function namer() {
  let counter = 0
  return () => `__internal_${counter++}`
}

describe("buildModuleSource", () => {
  it("collects bindings and exports the merged set", () => {
    const cell = buildModuleSource("const a = 1; function f() {}", {
      priorBindings: [{ name: "b", kind: "let" }],
      nextInternalBindingName: namer(),
    })
    expect(cell.currentBindings).toEqual([
      { name: "a", kind: "const" },
      { name: "f", kind: "function" },
    ])
    expect(cell.nextBindings.map((binding) => binding.name)).toEqual(["b", "a", "f"])
    expect(cell.source).toContain('import * as __prev from "@prev";\nlet b = __prev.b;')
    expect(cell.source).toMatch(/export \{ b, a, f \};$/)
  })

  it("downgrades reassigned carried consts to let", () => {
    const cell = buildModuleSource("a = 2", {
      priorBindings: [{ name: "a", kind: "const" }],
      nextInternalBindingName: namer(),
    })
    expect(cell.source).toContain("let a = __prev.a;")
    expect([...cell.warnedConstNames]).toEqual(["a"])
  })

  it("ignores reassignment of shadowed carried consts", () => {
    const cell = buildModuleSource("{ let a = 1; a = 2 } (function (a) { a = 3 })()", {
      priorBindings: [{ name: "a", kind: "const" }],
      nextInternalBindingName: namer(),
    })
    expect(cell.source).toContain("const a = __prev.a;")
    expect(cell.warnedConstNames.size).toBe(0)
  })

  it("marks writes to hoisted vars before their declaration", () => {
    const cell = buildModuleSource("x = 1; var x", {
      priorBindings: [],
      nextInternalBindingName: namer(),
    })
    expect(cell.source).toContain('((x = 1), (__internal_0("x"), undefined), x)')
  })
})
