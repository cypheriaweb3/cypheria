import {
  type CodexAppearanceThemeSettings,
  type CodexChromeTheme,
  defaultCodexAppearanceThemeSettings,
} from "./theme.js"

type ThemeMode = keyof CodexAppearanceThemeSettings
export type CodexCodeThemeId =
  | "absolutely"
  | "ayu"
  | "catppuccin"
  | "codex"
  | "dracula"
  | "everforest"
  | "github"
  | "gruvbox"
  | "linear"
  | "lobster"
  | "material"
  | "matrix"
  | "monokai"
  | "night-owl"
  | "nord"
  | "notion"
  | "one"
  | "oscurange"
  | "proof"
  | "raycast"
  | "rose-pine"
  | "sentry"
  | "solarized"
  | "temple"
  | "tokyo-night"
  | "vercel"
  | "vscode-plus"
  | "xcode"

type ThemeSeed = Partial<Omit<CodexChromeTheme, "fonts" | "semanticColors">> & {
  readonly fonts?: Partial<CodexChromeTheme["fonts"]>
  readonly semanticColors: CodexChromeTheme["semanticColors"]
}

export interface CodexCodeThemePreset {
  readonly id: CodexCodeThemeId
  readonly label: string
  readonly variants: Partial<Record<ThemeMode, CodexCodeThemePresetVariant>>
}

export interface CodexCodeThemePresetVariant {
  readonly codeThemeId: CodexCodeThemeId
  readonly theme: CodexChromeTheme
  readonly variant: ThemeMode
}

const createCodexTheme = (variant: ThemeMode, seed: ThemeSeed): CodexChromeTheme => {
  const base = defaultCodexAppearanceThemeSettings[variant]
  return {
    ...base,
    ...seed,
    accentSource: seed.accentSource ?? "custom",
    fonts: {
      ...base.fonts,
      ...seed.fonts,
    },
    semanticColors: {
      ...base.semanticColors,
      ...seed.semanticColors,
    },
  }
}

