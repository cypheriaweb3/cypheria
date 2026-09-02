import {
  applyCodexAppearancePreferencesToElement,
  applyCypheriaThemeToElement,
  type CodexAppearanceThemeSettings,
  type CypheriaThemeMode,
  defaultCodexAppearanceThemeSettings,
  mapCodexAppearanceToCypheriaThemeState,
} from "@cypheria/ui"
import { atom, useAtom } from "jotai"
import { useCallback, useEffect, useLayoutEffect } from "react"
import type {
  AppearanceSettings,
  AppearanceSettingsWrite,
  AppearanceThemeMode,
} from "../../ipc/src/index.js"

export const defaultAppearanceSettings: AppearanceSettingsWrite = {
  theme: "system",
  lightThemeId: "codex",
  darkThemeId: "codex",
  lightTheme: defaultCodexAppearanceThemeSettings.light,
  darkTheme: defaultCodexAppearanceThemeSettings.dark,
  uiFontSize: 14,
  codeFontSize: 13,
  diffMarkerStyle: "color",
  reducedMotionPreference: "system",
  useFontSmoothing: true,
  usePointerCursors: false,
}

export type AppearancePreferences = Pick<
  AppearanceSettingsWrite,
  | "codeFontSize"
  | "reducedMotionPreference"
  | "uiFontSize"
  | "useFontSmoothing"
  | "usePointerCursors"
>

const initialAppearance =
  typeof window === "undefined"
    ? defaultAppearanceSettings
    : (window.cypheria?.bootstrap.appearance ?? defaultAppearanceSettings)

const appearanceAtom = atom<AppearanceSettingsWrite>(initialAppearance)

export const resolveThemeMode = (mode: AppearanceThemeMode): CypheriaThemeMode => {
  if (mode !== "system") {
    return mode
  }

  if (typeof window === "undefined") {
    return "light"
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

const toAppearanceState = (settings: AppearanceSettings): AppearanceSettingsWrite => {
  const { configPath: _, ...appearance } = settings
  return appearance
}

export function applyAppearanceToElement(
  appearance: AppearanceSettingsWrite,
  rootElement: HTMLElement
): void {
  const mode = resolveThemeMode(appearance.theme)
  applyCypheriaThemeToElement(
    mapCodexAppearanceToCypheriaThemeState(
      { light: appearance.lightTheme, dark: appearance.darkTheme },
      mode
    ),
    rootElement
  )
  applyCodexAppearancePreferencesToElement(appearance, rootElement)
}

export function useAppearance() {
  const [appearance, setAppearance] = useAtom(appearanceAtom)

  const syncAppearance = useCallback(
    (settings: AppearanceSettings | AppearanceSettingsWrite) => {
      setAppearance("configPath" in settings ? toAppearanceState(settings) : settings)
    },
    [setAppearance]
  )

  const updateAppearance = useCallback(
    async (nextAppearance: AppearanceSettingsWrite) => {
      const cypheria = window.cypheria
      if (!cypheria) {
        setAppearance(nextAppearance)
        return undefined
      }

      const savedSettings = await cypheria.settings.setAppearance(nextAppearance)
      setAppearance(toAppearanceState(savedSettings))
      return savedSettings
    },
    [setAppearance]
  )

  return { appearance, syncAppearance, updateAppearance }
}

export function useTheme() {
  const { appearance, updateAppearance } = useAppearance()

  const updateTheme = useCallback(
    (theme: {
      theme: AppearanceThemeMode
      lightTheme: CodexAppearanceThemeSettings["light"]
      darkTheme: CodexAppearanceThemeSettings["dark"]
    }) => updateAppearance({ ...appearance, ...theme }),
    [appearance, updateAppearance]
  )

  return {
    theme: {
      theme: appearance.theme,
      lightTheme: appearance.lightTheme,
      darkTheme: appearance.darkTheme,
    },
    updateTheme,
  }
}

export function usePreferences() {
  const { appearance, updateAppearance } = useAppearance()

  const updatePreferences = useCallback(
    (preferences: AppearancePreferences) => updateAppearance({ ...appearance, ...preferences }),
    [appearance, updateAppearance]
  )

  return {
    preferences: {
      codeFontSize: appearance.codeFontSize,
      reducedMotionPreference: appearance.reducedMotionPreference,
      uiFontSize: appearance.uiFontSize,
      useFontSmoothing: appearance.useFontSmoothing,
      usePointerCursors: appearance.usePointerCursors,
    },
    updatePreferences,
  }
}

export function useAppearanceController() {
  const { appearance, syncAppearance } = useAppearance()

  useLayoutEffect(() => {
    const applyTheme = (mode: CypheriaThemeMode) => {
      applyCypheriaThemeToElement(
        mapCodexAppearanceToCypheriaThemeState(
          { light: appearance.lightTheme, dark: appearance.darkTheme },
          mode
        ),
        document.documentElement
      )
    }

    applyAppearanceToElement(appearance, document.documentElement)

    if (appearance.theme !== "system") {
      return
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleSystemThemeChange = () => applyTheme(mediaQuery.matches ? "dark" : "light")
    mediaQuery.addEventListener("change", handleSystemThemeChange)
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange)
  }, [appearance])

  useEffect(() => {
    let cancelled = false

    void window.cypheria?.settings.getAppearance().then((settings) => {
      if (!cancelled) {
        syncAppearance(settings)
      }
    })

    return () => {
      cancelled = true
    }
  }, [syncAppearance])
}
