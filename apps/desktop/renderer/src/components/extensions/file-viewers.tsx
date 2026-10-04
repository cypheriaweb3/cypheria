import { BUILTIN_FILE_VIEWER } from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import { chatFilePreviewKind } from "@cypheria/ui/components/chat/file-preview"
import { cn } from "@cypheria/ui/lib/utils"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useContext, useMemo, useState } from "react"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { McpAppHost } from "../mcp-app-host.js"
import { useExtensionCatalog } from "./catalog.js"
import { ExtensionIcon } from "./extension-icon.js"
import {
  ExtensionWorkspaceContext,
  fileHandlers,
  fileViewerExtension,
  pickFileViewer,
} from "./workspace-context.js"

const serverConfigKey = ["settings", "server-config"] as const

/**
 * A workspace file tab with plugin file viewers. The file opens in the viewer the person chose
 * for its extension, else in Cypheria's own viewer when it previews the type, else in the plugin
 * viewer with the longest matching extension. Choosing a viewer saves it for the extension in
 * Server configuration (`workspace.fileViewers`), so every client opens such files the same way.
 */
export function ExtensionFileViewers({
  children,
  file,
}: Readonly<{ children: ReactNode; file: { path: string; root: string } }>) {
  const catalog = useExtensionCatalog()
  const { openFile, threadId } = useContext(ExtensionWorkspaceContext)
  const queryClient = useQueryClient()
  const handlers = useMemo(
    () =>
      fileHandlers(
        file.path,
        (catalog?.entrypoints ?? []).filter((entry) => entry.type === "file")
      ),
    [catalog, file.path]
  )
  const extension = useMemo(() => fileViewerExtension(file.path, handlers), [file.path, handlers])
  const config = useQuery({
    enabled: handlers.length > 0,
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    queryKey: serverConfigKey,
    retry: false,
  })
  const remember = useMutation({
    mutationFn: async (viewerId: string) =>
      (await ensureCypheriaClient()).server.patchConfig({
        workspace: { fileViewers: { [extension as string]: viewerId } },
      }),
    onSuccess: (snapshot) => queryClient.setQueryData(serverConfigKey, snapshot),
  })
  // The choice shows at once; the saved preference catches up when the Server confirms it.
  const [chosen, setChosen] = useState<string | null>(null)
  const viewerId =
    chosen ??
    pickFileViewer({
      builtin: BUILTIN_FILE_VIEWER,
      builtinPreviews: chatFilePreviewKind(file.path) !== null,
      handlers,
      preferred: extension ? config.data?.config.workspace.fileViewers[extension] : undefined,
    })
  const viewer = handlers.find((handler) => handler.id === viewerId) ?? null
  const choose = (id: string) => {
    setChosen(id)
    if (extension) remember.mutate(id)
  }
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
          onClick={() => choose(BUILTIN_FILE_VIEWER)}
        >
          <Trans id="extension.fileViewer.builtin">Source</Trans>
        </Button>
        {handlers.map((handler) => (
          <Button
            key={handler.id}
            className={cn(viewer?.id === handler.id && "bg-muted")}
            size="sm"
            variant="ghost"
            onClick={() => choose(handler.id)}
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
