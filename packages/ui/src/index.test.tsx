import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Badge, Button, cn, Textarea } from "./index.js"

describe("Cypheria UI primitives", () => {
  it("merges utility classes deterministically", () => {
    expect(cn("px-2", false, "px-4")).toBe("px-4")
  })

  it("renders shared registry components", () => {
    const markup = renderToStaticMarkup(
      <div>
        <Button>Run</Button>
        <Textarea placeholder="Prompt" />
        <Badge variant="secondary">Ready</Badge>
      </div>
    )

    expect(markup).toContain('data-slot="button"')
    expect(markup).toContain('data-slot="textarea"')
    expect(markup).toContain('data-slot="badge"')
  })
})
