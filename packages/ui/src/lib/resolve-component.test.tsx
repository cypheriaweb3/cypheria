import type { ComponentType } from "react"
import { describe, expect, it } from "vitest"

import { resolveComponent } from "./resolve-component.js"

describe("resolveComponent", () => {
  it("unwraps nested CommonJS default exports", () => {
    const Example = (() => null) as ComponentType<{ value: string }>

    expect(resolveComponent<{ value: string }>({ default: { default: Example } })).toBe(Example)
  })
})
