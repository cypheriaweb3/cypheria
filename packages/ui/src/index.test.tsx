import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  applyCodexAppearancePreferencesToElement,
  applyCypheriaThemeToElement,
  Badge,
  Button,
  cn,
  createCypheriaThemeState,
  defaultCodexAppearanceThemeSettings,
  mapCodexChromeThemeToCypheriaThemeStyles,
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
    } as unknown as HTMLElement
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

  it("applies appearance preference variables to an element", () => {
    const variables = new Map<string, string>()
    const root = {
      dataset: {
        cypheriaReducedMotion: "on",
      },
      style: {
        getPropertyValue: (propertyName: string) => variables.get(propertyName) ?? "",
        setProperty: (propertyName: string, value: string) => {
          variables.set(propertyName, value)
        },
      },
    } as unknown as HTMLElement

    applyCodexAppearancePreferencesToElement(
      {
        codeFontSize: 99,
        reducedMotionPreference: "system",
        uiFontSize: 4,
        useFontSmoothing: false,
        usePointerCursors: true,
      },
      root
    )

    expect(root.style.getPropertyValue("--font-sans-size")).toBe("11px")
    expect(root.style.getPropertyValue("--font-mono-size")).toBe("24px")
    expect(root.dataset.cypheriaFontSmoothing).toBe("false")
    expect(root.dataset.cypheriaPointerCursors).toBe("true")
    expect(root.dataset.cypheriaReducedMotion).toBeUndefined()
  })

  it("derives CSS font face variables from structured Codex font faces", () => {
    const styles = mapCodexChromeThemeToCypheriaThemeStyles({
      ...defaultCodexAppearanceThemeSettings.light,
      fonts: {
        code: '"Courier New"',
        codeFace: {
          family: "Courier New",
          fullName: "Courier New Bold Italic",
          postscriptName: "CourierNewPS-BoldItalicMT",
        },
        ui: '"Avenir Next"',
        uiFace: {
          family: "Avenir Next",
          fullName: "Avenir Next Demi Bold",
          postscriptName: "AvenirNext-DemiBold",
        },
      },
    })

    expect(styles["font-sans-weight"]).toBe("600")
    expect(styles["font-sans-style"]).toBe("normal")
    expect(styles["font-mono-weight"]).toBe("700")
    expect(styles["font-mono-style"]).toBe("italic")
  })
})
