export const cypheriaThemeVariableNames = [
  "radius",
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "font-sans",
  "font-sans-stretch",
  "font-sans-style",
  "font-sans-weight",
  "font-mono",
  "font-mono-stretch",
  "font-mono-style",
  "font-mono-weight",
  "diff-added",
  "diff-removed",
  "skill",
] as const

export type CypheriaThemeVariableName = (typeof cypheriaThemeVariableNames)[number]
export type CypheriaThemeMode = "light" | "dark"
export type CypheriaThemeStyles = Record<CypheriaThemeVariableName, string>

export interface CypheriaThemeState {
  currentMode: CypheriaThemeMode
  styles: Record<CypheriaThemeMode, CypheriaThemeStyles>
}

export interface CypheriaThemeStateInput {
  currentMode?: CypheriaThemeMode
  styles?: Partial<Record<CypheriaThemeMode, Partial<CypheriaThemeStyles>>>
}

export interface CodexFontFace {
  readonly family: string
  readonly fullName?: string
  readonly postscriptName?: string
}

const defaultFontSans =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const defaultFontMono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"'

export interface CodexChromeTheme {
  readonly accent: string
  readonly accentSource?: "chatgpt" | "custom"
  readonly contrast: number
  readonly fonts: {
    readonly code: string
    readonly codeFace?: CodexFontFace
    readonly ui: string
    readonly uiFace?: CodexFontFace
  }
  readonly ink: string
  readonly opaqueWindows: boolean
  readonly semanticColors: {
    readonly diffAdded: string
    readonly diffRemoved: string
    readonly skill: string
  }
  readonly surface: string
}

export interface CodexAppearanceThemeSettings {
  readonly dark: CodexChromeTheme
  readonly light: CodexChromeTheme
}

export interface CodexAppearancePreferences {
  readonly codeFontSize: number
  readonly reducedMotionPreference: "off" | "on" | "system"
  readonly uiFontSize: number
  readonly useFontSmoothing: boolean
  readonly usePointerCursors: boolean
}

export const defaultCodexAppearanceThemeSettings: CodexAppearanceThemeSettings = {
  light: {
    accent: "#0169cc",
    accentSource: "chatgpt",
    contrast: 45,
    fonts: {
      code: defaultFontMono,
      ui: defaultFontSans,
    },
    ink: "#0d0d0d",
    opaqueWindows: false,
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#e02e2a",
      skill: "#751ed9",
    },
    surface: "#ffffff",
  },
  dark: {
    accent: "#0169cc",
    accentSource: "chatgpt",
    contrast: 60,
    fonts: {
      code: defaultFontMono,
      ui: defaultFontSans,
    },
    ink: "#fcfcfc",
    opaqueWindows: true,
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#e02e2a",
      skill: "#b06dff",
    },
    surface: "#111111",
  },
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

