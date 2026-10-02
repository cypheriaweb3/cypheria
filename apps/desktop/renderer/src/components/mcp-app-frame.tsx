import type { McpAppResourceContent } from "@cypheria/protocol"
import { Spinner } from "@cypheria/ui/components/spinner"
import { cn } from "@cypheria/ui/lib/utils"
import { useLingui } from "@lingui/react"
import {
  AppBridge,
  type McpUiHostContext,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"

import { ensureCypheriaClient } from "../cypheria-client.js"

/** A Cypheria host request an App sends next to the standard MCP Apps messages. */
export type McpAppExtensionHandler = (params: Record<string, unknown>) => Promise<unknown>

/** Sends Cypheria host notifications to the App, such as a sidebar selection. */
export type McpAppNotifier = (method: string, params: Record<string, unknown>) => void

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

const CspSchema = z
  .object({
    ui: z
      .object({
        csp: z
          .object({
            resourceDomains: z.array(z.string()).optional(),
            connectDomains: z.array(z.string()).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .optional()

/**
 * The App document with a Content Security Policy from its resource metadata. Scripts and styles
 * run inline only; images and media load from the domains the App declares; nothing else connects.
 */
const withPolicy = (content: McpAppResourceContent): string => {
  const csp = CspSchema.safeParse(content._meta).data?.ui?.csp
  const sources = (csp?.resourceDomains ?? []).filter((source) =>
    /^(?:https:\/\/[\w.-]+|data:|blob:)$/u.test(source)
  )
  const connect = (csp?.connectDomains ?? []).filter((source) =>
    /^https:\/\/[\w.-]+$/u.test(source)
  )
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src ${["data:", "blob:", ...sources].join(" ")}`,
    `media-src ${["data:", "blob:", ...sources].join(" ")}`,
    "font-src data:",
    `connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
  ].join("; ")
  const html = content.text ?? ""
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  return /<head[^>]*>/iu.test(html)
    ? html.replace(/<head[^>]*>/iu, (head) => `${head}${meta}`)
    : `${meta}${html}`
}

/**
 * Hosts one MCP App in a sandboxed frame. The frame has an opaque origin, no Node.js, and no
 * network beyond its declared media; its tool calls and resource reads reach the Server through
 * this host. Cypheria extension requests go to `extensions`.
 */
export function McpAppFrame({
  className,
  extensions,
  onNotifier,
  resourceUri,
  server,
  threadId,
  toolArguments,
  toolName,
  onOpenLink,
}: Readonly<{
  className?: string
  extensions?: Record<string, McpAppExtensionHandler>
  onNotifier?: (notify: McpAppNotifier | null) => void
  onOpenLink?: (url: string) => Promise<boolean>
  resourceUri: string
  server: string
  threadId?: string
  toolArguments: Record<string, unknown>
  toolName: string
}>) {
  const { i18n } = useLingui()
  const frame = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const extensionsRef = useRef(extensions)
  extensionsRef.current = extensions
  const openLinkRef = useRef(onOpenLink)
  openLinkRef.current = onOpenLink
  const argumentsKey = JSON.stringify(toolArguments)
  const notifierRef = useRef(onNotifier)
  notifierRef.current = onNotifier

  useEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    let disposed = false
    let bridge: AppBridge | null = null
    const observer = new MutationObserver(() => {
      void bridge?.sendHostContextChange(context())
    })
    const context = (): McpUiHostContext => ({
      displayMode: "inline",
      locale: i18n.locale,
      platform: "desktop",
      styles: {
        variables: hostStyles() as McpUiHostContext["styles"] extends { variables?: infer V }
          ? V
          : never,
      },
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    })
    const start = async () => {
      setState("loading")
      const client = await ensureCypheriaClient()
      const contents = await client.mcpApps.readResource(server, resourceUri, threadId)
      const document_ = contents.find((content) => content.uri === resourceUri) ?? contents[0]
      if (!document_?.text) throw new Error("The MCP App resource has no document")
      if (disposed) return
      bridge = new AppBridge(
        null,
        { name: "Cypheria", version: "1.0.0" },
        { openLinks: {}, serverTools: {}, logging: {} }
      )
      bridge.setHostContext(context())
      bridge.oncalltool = async (params) => {
        const result = await client.mcpApps.callTool({
          arguments: params.arguments ?? {},
          name: params.name,
          server,
          ...(threadId ? { threadId } : {}),
        })
        return result as never
      }
      bridge.onopenlink = async ({ url }) => {
        if (!(await openLinkRef.current?.(url))) await openExternal(url)
        return {}
      }
      for (const method of Object.keys(extensionsRef.current ?? {})) {
        bridge.setRequestHandler(
          method,
          { params: z.record(z.string(), z.unknown()) },
          async (params) => {
            const handler = extensionsRef.current?.[method]
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
      bridge.oninitialized = () => {
        if (disposed || !bridge) return
        setState("ready")
        const current = bridge
        const args = JSON.parse(argumentsKey) as Record<string, unknown>
        void current.sendToolInput({ arguments: args })
        void client.mcpApps
          .callTool({
            arguments: args,
            name: toolName,
            server,
            ...(threadId ? { threadId } : {}),
          })
          .then((result) => current.sendToolResult(result as never))
          .catch((failure: unknown) => {
            setError(failure instanceof Error ? failure.message : String(failure))
            setState("error")
          })
      }
      const target = iframe.contentWindow
      if (!target) throw new Error("The MCP App frame is unavailable")
      await bridge.connect(new PostMessageTransport(target, target))
      notifierRef.current?.((method, params) => {
        void bridge?.notification({ method, params } as never)
      })
      observer.observe(document.documentElement, {
        attributeFilter: ["class", "style"],
        attributes: true,
      })
      iframe.srcdoc = withPolicy(document_)
    }
    start().catch((failure: unknown) => {
      if (disposed) return
      setError(failure instanceof Error ? failure.message : String(failure))
      setState("error")
    })
    return () => {
      disposed = true
      observer.disconnect()
      notifierRef.current?.(null)
      void bridge?.close()
      iframe.srcdoc = ""
    }
  }, [server, resourceUri, toolName, argumentsKey, threadId, i18n.locale])

  return (
    <div className={cn("relative h-full min-h-0 w-full", className)}>
      <iframe
        ref={frame}
        className={cn("h-full w-full border-0 bg-background", state !== "ready" && "invisible")}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        title={server}
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
