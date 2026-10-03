import { Button } from "@cypheria/ui/components/button"
import { cn } from "@cypheria/ui/lib/utils"
import { Trans } from "@lingui/react/macro"
import { type ReactNode, useContext, useMemo, useState } from "react"

import { McpAppHost } from "../mcp-app-host.js"
import { useExtensionCatalog } from "./catalog.js"
import { ExtensionIcon } from "./extension-icon.js"
import { ExtensionWorkspaceContext, fileHandlers } from "./workspace-context.js"

/**
 * A workspace file tab with plugin file viewers. A file entry point whose extensions match the
 * file replaces the built-in viewer, the longest match first; the built-in viewer stays one click
 * away.
 */
export function ExtensionFileViewers({
  children,
  file,
}: Readonly<{ children: ReactNode; file: { path: string; root: string } }>) {
  const catalog = useExtensionCatalog()
  const { openFile, threadId } = useContext(ExtensionWorkspaceContext)
  const handlers = useMemo(
    () =>
      fileHandlers(
        file.path,
        (catalog?.entrypoints ?? []).filter((entry) => entry.type === "file")
      ),
    [catalog, file.path]
  )
  const [chosen, setChosen] = useState<string | null>(null)
  const viewer =
    chosen === "builtin" ? null : (handlers.find((h) => h.id === chosen) ?? handlers[0])
  const absolute = `${file.root.replace(/[\\/]+$/u, "")}/${file.path}`
  const target = useMemo(
    () =>
      viewer && threadId
        ? { entrypointId: viewer.id, kind: "entrypoint" as const, path: absolute, threadId }
        : null,
    [absolute, threadId, viewer]
  )
  if (handlers.length === 0 || !threadId) return <>{children}</>
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <Button
          className={cn(!viewer && "bg-muted")}
          size="sm"
          variant="ghost"
          onClick={() => setChosen("builtin")}
        >
          <Trans id="extension.fileViewer.builtin">Source</Trans>
        </Button>
        {handlers.map((handler) => (
          <Button
            key={handler.id}
            className={cn(viewer?.id === handler.id && "bg-muted")}
            size="sm"
            variant="ghost"
            onClick={() => setChosen(handler.id)}
          >
            <ExtensionIcon icon={handler.icon} />
            {handler.title}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {target ? (
          <McpAppHost displayMode="fullscreen" target={target} onOpenFile={openFile} />
        ) : (
          children
        )}
      </div>
    </div>
  )
}
