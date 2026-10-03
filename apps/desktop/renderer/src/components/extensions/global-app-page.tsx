import type { ExtensionAppInstance, ExtensionDisplayMode } from "@cypheria/protocol"
import { Spinner } from "@cypheria/ui/components/spinner"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useMemo, useRef, useState } from "react"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { Route } from "../../routes/plugins_.$pluginId.app.$tool.js"
import { McpAppHost } from "../mcp-app-host.js"
import { setWorkspaceThread, useWorkspaceThread, WorkspaceChat } from "../workspace-chat.js"
import { useExtensionCatalog } from "./catalog.js"

/** The workspace chat of a plugin's global entry point. */
export const mcpAppWorkspaceKey = (entrypointId: string) => `mcp-app:${entrypointId}`

/**
 * A plugin's global entry point, laid out as ChatGPT Desktop's workspace pages are: the App fills
 * the page, and a chat floats at the bottom right. The first message creates an ordinary chat
 * that stays on the page, and the App follows whichever chat the page shows, so its context and
 * messages go there without reopening it. Every client returns to the same chat on this page.
 */
export default function GlobalAppPage() {
  const { pluginId, tool } = Route.useParams()
  const { path } = Route.useSearch()
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const catalog = useExtensionCatalog()
  const entrypoint = catalog?.entrypoints.find(
    (entry) => entry.type === "global" && entry.pluginId === pluginId && entry.tool === tool
  )
  const workspaceKey = entrypoint ? mcpAppWorkspaceKey(entrypoint.id) : null
  const chat = useWorkspaceThread(workspaceKey)
  const [displayMode, setDisplayMode] = useState<ExtensionDisplayMode>("fullscreen")
  const instance = useRef<ExtensionAppInstance | null>(null)
  /** The chat the App opened with; later chats reach it by binding, not by reopening. */
  const [openedWith, setOpenedWith] = useState<{ key: string; threadId: string | null } | null>(
    null
  )
  if (workspaceKey && chat.isSuccess && openedWith?.key !== workspaceKey) {
    setOpenedWith({ key: workspaceKey, threadId: chat.data ?? null })
  }
  const target = useMemo(
    () =>
      entrypoint && openedWith
        ? {
            entrypointId: entrypoint.id,
            kind: "entrypoint" as const,
            ...(path ? { deepLink: path } : {}),
            ...(openedWith.threadId ? { threadId: openedWith.threadId } : {}),
          }
        : null,
    [entrypoint, openedWith, path]
  )
  const bind = useCallback(async (threadId: string | null) => {
    const current = instance.current
    if (!current || current.threadId === threadId) return
    instance.current = await (await ensureCypheriaClient()).extensions.bind(current.id, threadId)
  }, [])
  const showThread = useCallback(
    (threadId: string | null) => void bind(threadId).catch(() => undefined),
    [bind]
  )

  if (!catalog) {
    return (
      <main className="grid h-full place-items-center text-muted-foreground">
        <Spinner />
      </main>
    )
  }
  if (!entrypoint || !workspaceKey) {
    return (
      <main className="grid h-full place-items-center px-8 text-center text-muted-foreground text-sm">
        <Trans id="extension.global.unavailable">
          This plugin page is unavailable. Check that the plugin is installed and enabled.
        </Trans>
      </main>
    )
  }

  return (
    <main className="relative h-full min-h-0 bg-background">
      {target ? (
        <McpAppHost
          displayMode={displayMode}
          target={target}
          onInstance={(opened) => {
            instance.current = opened
          }}
          onMessageThread={(threadId) => {
            void setWorkspaceThread(workspaceKey, threadId)
            return true
          }}
          onRequestDisplayMode={(mode) => {
            setDisplayMode(mode)
            return mode
          }}
        />
      ) : (
        <div className="grid h-full place-items-center text-muted-foreground">
          <Spinner />
        </div>
      )}
      <WorkspaceChat
        agentId={entrypoint.agentId ?? "codex"}
        placeholder={i18n._(
          msg({ id: "extension.global.placeholder", message: `Ask about ${entrypoint.title}` })
        )}
        workspaceKey={workspaceKey}
        onOpenThread={(threadId) =>
          void navigate({ search: { app: entrypoint.id, thread: threadId }, to: "/" })
        }
        onThreadCreated={bind}
        onThreadShown={showThread}
      />
    </main>
  )
}
