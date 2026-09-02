import { StartClient } from "@tanstack/react-start/client"
import { StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"

import "@cypheria/ui/styles.css"
import { applyAppearanceToElement, defaultAppearanceSettings } from "./appearance.js"

applyAppearanceToElement(
  window.cypheria?.bootstrap.appearance ?? defaultAppearanceSettings,
  document.documentElement
)

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>
)
