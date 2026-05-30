import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  Badge,
  Button,
  applyCypheriaThemeToElement,
  cn,
  createCypheriaThemeState,
  Textarea,
} from "./index.js"

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

  it("applies theme variables to an element", () => {
    const classes = new Set<string>()
    const variables = new Map<string, string>()
    const root = {
      classList: {
        contains: (className: string) => classes.has(className),
        toggle: (className: string, force?: boolean) => {
          if (force) {
            classes.add(className)
            return true
          }
          classes.delete(className)
          return false
        },
      },
      style: {
        colorScheme: "",
        getPropertyValue: (propertyName: string) => variables.get(propertyName) ?? "",
        setProperty: (propertyName: string, value: string) => {
          variables.set(propertyName, value)
        },
      },
    } as HTMLElement
    const themeState = createCypheriaThemeState({
      currentMode: "dark",
      styles: {
        dark: {
          background: "oklch(0.2 0 0)",
          primary: "oklch(0.8 0.1 240)",
        },
      },
    })

    applyCypheriaThemeToElement(themeState, root)

    expect(root.classList.contains("dark")).toBe(true)
    expect(root.style.getPropertyValue("--background")).toBe("oklch(0.2 0 0)")
    expect(root.style.getPropertyValue("--primary")).toBe("oklch(0.8 0.1 240)")
  })
})