// Persisted appearance colors are six-digit hex. Keep CSS-color support for
// callers of the UI mapper, but only promise contrast checks for hex inputs.
const rgb = (color: string): number[] | undefined =>
  /^#[\da-f]{6}$/i.test(color)
    ? [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
    : undefined

const mix = (base: string, overlay: string, percent: number): string => {
  const a = rgb(base)
  const b = rgb(overlay)
  if (!a || !b) return `color-mix(in srgb, ${base}, ${overlay} ${percent}%)`
  return `#${a
    .map((channel, i) =>
      Math.round(channel + (((b[i] ?? channel) - channel) * percent) / 100)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

const luminance = (color: string): number | undefined => {
  const channels = rgb(color)
  if (!channels) return undefined
  return channels.reduce((sum, channel, i) => {
    const value = channel / 255
    return (
      sum +
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
        ([0.2126, 0.7152, 0.0722][i] ?? 0)
    )
  }, 0)
}

const contrastRatio = (a: string, b: string): number => {
  const x = luminance(a)
  const y = luminance(b)
  if (x === undefined || y === undefined) return 1
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const readable = (seed: string, backgrounds: string[], minimum = 4.5): string => {
  if (!rgb(seed) || backgrounds.some((color) => !rgb(color))) return seed
  const score = (color: string) => Math.min(...backgrounds.map((bg) => contrastRatio(color, bg)))
  if (score(seed) >= minimum) return seed
  const target = score("#000000") > score("#ffffff") ? "#000000" : "#ffffff"
  for (let percent = 1; percent <= 100; percent++) {
    const candidate = mix(seed, target, percent)
    if (score(candidate) >= minimum) return candidate
  }
  return target
}

const onColor = (background: string): string =>
  contrastRatio("#000000", background) > contrastRatio("#ffffff", background)
    ? "#000000"
    : "#ffffff"

const inferFontStyle = (fontFamily: string): string =>
  /\b(italic|oblique)\b/i.test(fontFamily) ? "italic" : "normal"

const inferFontStretch = (fontFamily: string): string => {
  const normalized = fontFamily.toLowerCase()
  if (normalized.includes("condensed")) {
    return "condensed"
  }
  if (normalized.includes("expanded")) {
    return "expanded"
  }
  return "normal"
}

const inferFontWeight = (fontFamily: string): string => {
  const normalized = fontFamily.toLowerCase()

  if (/\b(thin|hairline)\b/.test(normalized)) {
    return "100"
  }
  if (/\b(extra[\s-]?light|ultra[\s-]?light)\b/.test(normalized)) {
    return "200"
  }
  if (/\blight\b/.test(normalized)) {
    return "300"
  }
  if (/\b(book|regular|roman|normal)\b/.test(normalized)) {
    return "400"
  }
  if (/\bmedium\b/.test(normalized)) {
    return "500"
  }
  if (/\b(semi[\s-]?bold|demi[\s-]?bold)\b/.test(normalized)) {
    return "600"
  }
  if (/\b(extra[\s-]?bold|ultra[\s-]?bold|heavy)\b/.test(normalized)) {
    return "800"
  }
  if (/\b(black|extra[\s-]?black|ultra[\s-]?black)\b/.test(normalized)) {
    return "900"
  }
  if (/\bbold\b/.test(normalized)) {
    return "700"
  }

  return "400"
}

export function mapCodexChromeThemeToCypheriaThemeStyles(
  theme: CodexChromeTheme
): CypheriaThemeStyles {
  const contrast = clamp(theme.contrast, 0, 100)
  const dark = (luminance(theme.surface) ?? 1) < 0.179
  const strength = contrast / 100
  const neutral = (base: string, light: number, night: number, range: number) =>
    mix(base, theme.ink, (dark ? night : light) + strength * range)
  const card = dark ? neutral(theme.surface, 0, 4, 3) : theme.surface
  const muted = neutral(theme.surface, 2, 5, 3)
  const interaction = neutral(theme.surface, 3, 7, 4)
  const sidebar = neutral(theme.surface, 1, 3, 2)
  const sidebarAccent = neutral(sidebar, 3, 6, 3)
  const surfaces = [theme.surface, card, muted, interaction, sidebar, sidebarAccent]
  const primary = readable(theme.accent, [theme.surface, sidebar])
  const destructive = readable(theme.semanticColors.diffRemoved, surfaces)

  return {
    accent: interaction,
    "accent-foreground": readable(theme.ink, [interaction]),
    background: theme.surface,
    border: neutral(theme.surface, 6, 10, 5),
    card,
    "card-foreground": readable(theme.ink, [card]),
    destructive,
    "destructive-foreground": onColor(destructive),
    "diff-added": theme.semanticColors.diffAdded,
    "diff-removed": theme.semanticColors.diffRemoved,
    "font-mono": theme.fonts.code,
    "font-mono-stretch": inferFontStretch(theme.fonts.codeFace?.fullName ?? theme.fonts.code),
    "font-mono-style": inferFontStyle(theme.fonts.codeFace?.fullName ?? theme.fonts.code),
    "font-mono-weight": inferFontWeight(theme.fonts.codeFace?.fullName ?? theme.fonts.code),
    "font-sans": theme.fonts.ui,
    "font-sans-stretch": inferFontStretch(theme.fonts.uiFace?.fullName ?? theme.fonts.ui),
    "font-sans-style": inferFontStyle(theme.fonts.uiFace?.fullName ?? theme.fonts.ui),
    "font-sans-weight": inferFontWeight(theme.fonts.uiFace?.fullName ?? theme.fonts.ui),
    foreground: theme.ink,
    input: neutral(theme.surface, 10, 16, 7),
    muted,
    "muted-foreground": readable(mix(theme.ink, theme.surface, 45 - strength * 10), surfaces),
    popover: card,
    "popover-foreground": readable(theme.ink, [card]),
    primary,
    "primary-foreground": onColor(primary),
    radius: "0.5rem",
    ring: readable(theme.accent, surfaces, 3),
    secondary: interaction,
    "secondary-foreground": readable(theme.ink, [interaction]),
    sidebar,
    "sidebar-accent": sidebarAccent,
    "sidebar-accent-foreground": readable(theme.ink, [sidebarAccent]),
    "sidebar-border": neutral(sidebar, 6, 10, 5),
    "sidebar-foreground": readable(theme.ink, [sidebar]),
    "sidebar-primary": primary,
    "sidebar-primary-foreground": onColor(primary),
    "sidebar-ring": readable(theme.accent, [sidebar, sidebarAccent], 3),
    skill: theme.semanticColors.skill,
  }
}

export function mapCodexAppearanceToCypheriaThemeState(
  appearance: CodexAppearanceThemeSettings,
  currentMode: CypheriaThemeMode = "light"
): CypheriaThemeState {
  return createCypheriaThemeState({
    currentMode,
    styles: {
      dark: mapCodexChromeThemeToCypheriaThemeStyles(appearance.dark),
      light: mapCodexChromeThemeToCypheriaThemeStyles(appearance.light),
    },
  })
}

export const defaultCypheriaThemeState: CypheriaThemeState = {
  currentMode: "light",
  styles: {
    light: {
      radius: "0.5rem",
      background: "oklch(0.985 0 0)",
      foreground: "oklch(0.145 0 0)",
      card: "oklch(1 0 0)",
      "card-foreground": "oklch(0.145 0 0)",
      popover: "oklch(1 0 0)",
      "popover-foreground": "oklch(0.145 0 0)",
      primary: "oklch(0.205 0 0)",
      "primary-foreground": "oklch(0.985 0 0)",
      secondary: "oklch(0.97 0 0)",
      "secondary-foreground": "oklch(0.205 0 0)",
      muted: "oklch(0.97 0 0)",
      "muted-foreground": "oklch(0.556 0 0)",
      accent: "oklch(0.97 0 0)",
      "accent-foreground": "oklch(0.205 0 0)",
      destructive: "oklch(0.577 0.245 27.325)",
      "destructive-foreground": "oklch(1 0 0)",
      border: "oklch(0.9 0 0)",
      input: "oklch(0.922 0 0)",
      ring: "oklch(0.708 0 0)",
      sidebar: "oklch(0.96 0 0)",
      "sidebar-foreground": "oklch(0.205 0 0)",
      "sidebar-primary": "oklch(0.205 0 0)",
      "sidebar-primary-foreground": "oklch(0.985 0 0)",
      "sidebar-accent": "oklch(0.92 0 0)",
      "sidebar-accent-foreground": "oklch(0.145 0 0)",
      "sidebar-border": "oklch(0.86 0 0)",
      "sidebar-ring": "oklch(0.708 0 0)",
      "font-sans": defaultFontSans,
      "font-sans-stretch": "normal",
      "font-sans-style": "normal",
      "font-sans-weight": "400",
      "font-mono": defaultFontMono,
      "font-mono-stretch": "normal",
      "font-mono-style": "normal",
      "font-mono-weight": "400",
      "diff-added": "#00a240",
      "diff-removed": "#e02e2a",
      skill: "#751ed9",
    },
    dark: {
      radius: "0.5rem",
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      card: "oklch(0.205 0 0)",
      "card-foreground": "oklch(0.985 0 0)",
      popover: "oklch(0.205 0 0)",
      "popover-foreground": "oklch(0.985 0 0)",
      primary: "oklch(0.922 0 0)",
      "primary-foreground": "oklch(0.205 0 0)",
      secondary: "oklch(0.269 0 0)",
      "secondary-foreground": "oklch(0.985 0 0)",
      muted: "oklch(0.269 0 0)",
      "muted-foreground": "oklch(0.708 0 0)",
      accent: "oklch(0.269 0 0)",
      "accent-foreground": "oklch(0.985 0 0)",
      destructive: "oklch(0.704 0.191 22.216)",
      "destructive-foreground": "oklch(0.985 0 0)",
      border: "oklch(1 0 0 / 10%)",
      input: "oklch(1 0 0 / 15%)",
      ring: "oklch(0.556 0 0)",
      sidebar: "oklch(0.205 0 0)",
      "sidebar-foreground": "oklch(0.985 0 0)",
      "sidebar-primary": "oklch(0.488 0.243 264.376)",
      "sidebar-primary-foreground": "oklch(0.985 0 0)",
      "sidebar-accent": "oklch(0.269 0 0)",
      "sidebar-accent-foreground": "oklch(0.985 0 0)",
      "sidebar-border": "oklch(1 0 0 / 10%)",
      "sidebar-ring": "oklch(0.556 0 0)",
      "font-sans": defaultFontSans,
      "font-sans-stretch": "normal",
      "font-sans-style": "normal",
      "font-sans-weight": "400",
      "font-mono": defaultFontMono,
      "font-mono-stretch": "normal",
      "font-mono-style": "normal",
      "font-mono-weight": "400",
      "diff-added": "#00a240",
      "diff-removed": "#e02e2a",
      skill: "#b06dff",
    },
  },
}

export function applyCypheriaThemeToElement(
  themeState: CypheriaThemeState,
  rootElement: HTMLElement
) {
  const activeStyles = themeState.styles[themeState.currentMode]

  rootElement.classList.toggle("dark", themeState.currentMode === "dark")
  rootElement.style.colorScheme = themeState.currentMode

  for (const variableName of cypheriaThemeVariableNames) {
    rootElement.style.setProperty(`--${variableName}`, activeStyles[variableName])
  }
}

export function applyCodexAppearancePreferencesToElement(
  preferences: CodexAppearancePreferences,
  rootElement: HTMLElement
) {
  rootElement.style.setProperty("--font-sans-size", `${clamp(preferences.uiFontSize, 11, 16)}px`)
  rootElement.style.setProperty("--font-mono-size", `${clamp(preferences.codeFontSize, 8, 24)}px`)
  rootElement.dataset.cypheriaFontSmoothing = String(preferences.useFontSmoothing)
  rootElement.dataset.cypheriaPointerCursors = String(preferences.usePointerCursors)

  if (preferences.reducedMotionPreference === "system") {
    delete rootElement.dataset.cypheriaReducedMotion
    return
  }

  rootElement.dataset.cypheriaReducedMotion = preferences.reducedMotionPreference
}

export function createCypheriaThemeState(state: CypheriaThemeStateInput = {}): CypheriaThemeState {
  return {
    currentMode: state.currentMode ?? defaultCypheriaThemeState.currentMode,
    styles: {
      light: {
        ...defaultCypheriaThemeState.styles.light,
        ...state.styles?.light,
      },
      dark: {
        ...defaultCypheriaThemeState.styles.dark,
        ...state.styles?.dark,
      },
    },
  }
}
