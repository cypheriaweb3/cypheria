import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Badge, Button, cn, Input, Sidebar, SidebarNav, SidebarNavItem } from "./index.js"

describe("Cypheria UI primitives", () => {
  it("merges utility classes deterministically", () => {
    expect(cn("cy-button", false, "cy-button--md")).toBe("cy-button cy-button--md")
  })

  it("renders shared primitives with Cypheria class names", () => {
    const markup = renderToStaticMarkup(
      <Sidebar>
        <SidebarNav>
          <SidebarNavItem active href="/workspaces">
            Workspaces
          </SidebarNavItem>
        </SidebarNav>
        <Button>Run</Button>
        <Input placeholder="Search" />
        <Badge tone="success">Ready</Badge>
      </Sidebar>
    )

    expect(markup).toContain("cy-sidebar")
    expect(markup).toContain("cy-sidebar-nav-item")
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain("cy-button")
    expect(markup).toContain("cy-input")
    expect(markup).toContain("cy-badge--success")
  })
})
