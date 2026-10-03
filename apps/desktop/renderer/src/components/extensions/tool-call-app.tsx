import type { ExtensionDisplayMode, ThreadToolApp } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import { cn } from "@cypheria/ui/lib/utils"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Maximize2, Minimize2 } from "lucide-react"
import { useContext, useMemo, useState } from "react"

import { McpAppHost } from "../mcp-app-host.js"
import { ExtensionWorkspaceContext } from "./workspace-context.js"

const MIN_HEIGHT = 120
const MAX_HEIGHT = 720
const DEFAULT_HEIGHT = 320

/**
 * The MCP App of a model tool call, inline in the Timeline. It starts inline unless the App
 * prefers fullscreen, and switches without reloading: the same frame becomes an overlay.
 */
export function ToolCallApp({ app, itemId }: Readonly<{ app: ThreadToolApp; itemId: string }>) {
  const { i18n } = useLingui()
  const { openFile, threadId } = useContext(ExtensionWorkspaceContext)
  const [displayMode, setDisplayMode] = useState<ExtensionDisplayMode | null>(null)
  const [available, setAvailable] = useState<ExtensionDisplayMode[]>(["inline"])
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const target = useMemo(
    () => (threadId ? { itemId, kind: "tool-call" as const, threadId } : null),
    [itemId, threadId]
  )
  if (!target) return null
  const mode = displayMode ?? app.displayMode ?? "inline"
  const fullscreen = mode === "fullscreen"
  return (
    <div className="mt-2" style={fullscreen ? undefined : { height }}>
      <div
        className={cn(
          "group/app relative overflow-hidden rounded-xl border bg-background",
          fullscreen ? "fixed inset-4 z-50 shadow-2xl" : "h-full"
        )}
      >
        {available.length > 1 ? (
          <Button
            aria-label={i18n._(
              fullscreen
                ? msg({ id: "extension.app.collapse", message: "Show inline" })
                : msg({ id: "extension.app.expand", message: "Show fullscreen" })
            )}
            className="absolute top-2 right-2 z-10 opacity-0 group-hover/app:opacity-100 focus-visible:opacity-100"
            size="icon-sm"
            variant="secondary"
            onClick={() => setDisplayMode(fullscreen ? "inline" : "fullscreen")}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        ) : null}
        <McpAppHost
          displayMode={mode}
          target={target}
          onOpenFile={openFile}
          onInstance={(instance) => {
            if (!instance) return
            setAvailable(instance.availableDisplayModes)
            setDisplayMode((current) => current ?? instance.displayMode)
          }}
          onRequestDisplayMode={(next) => {
            setDisplayMode(next)
            return next
          }}
          onSizeChange={({ height: next }) => {
            if (next) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(next))))
          }}
        />
      </div>
    </div>
  )
}
