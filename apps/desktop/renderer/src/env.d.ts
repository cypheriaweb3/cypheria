import type { CypheriaPreloadApi } from "../../ipc/src/index.js"

declare global {
  interface Window {
    readonly cypheria?: CypheriaPreloadApi
  }
}