export const codexCodeThemePresets: readonly CodexCodeThemePreset[] = [
  {
    id: "ayu",
    label: "Ayu",
    variants: {
      dark: {
        codeThemeId: "ayu",
        theme: createCodexTheme("dark", {
          accent: "#e6b450",
          ink: "#bfbdb6",
          semanticColors: { diffAdded: "#70bf56", diffRemoved: "#f26d78", skill: "#d0a1ff" },
          surface: "#10141c",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    variants: {
      light: {
        codeThemeId: "catppuccin",
        theme: createCodexTheme("light", {
          accent: "#8839ef",
          ink: "#4c4f69",
          semanticColors: { diffAdded: "#40a02b", diffRemoved: "#d20f39", skill: "#8839ef" },
          surface: "#eff1f5",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "catppuccin",
        theme: createCodexTheme("dark", {
          accent: "#cba6f7",
          ink: "#cdd6f4",
          semanticColors: { diffAdded: "#a6e3a1", diffRemoved: "#f38ba8", skill: "#cba6f7" },
          surface: "#1e1e2e",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "absolutely",
    label: "Absolutely",
    variants: {
      light: {
        codeThemeId: "absolutely",
        theme: createCodexTheme("light", {
          accent: "#cc7d5e",
          ink: "#2d2d2b",
          semanticColors: { diffAdded: "#00c853", diffRemoved: "#ff5f38", skill: "#cc7d5e" },
          surface: "#f9f9f7",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "absolutely",
        theme: createCodexTheme("dark", {
          accent: "#cc7d5e",
          ink: "#f9f9f7",
          semanticColors: { diffAdded: "#00c853", diffRemoved: "#ff5f38", skill: "#cc7d5e" },
          surface: "#2d2d2b",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "codex",
    label: "Codex",
    variants: {
      light: {
        codeThemeId: "codex",
        theme: createCodexTheme("light", {
          accent: "#0169cc",
          accentSource: "chatgpt",
          ink: "#0d0d0d",
          semanticColors: { diffAdded: "#00a240", diffRemoved: "#e02e2a", skill: "#751ed9" },
          surface: "#ffffff",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "codex",
        theme: createCodexTheme("dark", {
          accent: "#0169cc",
          accentSource: "chatgpt",
          ink: "#fcfcfc",
          semanticColors: { diffAdded: "#00a240", diffRemoved: "#e02e2a", skill: "#b06dff" },
          surface: "#111111",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    variants: {
      dark: {
        codeThemeId: "dracula",
        theme: createCodexTheme("dark", {
          accent: "#ff79c6",
          ink: "#f8f8f2",
          semanticColors: { diffAdded: "#50fa7b", diffRemoved: "#ff5555", skill: "#ff79c6" },
          surface: "#282a36",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "everforest",
    label: "Everforest",
    variants: {
      light: {
        codeThemeId: "everforest",
        theme: createCodexTheme("light", {
          accent: "#93b259",
          ink: "#5c6a72",
          semanticColors: { diffAdded: "#8da101", diffRemoved: "#f85552", skill: "#df69ba" },
          surface: "#fdf6e3",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "everforest",
        theme: createCodexTheme("dark", {
          accent: "#a7c080",
          ink: "#d3c6aa",
          semanticColors: { diffAdded: "#a7c080", diffRemoved: "#e67e80", skill: "#d699b6" },
          surface: "#2d353b",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "github",
    label: "GitHub",
    variants: {
      light: {
        codeThemeId: "github",
        theme: createCodexTheme("light", {
          accent: "#0969da",
          ink: "#1f2328",
          semanticColors: { diffAdded: "#1a7f37", diffRemoved: "#cf222e", skill: "#8250df" },
          surface: "#ffffff",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "github",
        theme: createCodexTheme("dark", {
          accent: "#1f6feb",
          ink: "#e6edf3",
          semanticColors: { diffAdded: "#3fb950", diffRemoved: "#f85149", skill: "#bc8cff" },
          surface: "#0d1117",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    variants: {
      light: {
        codeThemeId: "gruvbox",
        theme: createCodexTheme("light", {
          accent: "#458588",
          ink: "#3c3836",
          semanticColors: { diffAdded: "#3c3836", diffRemoved: "#cc241d", skill: "#b16286" },
          surface: "#fbf1c7",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "gruvbox",
        theme: createCodexTheme("dark", {
          accent: "#458588",
          ink: "#ebdbb2",
          semanticColors: { diffAdded: "#ebdbb2", diffRemoved: "#cc241d", skill: "#b16286" },
          surface: "#282828",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "linear",
    label: "Linear",
    variants: {
      light: {
        codeThemeId: "linear",
        theme: createCodexTheme("light", {
          accent: "#5e6ad2",
          fonts: { ui: "Inter" },
          ink: "#1b1b1b",
          opaqueWindows: true,
          semanticColors: { diffAdded: "#52a450", diffRemoved: "#c94446", skill: "#8160d8" },
          surface: "#fcfcfd",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "linear",
        theme: createCodexTheme("dark", {
          accent: "#606acc",
          fonts: { ui: "Inter" },
          ink: "#e3e4e6",
          opaqueWindows: true,
          semanticColors: { diffAdded: "#69c967", diffRemoved: "#ff7e78", skill: "#c2a1ff" },
          surface: "#0f0f11",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "lobster",
    label: "Lobster",
    variants: {
      dark: {
        codeThemeId: "lobster",
        theme: createCodexTheme("dark", {
          accent: "#ff5c5c",
          fonts: { ui: "Satoshi" },
          ink: "#e4e4e7",
          semanticColors: { diffAdded: "#22c55e", diffRemoved: "#ff5c5c", skill: "#3b82f6" },
          surface: "#111827",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "material",
    label: "Material",
    variants: {
      dark: {
        codeThemeId: "material",
        theme: createCodexTheme("dark", {
          accent: "#80cbc4",
          ink: "#eeffff",
          semanticColors: { diffAdded: "#c3e88d", diffRemoved: "#f07178", skill: "#c792ea" },
          surface: "#212121",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "matrix",
    label: "Matrix",
    variants: {
      dark: {
        codeThemeId: "matrix",
        theme: createCodexTheme("dark", {
          accent: "#1eff5a",
          fonts: {
            ui: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          },
          ink: "#b8ffca",
          opaqueWindows: true,
          semanticColors: { diffAdded: "#1eff5a", diffRemoved: "#fa423e", skill: "#1eff5a" },
          surface: "#040805",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "monokai",
    label: "Monokai",
    variants: {
      dark: {
        codeThemeId: "monokai",
        theme: createCodexTheme("dark", {
          accent: "#99947c",
          ink: "#f8f8f2",
          semanticColors: { diffAdded: "#86b42b", diffRemoved: "#c4265e", skill: "#8c6bc8" },
          surface: "#272822",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "night-owl",
    label: "Night Owl",
    variants: {
      dark: {
        codeThemeId: "night-owl",
        theme: createCodexTheme("dark", {
          accent: "#44596b",
          ink: "#d6deeb",
          semanticColors: { diffAdded: "#c5e478", diffRemoved: "#ef5350", skill: "#c792ea" },
          surface: "#011627",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "nord",
    label: "Nord",
    variants: {
      dark: {
        codeThemeId: "nord",
        theme: createCodexTheme("dark", {
          accent: "#88c0d0",
          ink: "#d8dee9",
          semanticColors: { diffAdded: "#a3be8c", diffRemoved: "#bf616a", skill: "#b48ead" },
          surface: "#2e3440",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "notion",
    label: "Notion",
    variants: {
      light: {
        codeThemeId: "notion",
        theme: createCodexTheme("light", {
          accent: "#3183d8",
          ink: "#37352f",
          opaqueWindows: true,
          semanticColors: { diffAdded: "#008000", diffRemoved: "#a31515", skill: "#0000ff" },
          surface: "#ffffff",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "notion",
        theme: createCodexTheme("dark", {
          accent: "#3183d8",
          ink: "#d9d9d8",
          opaqueWindows: true,
          semanticColors: { diffAdded: "#4ec9b0", diffRemoved: "#fa423e", skill: "#3183d8" },
          surface: "#191919",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "oscurange",
    label: "Oscurange",
    variants: {
      dark: {
        codeThemeId: "oscurange",
        theme: createCodexTheme("dark", {
          accent: "#f9b98c",
          ink: "#e6e6e6",
          semanticColors: { diffAdded: "#40c977", diffRemoved: "#fa423e", skill: "#479ffa" },
          surface: "#0b0b0f",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "one",
    label: "One",
    variants: {
      light: {
        codeThemeId: "one",
        theme: createCodexTheme("light", {
          accent: "#526fff",
          ink: "#383a42",
          semanticColors: { diffAdded: "#3bba54", diffRemoved: "#e45649", skill: "#526fff" },
          surface: "#fafafa",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "one",
        theme: createCodexTheme("dark", {
          accent: "#4d78cc",
          ink: "#abb2bf",
          semanticColors: { diffAdded: "#8cc265", diffRemoved: "#e05561", skill: "#c162de" },
          surface: "#282c34",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "proof",
    label: "Proof",
    variants: {
      light: {
        codeThemeId: "proof",
        theme: createCodexTheme("light", {
          accent: "#3d755d",
          ink: "#2f312d",
          semanticColors: { diffAdded: "#3d755d", diffRemoved: "#ba2623", skill: "#5f6ac2" },
          surface: "#f5f3ed",
        }),
        variant: "light",
      },
    },
  },
  {
    id: "raycast",
    label: "Raycast",
    variants: {
      light: {
        codeThemeId: "raycast",
        theme: createCodexTheme("light", {
          accent: "#ff6363",
          fonts: { code: '"Jetbrains Mono"', ui: "Inter" },
          ink: "#030303",
          semanticColors: { diffAdded: "#006b4f", diffRemoved: "#b12424", skill: "#9a1b6e" },
          surface: "#ffffff",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "raycast",
        theme: createCodexTheme("dark", {
          accent: "#ff6363",
          fonts: { code: '"Jetbrains Mono"', ui: "Inter" },
          ink: "#fefefe",
          semanticColors: { diffAdded: "#59d499", diffRemoved: "#ff6363", skill: "#cf2f98" },
          surface: "#101010",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "rose-pine",
    label: "Rose Pine",
    variants: {
      light: {
        codeThemeId: "rose-pine",
        theme: createCodexTheme("light", {
          accent: "#d7827e",
          ink: "#575279",
          semanticColors: { diffAdded: "#56949f", diffRemoved: "#797593", skill: "#907aa9" },
          surface: "#faf4ed",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "rose-pine",
        theme: createCodexTheme("dark", {
          accent: "#ea9a97",
          ink: "#e0def4",
          semanticColors: { diffAdded: "#9ccfd8", diffRemoved: "#908caa", skill: "#c4a7e7" },
          surface: "#232136",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "sentry",
    label: "Sentry",
    variants: {
      dark: {
        codeThemeId: "sentry",
        theme: createCodexTheme("dark", {
          accent: "#7055f6",
          ink: "#e6dff9",
          semanticColors: { diffAdded: "#8ee6d7", diffRemoved: "#fa423e", skill: "#7055f6" },
          surface: "#2d2935",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "solarized",
    label: "Solarized",
    variants: {
      light: {
        codeThemeId: "solarized",
        theme: createCodexTheme("light", {
          accent: "#b58900",
          ink: "#657b83",
          semanticColors: { diffAdded: "#859900", diffRemoved: "#dc322f", skill: "#d33682" },
          surface: "#fdf6e3",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "solarized",
        theme: createCodexTheme("dark", {
          accent: "#d30102",
          ink: "#839496",
          semanticColors: { diffAdded: "#859900", diffRemoved: "#dc322f", skill: "#d33682" },
          surface: "#002b36",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    variants: {
      dark: {
        codeThemeId: "tokyo-night",
        theme: createCodexTheme("dark", {
          accent: "#3d59a1",
          ink: "#a9b1d6",
          semanticColors: { diffAdded: "#449dab", diffRemoved: "#914c54", skill: "#9d7cd8" },
          surface: "#1a1b26",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "temple",
    label: "Temple",
    variants: {
      dark: {
        codeThemeId: "temple",
        theme: createCodexTheme("dark", {
          accent: "#e4f222",
          ink: "#c7e6da",
          semanticColors: { diffAdded: "#40c977", diffRemoved: "#fa423e", skill: "#e4f222" },
          surface: "#02120c",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "vercel",
    label: "Vercel",
    variants: {
      light: {
        codeThemeId: "vercel",
        theme: createCodexTheme("light", {
          accent: "#006aff",
          contrast: 40,
          fonts: { code: '"Geist Mono", ui-monospace, "SFMono-Regular"', ui: "Geist, Inter" },
          ink: "#171717",
          opaqueWindows: true,
          semanticColors: { diffAdded: "#28A948", diffRemoved: "#EB001D", skill: "#A100F8" },
          surface: "#ffffff",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "vercel",
        theme: createCodexTheme("dark", {
          accent: "#006efe",
          contrast: 50,
          fonts: { code: '"Geist Mono", ui-monospace, "SFMono-Regular"', ui: "Geist, Inter" },
          ink: "#ededed",
          opaqueWindows: true,
          semanticColors: { diffAdded: "#00AD3A", diffRemoved: "#F13342", skill: "#9540D5" },
          surface: "#000000",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "vscode-plus",
    label: "VS Code Plus",
    variants: {
      light: {
        codeThemeId: "vscode-plus",
        theme: createCodexTheme("light", {
          accent: "#007acc",
          ink: "#000000",
          semanticColors: { diffAdded: "#008000", diffRemoved: "#ee0000", skill: "#0000ff" },
          surface: "#ffffff",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "vscode-plus",
        theme: createCodexTheme("dark", {
          accent: "#007acc",
          ink: "#d4d4d4",
          semanticColors: { diffAdded: "#369432", diffRemoved: "#f44747", skill: "#000080" },
          surface: "#1e1e1e",
        }),
        variant: "dark",
      },
    },
  },
  {
    id: "xcode",
    label: "Xcode",
    variants: {
      light: {
        codeThemeId: "xcode",
        theme: createCodexTheme("light", {
          accent: "#0e0eff",
          fonts: { code: '"SFMono-Regular"' },
          ink: "#000000",
          semanticColors: { diffAdded: "#00a240", diffRemoved: "#c41a16", skill: "#0e0eff" },
          surface: "#ffffff",
        }),
        variant: "light",
      },
      dark: {
        codeThemeId: "xcode",
        theme: createCodexTheme("dark", {
          accent: "#5482ff",
          fonts: { code: '"SFMono-Medium"' },
          ink: "#ffffff",
          semanticColors: { diffAdded: "#67b7a4", diffRemoved: "#fc6a5d", skill: "#5482ff" },
          surface: "#1f1f24",
        }),
        variant: "dark",
      },
    },
  },
] as const

export const codexCodeThemeOptions = codexCodeThemePresets.map(({ id, label }) => ({ id, label }))

const lightThemeOrder: readonly CodexCodeThemeId[] = [
  "absolutely",
  "catppuccin",
  "codex",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "notion",
  "one",
  "proof",
  "raycast",
  "rose-pine",
  "solarized",
  "vercel",
  "vscode-plus",
  "xcode",
]

const darkThemeOrder: readonly CodexCodeThemeId[] = [
  "absolutely",
  "ayu",
  "catppuccin",
  "codex",
  "dracula",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "lobster",
  "material",
  "matrix",
  "monokai",
  "night-owl",
  "nord",
  "notion",
  "one",
  "oscurange",
  "raycast",
  "rose-pine",
  "sentry",
  "solarized",
  "temple",
  "tokyo-night",
  "vercel",
  "vscode-plus",
  "xcode",
]

export const getCodexCodeThemeOptionsForMode = (variant: ThemeMode) =>
  (variant === "light" ? lightThemeOrder : darkThemeOrder)
    .map((id) => codexCodeThemePresets.find((preset) => preset.id === id))
    .filter((preset): preset is CodexCodeThemePreset => preset?.variants[variant] != null)
    .map(({ id, label }) => ({ id, label }))

export const getCodexCodeThemePresetVariant = (
  codeThemeId: CodexCodeThemeId,
  variant: ThemeMode
): CodexCodeThemePresetVariant | undefined =>
  codexCodeThemePresets.find((preset) => preset.id === codeThemeId)?.variants[variant]
