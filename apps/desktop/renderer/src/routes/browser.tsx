import { createFileRoute } from "@tanstack/react-router"
import { BROWSER_GLOBAL_SCOPE } from "../../../ipc/src/browser.js"
import { BrowserPane } from "../browser/browser-pane.js"

/** Browser tabs that are not attached to a Thread, including dApps opened from Wallets. */
export const Route = createFileRoute("/browser")({ component: BrowserRoute })

function BrowserRoute() {
  return (
    <main className="h-screen min-h-0 bg-background max-[860px]:h-[calc(100vh-48px)]">
      <BrowserPane defaultKind="dapp" scopeId={BROWSER_GLOBAL_SCOPE} />
    </main>
  )
}
