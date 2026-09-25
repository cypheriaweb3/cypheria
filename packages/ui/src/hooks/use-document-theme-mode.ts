import { useSyncExternalStore } from "react"

import type { CypheriaThemeMode } from "../theme.js"

const readThemeMode = (): CypheriaThemeMode =>
  document.documentElement.classList.contains("dark") ? "dark" : "light"

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributeFilter: ["class"], attributes: true })
  return () => observer.disconnect()
}

/**
 * Follows the mode `applyCypheriaThemeToElement` writes to the document root. Components that
 * render into shadow roots or resolve their own light/dark tokens use it instead of
 * `prefers-color-scheme`, which ignores an explicit Cypheria appearance choice.
 */
export function useDocumentThemeMode(): CypheriaThemeMode {
  return useSyncExternalStore(subscribe, readThemeMode, () => "light")
}
