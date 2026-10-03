import type { ExtensionEntrypoint } from "@cypheria/protocol"
import { ChatMcpAppPanel } from "@cypheria/ui/components/chat"
import { Trans } from "@lingui/react/macro"
import { useContext, useMemo } from "react"

import { McpAppHost } from "../mcp-app-host.js"
import { ExtensionWorkspaceContext } from "./workspace-context.js"

/** The side panel tab ID of a plugin entry point. */
export const extensionTabId = (entrypointId: string): string => `extension:${entrypointId}`

/**
 * A plugin's App in a conversation's side panel: a Thread entry point, or a global entry point
 * the chat began from. Each Thread has its own instance, which every client showing it shares.
 */
export function ExtensionAppPanel({
  entrypoint,
  threadId,
}: Readonly<{ entrypoint: ExtensionEntrypoint; threadId: string | null }>) {
  const { openFile } = useContext(ExtensionWorkspaceContext)
  const target = useMemo(
    () =>
      threadId ? { entrypointId: entrypoint.id, kind: "entrypoint" as const, threadId } : null,
    [entrypoint.id, threadId]
  )
  return (
    <ChatMcpAppPanel>
      {target ? (
        <McpAppHost displayMode="fullscreen" target={target} onOpenFile={openFile} />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
          <Trans id="chat.panel.extension.noThread">
            Start the chat to open {entrypoint.title}
          </Trans>
        </div>
      )}
    </ChatMcpAppPanel>
  )
}
