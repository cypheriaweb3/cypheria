import type { ExtensionElicitation } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Trans } from "@lingui/react/macro"
import { ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { ElicitationForm } from "./elicitation-form.js"

/**
 * Forms and links MCP servers ask for during calls this client made for an App, settings, or a
 * mention search. They come only to the client that made the call, one at a time.
 */
export function ExtensionElicitations() {
  const [queue, setQueue] = useState<ExtensionElicitation[]>([])
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let disposed = false
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribe = client.on("extension.elicitation.notification", (message) => {
        setQueue((current) => [...current, message.payload])
      })
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])
  const current = queue[0]
  const respond = (action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => {
    if (!current) return
    setQueue((pending) => pending.slice(1))
    void ensureCypheriaClient().then((client) =>
      client.extensions.respondElicitation({
        action,
        ...(content ? { content } : {}),
        elicitationId: current.id,
      })
    )
  }
  return (
    <Dialog open={Boolean(current)} onOpenChange={(open) => (open ? undefined : respond("cancel"))}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current?.server}</DialogTitle>
          <DialogDescription>{current?.message}</DialogDescription>
        </DialogHeader>
        {current?.mode === "url" && current.url ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => respond("decline")}>
              <Trans id="chat.interaction.decline">Decline</Trans>
            </Button>
            <Button
              onClick={() => {
                const url = current.url as string
                if (/^https?:\/\//iu.test(url)) void window.cypheria?.app.openExternal(url)
                respond("accept")
              }}
            >
              <Trans id="extension.form.openLink">Open</Trans>
              <ExternalLink className="size-4" />
            </Button>
          </div>
        ) : current ? (
          <ElicitationForm key={current.id} schema={current.requestedSchema} onRespond={respond} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
