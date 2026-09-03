import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Input } from "./components/input.js"
import { Label } from "./components/label.js"

import {
  applyCodexAppearancePreferencesToElement,
  applyCypheriaThemeToElement,
  Badge,
  Button,
  cn,
  codexCodeThemePresets,
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

  it("keeps Nova primary controls at the standard UI font size", () => {
    expect(renderToStaticMarkup(<Button>Run</Button>)).toMatch(/class="[^"]*\btext-sm\b/)
    expect(renderToStaticMarkup(<Label htmlFor="nova-prompt">Prompt</Label>)).toMatch(
      /class="[^"]*\btext-sm\b/
    )
    expect(renderToStaticMarkup(<Input id="nova-prompt" />)).toMatch(/class="[^"]*\bmd:text-sm\b/)
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

  it.each(["light", "dark"] as const)("derives semantic %s surfaces", (mode) => {
    const theme = defaultCodexAppearanceThemeSettings[mode]
    const styles = mapCodexChromeThemeToCypheriaThemeStyles(theme)
    expect(styles.sidebar).not.toBe(styles.muted)
    expect(styles.secondary).toBe(styles.accent)
    expect(styles.input).not.toBe(styles.border)
    expect(styles["sidebar-border"]).not.toBe(styles.border)
    expect(styles["sidebar-accent"]).not.toBe(styles.accent)
    expect(styles.popover).toBe(styles.card)
    if (mode === "light") expect(styles.card).toBe(theme.surface)
    else expect(styles.card).not.toBe(theme.surface)
    expect(styles.background).toBe(theme.surface)
    expect(styles.foreground).toBe(theme.ink)
    expect(styles["diff-removed"]).toBe(theme.semanticColors.diffRemoved)
    const recolored = mapCodexChromeThemeToCypheriaThemeStyles({ ...theme, accent: "#ff00ff" })
    for (const token of [
      "accent",
      "secondary",
      "muted",
      "sidebar",
      "sidebar-accent",
      "card",
    ] as const) {
      expect(recolored[token]).toBe(styles[token])
    }
    expect(recolored.primary).not.toBe(styles.primary)
  })

  it.each([
    [-10, 0],
    [110, 100],
  ])("clamps derived surfaces at contrast %s", (contrast, expected) => {
    const theme = defaultCodexAppearanceThemeSettings.light
    expect(mapCodexChromeThemeToCypheriaThemeStyles({ ...theme, contrast })).toEqual(
      mapCodexChromeThemeToCypheriaThemeStyles({ ...theme, contrast: expected })
    )
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

  it.each(
    codexCodeThemePresets
  )("keeps $id derived text readable without changing its source", (preset) => {
    const ratio = (a: string, b: string) => {
      const luminance = (hex: string) => {
        const channels = [1, 3, 5].map((offset) => {
          const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        return (
          (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
        )
      }
      const x = luminance(a)
      const y = luminance(b)
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    for (const variant of Object.values(preset.variants)) {
      const before = JSON.stringify(variant.theme)
      for (const contrast of [0, variant.theme.contrast, 100]) {
        const styles = mapCodexChromeThemeToCypheriaThemeStyles({ ...variant.theme, contrast })
        for (const token of [
          "primary",
          "card",
          "popover",
          "secondary",
          "accent",
          "sidebar",
          "sidebar-primary",
          "sidebar-accent",
          "destructive",
        ] as const) {
          expect(
            ratio(styles[token], styles[`${token}-foreground`]),
            `${preset.id}: ${token}`
          ).toBeGreaterThanOrEqual(4.5)
        }
        for (const token of [
          "background",
          "card",
          "muted",
          "accent",
          "sidebar",
          "sidebar-accent",
        ] as const) {
          expect(
            ratio(styles["muted-foreground"], styles[token]),
            `${preset.id}: muted on ${token}`
          ).toBeGreaterThanOrEqual(4.5)
          expect(
            ratio(styles.destructive, styles[token]),
            `${preset.id}: destructive on ${token}`
          ).toBeGreaterThanOrEqual(4.5)
          expect(
            ratio(styles.ring, styles[token]),
            `${preset.id}: ring on ${token}`
          ).toBeGreaterThanOrEqual(3)
        }
      }
      expect(JSON.stringify(variant.theme)).toBe(before)
    }
  })
})
