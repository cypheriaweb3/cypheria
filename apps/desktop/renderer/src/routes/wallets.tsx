import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import { Input } from "@cypheria/ui/components/input"
import { createFileRoute } from "@tanstack/react-router"
import { Globe2, ShieldCheck, WalletCards } from "lucide-react"
import { useState } from "react"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/wallets")({ component: WalletsRoute })

function WalletsRoute() {
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const open = async () => {
    try {
      setError(null)
      if (!window.cypheria)
        throw new Error("The dApp browser is only available in the desktop app.")
      await window.cypheria.browser.openDapp(new URL(url).toString())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <WalletCards className="size-5" />
          Wallets & dApp browser
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wallet state and signing remain in the privileged runtime, outside the renderer and Codex.
        </p>
      </header>
      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>No signing authority in chat</AlertTitle>
        <AlertDescription>
          Agent and dApp requests create signing intents. Policy evaluation and any required human
          approval happen before a signature.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="size-4" />
            Open isolated dApp session
          </CardTitle>
          <CardDescription>
            Each origin receives an isolated browser session and explicit wallet permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void open()
            }}
          >
            <Input
              placeholder="https://app.example"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            <Button type="submit">Open</Button>
          </form>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </WorkbenchFrame>
  )
}
