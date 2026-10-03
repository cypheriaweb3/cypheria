import type {
  ExtensionAppInstance,
  ExtensionAppTarget,
  ExtensionDisplayMode,
} from "@cypheria/protocol"
import { Spinner } from "@cypheria/ui/components/spinner"
import { cn } from "@cypheria/ui/lib/utils"
import { useLingui } from "@lingui/react"
import {
  AppBridge,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"

import { ensureCypheriaClient } from "../cypheria-client.js"

/** A Cypheria host request a bundled plugin's App sends next to the MCP Apps messages. */
export type McpAppExtensionHandler = (params: Record<string, unknown>) => Promise<unknown>

/** Sends host notifications to the App, such as a sidebar selection. */
export type McpAppNotifier = (method: string, params: Record<string, unknown>) => void

/** The proxy page's scheme; Electron main serves it on a separate origin per App. */
const SANDBOX_SCHEME = "cypheria-sandbox"
/** The outer frame's limits, which bound everything the App frame inside it can do. */
const PROXY_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
/** The App frame's flags inside the proxy. */
const APP_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
const OPENAI_HANDLED_METHODS = [
  "resources/subscribe",
  "resources/unsubscribe",
  "openai/resources/write",
  "openai/files/open",
] as const

const openExternal = async (url: string): Promise<void> => {
  if (!window.cypheria) throw new Error("The system browser is unavailable")
  await window.cypheria.app.openExternal(url)
}

/** The standard MCP Apps style variables, from the theme Desktop currently shows. */
const hostStyles = (): Record<string, string> => {
  const style = getComputedStyle(document.documentElement)
  const value = (name: string) => style.getPropertyValue(name).trim()
  return Object.fromEntries(
    Object.entries({
      "--border-radius-md": value("--radius"),
      "--color-background-inverse": value("--primary"),
      "--color-background-primary": value("--background"),
      "--color-background-secondary": value("--muted"),
      "--color-background-tertiary": value("--accent"),
      "--color-border-primary": value("--border"),
      "--color-ring-primary": value("--ring"),
      "--color-text-danger": value("--destructive"),
      "--color-text-inverse": value("--primary-foreground"),
      "--color-text-primary": value("--foreground"),
      "--color-text-secondary": value("--muted-foreground"),
      "--font-sans": style.fontFamily,
    }).filter(([, entry]) => entry)
  )
}

const UiMetaSchema = z
  .object({
    ui: z
      .object({
        csp: z
          .object({
            baseUriDomains: z.array(z.string()).optional(),
            connectDomains: z.array(z.string()).optional(),
            frameDomains: z.array(z.string()).optional(),
            resourceDomains: z.array(z.string()).optional(),
          })
          .optional(),
        permissions: z
          .object({
            camera: z.object({}).passthrough().optional(),
            clipboardWrite: z.object({}).passthrough().optional(),
            geolocation: z.object({}).passthrough().optional(),
            microphone: z.object({}).passthrough().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough()

/** `https://` origins, optionally with a `*.` subdomain wildcard, or `data:` and `blob:`. */
const sourceList = (values: readonly string[] | undefined, schemes = false): string[] =>
  (values ?? []).filter(
    (source) =>
      /^https:\/\/(?:\*\.)?[\w.-]+(?::\d+)?$/u.test(source) ||
      (schemes && (source === "data:" || source === "blob:"))
  )

/**
 * The App document with the Content Security Policy the MCP Apps specification derives from its
 * resource metadata: inline scripts and styles, the declared resource origins for scripts,
 * styles, images, fonts, and media, and only the declared origins to connect, frame, or use as
 * a base URI.
 */
export const withAppPolicy = (html: string, meta: Record<string, unknown>): string => {
  const csp = UiMetaSchema.safeParse(meta).data?.ui?.csp
  const resources = sourceList(csp?.resourceDomains, true)
  const connect = sourceList(csp?.connectDomains)
  const frames = sourceList(csp?.frameDomains)
  const bases = sourceList(csp?.baseUriDomains)
  const list = (base: string[], extra: string[]) => [...base, ...extra].join(" ")
  const policy = [
    "default-src 'none'",
    `script-src ${list(["'self'", "'unsafe-inline'"], resources)}`,
    `style-src ${list(["'self'", "'unsafe-inline'"], resources)}`,
    `img-src ${list(["'self'", "data:", "blob:"], resources)}`,
    `font-src ${list(["'self'", "data:"], resources)}`,
    `media-src ${list(["'self'", "data:", "blob:"], resources)}`,
    `connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
    `frame-src ${frames.length > 0 ? frames.join(" ") : "'none'"}`,
    `base-uri ${bases.length > 0 ? bases.join(" ") : "'self'"}`,
  ].join("; ")
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  return /<head[^>]*>/iu.test(html)
    ? html.replace(/<head[^>]*>/iu, (head) => `${head}${tag}`)
    : `${tag}${html}`
}

/** A separate sandbox origin for each App: its Agent, plugin, server, and resource. */
const sandboxOrigin = async (instance: ExtensionAppInstance): Promise<string> => {
  const identity = JSON.stringify([
    instance.agentId,
    instance.pluginId,
    instance.server,
    instance.resourceUri,
  ])
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `${SANDBOX_SCHEME}://a${hex}/`
}

const hostCapabilities = (instance: ExtensionAppInstance): McpUiHostCapabilities => {
  const { capabilities } = instance
  const blocks = { image: {}, resource: {}, resourceLink: {}, structuredContent: {}, text: {} }
  const ui = UiMetaSchema.safeParse(instance.resourceMeta).data?.ui
  return {
    experimental: {
      ...(capabilities.modelContext ? { "openai/modelContext": {} } : {}),
      ...(capabilities.message ? { "openai/message": {} } : {}),
      ...(capabilities.openFiles ? { "openai/files": {} } : {}),
      ...(capabilities.resource ? { "openai/resource": {} } : {}),
    },
    logging: {},
    openLinks: {},
    ...(capabilities.message ? { message: blocks } : {}),
    sandbox: {
      ...(ui?.permissions ? { permissions: ui.permissions } : {}),
      ...(ui?.csp ? { csp: ui.csp } : {}),
    },
    ...(capabilities.serverResources || capabilities.resource ? { serverResources: {} } : {}),
    ...(capabilities.toolCalls ? { serverTools: {} } : {}),
    ...(capabilities.modelContext ? { updateModelContext: blocks } : {}),
  } as McpUiHostCapabilities
}

/**
 * Hosts one MCP App. The Server opens the App instance and answers its requests; this frame runs
 * the App on its own sandbox origin through the MCP Apps sandbox proxy, with `AppBridge` speaking
 * MCP Apps and the OpenAI extensions the instance supports. Bundled plugins' Cypheria host
 * requests go to `extensions`.
 */
export function McpAppHost({
  className,
  displayMode: requestedDisplayMode,
  extensions,
  onInstance,
  onMessageThread,
  onNotifier,
  onOpenFile,
  onOpenLink,
  onRequestDisplayMode,
  onSizeChange,
  target,
}: Readonly<{
  className?: string
  /** The display mode the surrounding surface shows the App in. */
  displayMode?: ExtensionDisplayMode
  extensions?: Record<string, McpAppExtensionHandler>
  onInstance?: (instance: ExtensionAppInstance | null) => void
  /**
   * The App sent a message to another chat or started one. True when the surface shows that chat
   * itself; otherwise the chat opens with the App beside it.
   */
  onMessageThread?: (threadId: string) => boolean
  onNotifier?: (notify: McpAppNotifier | null) => void
  /** Opens a workspace file the App asked for with `openai/files/open`. */
  onOpenFile?: (path: string) => void
  onOpenLink?: (url: string) => Promise<boolean>
  /** Asks the surface for another display mode; returns the mode it now shows. */
  onRequestDisplayMode?: (mode: ExtensionDisplayMode) => ExtensionDisplayMode
  onSizeChange?: (size: { height?: number; width?: number }) => void
  target: ExtensionAppTarget
}>) {
  const { i18n } = useLingui()
  const frame = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState<string | null>(null)
  const callbacks = useRef({
    extensions,
    onInstance,
    onMessageThread,
    onNotifier,
    onOpenFile,
    onOpenLink,
    onRequestDisplayMode,
    onSizeChange,
  })
  callbacks.current = {
    onOpenFile,
    extensions,
    onInstance,
    onMessageThread,
    onNotifier,
    onOpenLink,
    onRequestDisplayMode,
    onSizeChange,
  }
  const bridgeRef = useRef<AppBridge | null>(null)
  const contextRef = useRef<McpUiHostContext | null>(null)
  const targetKey = JSON.stringify(target)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const requestedDisplayModeRef = useRef(requestedDisplayMode)
  requestedDisplayModeRef.current = requestedDisplayMode

  useEffect(() => {
    const bridge = bridgeRef.current
    const context = contextRef.current
    if (!bridge || !context || !requestedDisplayMode) return
    if (context.displayMode === requestedDisplayMode) return
    contextRef.current = { ...context, displayMode: requestedDisplayMode }
    void bridge.sendHostContextChange({ displayMode: requestedDisplayMode })
  }, [requestedDisplayMode])

  useEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    let disposed = false
    let bridge: AppBridge | null = null
    let instance: ExtensionAppInstance | null = null
    let unsubscribe: (() => void) | null = null
    const observer = new MutationObserver(() => {
      if (!bridge || !contextRef.current) return
      const theme = document.documentElement.classList.contains("dark") ? "dark" : "light"
      const styles = { variables: hostStyles() } as McpUiHostContext["styles"]
      contextRef.current = { ...contextRef.current, styles, theme }
      void bridge.sendHostContextChange({ styles, theme })
    })
    const start = async () => {
      setState("loading")
      setError(null)
      const client = await ensureCypheriaClient()
      const opened = await client.extensions.open(JSON.parse(targetKey) as ExtensionAppTarget)
      if (disposed) {
        void client.extensions.close(opened.id).catch(() => undefined)
        return
      }
      instance = opened
      callbacks.current.onInstance?.(opened)
      const resource = await client.extensions.readResource(opened.id)
      const sandbox = await sandboxOrigin(opened)
      if (disposed) return
      const displayMode = requestedDisplayModeRef.current ?? opened.displayMode
      contextRef.current = {
        ...opened.hostContext,
        availableDisplayModes: opened.availableDisplayModes,
        displayMode,
        locale: i18n.locale,
        "openai/interactionCursor": "pointer",
        platform: "desktop",
        styles: { variables: hostStyles() } as McpUiHostContext["styles"],
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        toolInfo: { tool: { inputSchema: { type: "object" }, name: opened.tool } },
      } as McpUiHostContext
      bridge = new AppBridge(null, { name: "Cypheria", version: "1.0.0" }, hostCapabilities(opened))
      bridgeRef.current = bridge
      bridge.setHostContext(contextRef.current)
      const forward = (method: string) => async (params: unknown) =>
        client.extensions.request(opened.id, method, (params ?? {}) as Record<string, unknown>)
      bridge.oncalltool = (async (params: unknown) =>
        forward("tools/call")(params)) as unknown as AppBridge["oncalltool"]
      bridge.onreadresource = (async (params: unknown) =>
        forward("resources/read")(params)) as unknown as AppBridge["onreadresource"]
      bridge.onupdatemodelcontext = (async (params: unknown) =>
        forward("ui/update-model-context")(params)) as unknown as AppBridge["onupdatemodelcontext"]
      bridge.onmessage = (async (params: unknown) => {
        const result = (await forward("ui/message")(params)) as {
          _meta?: { "cypheria/threadId"?: string }
        }
        // A message the App sent to another chat, or a chat it started, opens that chat beside it.
        const threadId = result?._meta?.["cypheria/threadId"]
        if (
          threadId &&
          threadId !== opened.threadId &&
          !callbacks.current.onMessageThread?.(threadId)
        ) {
          const target = JSON.parse(targetKey) as ExtensionAppTarget
          void navigateRef.current({
            search: {
              ...(target.kind === "entrypoint" ? { app: target.entrypointId } : {}),
              thread: threadId,
            },
            to: "/",
          })
        }
        return {}
      }) as unknown as AppBridge["onmessage"]
      bridge.onopenlink = async ({ url }) => {
        if (!(await callbacks.current.onOpenLink?.(url))) await openExternal(url)
        return {}
      }
      bridge.onrequestdisplaymode = async ({ mode }) => {
        const wanted = mode === "fullscreen" || mode === "inline" ? mode : null
        const current = (contextRef.current?.displayMode ?? displayMode) as ExtensionDisplayMode
        const next =
          wanted && opened.availableDisplayModes.includes(wanted)
            ? (callbacks.current.onRequestDisplayMode?.(wanted) ?? current)
            : current
        if (contextRef.current && next !== contextRef.current.displayMode) {
          contextRef.current = { ...contextRef.current, displayMode: next }
          void bridge?.sendHostContextChange({ displayMode: next })
        }
        return { mode: next }
      }
      bridge.onsizechange = (size) => callbacks.current.onSizeChange?.(size)
      for (const method of OPENAI_HANDLED_METHODS) {
        bridge.setRequestHandler(
          method,
          { params: z.record(z.string(), z.unknown()).optional() },
          async (params) => {
            const result = (await forward(method)(params ?? {})) as Record<string, unknown>
            if (method !== "openai/files/open") return result
            // The Server checked the path is in the chat's workspace; the chat opens it.
            const file = (result._meta as { "cypheria/file"?: { path?: string } } | undefined)?.[
              "cypheria/file"
            ]
            if (file?.path) callbacks.current.onOpenFile?.(file.path)
            return {}
          }
        )
      }
      for (const method of Object.keys(callbacks.current.extensions ?? {})) {
        if (!opened.capabilities.host.some((prefix) => method.startsWith(prefix))) continue
        bridge.setRequestHandler(
          method,
          { params: z.record(z.string(), z.unknown()) },
          async (params) => {
            const handler = callbacks.current.extensions?.[method]
            if (!handler) return { error: { message: `${method} is unavailable` } }
            try {
              return { value: (await handler((params ?? {}) as Record<string, unknown>)) ?? null }
            } catch (failure) {
              const reason = failure as { message?: string; kind?: string; retryAt?: number }
              return {
                error: {
                  message: reason.message ?? String(failure),
                  ...(reason.kind ? { kind: reason.kind } : {}),
                  ...(reason.retryAt ? { retryAt: reason.retryAt } : {}),
                },
              }
            }
          }
        )
      }
      bridge.onsandboxready = () => {
        const permissions = UiMetaSchema.safeParse(opened.resourceMeta).data?.ui?.permissions
        void bridge?.sendSandboxResourceReady({
          html: withAppPolicy(resource.text, opened.resourceMeta),
          ...(permissions ? { permissions } : {}),
          sandbox: APP_SANDBOX,
        })
      }
      bridge.oninitialized = () => {
        if (disposed || !bridge) return
        setState("ready")
        void bridge.sendToolInput({ arguments: opened.toolInput })
        if (opened.toolResult) void bridge.sendToolResult(opened.toolResult as never)
        else if (opened.toolError) void bridge.sendToolCancelled({ reason: opened.toolError })
      }
      unsubscribe = client.on("extension.app.notification", (message) => {
        if (message.payload.instanceId !== opened.id || !bridge) return
        if (message.payload.method === "ui/notifications/host-context-changed") {
          contextRef.current = {
            ...contextRef.current,
            ...message.payload.params,
          } as McpUiHostContext
          void bridge.sendHostContextChange(message.payload.params as never)
          return
        }
        void bridge.notification({
          method: message.payload.method,
          params: message.payload.params,
        } as never)
      })
      const window_ = iframe.contentWindow
      if (!window_) throw new Error("The MCP App frame is unavailable")
      await bridge.connect(new PostMessageTransport(window_, window_))
      callbacks.current.onNotifier?.((method, params) => {
        void bridge?.notification({ method, params } as never)
      })
      observer.observe(document.documentElement, {
        attributeFilter: ["class", "style"],
        attributes: true,
      })
      setOrigin(sandbox)
    }
    start().catch((failure: unknown) => {
      if (disposed) return
      setError(failure instanceof Error ? failure.message : String(failure))
      setState("error")
    })
    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe?.()
      callbacks.current.onNotifier?.(null)
      callbacks.current.onInstance?.(null)
      bridgeRef.current = null
      contextRef.current = null
      setOrigin(null)
      void bridge?.close()
      if (instance) {
        const id = instance.id
        void ensureCypheriaClient()
          .then((client) => client.extensions.close(id))
          .catch(() => undefined)
      }
    }
  }, [targetKey, i18n.locale])

  return (
    <div className={cn("relative h-full min-h-0 w-full", className)}>
      <iframe
        ref={frame}
        className={cn("h-full w-full border-0 bg-background", state !== "ready" && "invisible")}
        sandbox={PROXY_SANDBOX}
        src={origin ?? undefined}
        title={target.kind === "tool" ? target.tool : "MCP App"}
      />
      {state === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Spinner />
        </div>
      ) : null}
      {state === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {error}
        </div>
      ) : null}
    </div>
  )
}
