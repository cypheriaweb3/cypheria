import { StartClient } from "@tanstack/react-start/client"
import { StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"

import "@cypheria/ui/styles.css"

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>
)
