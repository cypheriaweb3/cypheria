import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react"

import {
  type CypheriaThemeMode,
  type CypheriaThemeState,
  type CypheriaThemeVariableName,
  applyCypheriaThemeToElement,
  createCypheriaThemeState,
  defaultCypheriaThemeState,
} from "./theme.js"

const storageKey = "cypheria-theme"

interface CypheriaThemeContextValue {
  themeState: CypheriaThemeState
  setMode: (mode: CypheriaThemeMode) => void
  setThemeState: (state: CypheriaThemeState) => void
  updateThemeVariable: (
    mode: CypheriaThemeMode,
    variableName: CypheriaThemeVariableName,
    value: string
  ) => void
}

const CypheriaThemeContext = createContext<CypheriaThemeContextValue | null>(null)

function getInitialThemeState() {
  if (typeof window === "undefined") {
    return defaultCypheriaThemeState
  }

  try {
    const persistedState = window.localStorage.getItem(storageKey)
    if (persistedState) {
      return createCypheriaThemeState(JSON.parse(persistedState))
    }
  } catch {
    window.localStorage.removeItem(storageKey)
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  return createCypheriaThemeState({ currentMode: prefersDark ? "dark" : "light" })
}

export function CypheriaThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [themeState, setThemeState] = useState<CypheriaThemeState>(getInitialThemeState)

  useLayoutEffect(() => {
    applyCypheriaThemeToElement(themeState, document.documentElement)
    window.localStorage.setItem(storageKey, JSON.stringify(themeState))
  }, [themeState])

  const setMode = useCallback((mode: CypheriaThemeMode) => {
    setThemeState((current) => ({ ...current, currentMode: mode }))
  }, [])

  const updateThemeVariable = useCallback(
    (mode: CypheriaThemeMode, variableName: CypheriaThemeVariableName, value: string) => {
      setThemeState((current) => ({
        ...current,
        styles: {
          ...current.styles,
          [mode]: {
            ...current.styles[mode],
            [variableName]: value,
          },
        },
      }))
    },
    []
  )

  const value = useMemo(
    () => ({ themeState, setMode, setThemeState, updateThemeVariable }),
    [themeState, setMode, updateThemeVariable]
  )

  return <CypheriaThemeContext.Provider value={value}>{children}</CypheriaThemeContext.Provider>
}

export function useCypheriaTheme() {
  const context = useContext(CypheriaThemeContext)
  if (!context) {
    throw new Error("useCypheriaTheme must be used within CypheriaThemeProvider")
  }
  return context
}
