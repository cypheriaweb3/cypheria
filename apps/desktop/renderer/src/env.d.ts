import type { CypheriaPreloadApi } from "@cypheria/ipc"

declare global {
  interface Window {
    readonly cypheria?: CypheriaPreloadApi
  }
}
