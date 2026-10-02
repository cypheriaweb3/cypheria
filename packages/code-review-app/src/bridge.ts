import { App, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps"
import { z } from "zod"

/**
 * The Code Review App's connection to its host. Tools run on the `code-review` plugin through the
 * standard MCP Apps channel; the host-side operations the official desktop keeps in its host
 * (provider setup, settings, the sidebar inbox, GitLab, opening chats) are Cypheria extension
 * requests named `cypheria/codeReview/*` on the same channel.
 */

export const app = new App({ name: "Code Review", version: "1.0.0" }, {}, { autoResize: false })

/** Why a read failed: the App shows access, rate-limit, and retryable failures differently. */
export class ReadFailure extends Error {
  readonly kind: "access" | "rate-limit" | "transient"
  readonly retryAt: number | undefined

  constructor(message: string, kind: ReadFailure["kind"], retryAt?: number) {
    super(message)
    this.name = "ReadFailure"
    this.kind = kind
    this.retryAt = retryAt
  }
}

const ReadFailureSchema = z.object({
  readFailure: z.object({
    kind: z.enum(["access", "rate-limit", "transient"]),
    retryAt: z.number().optional(),
  }),
})

/** Calls a `pull_requests.*` tool and returns its structured result. */
export const callTool = async <T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<T> => {
  const result = await app.callServerTool({ arguments: args, name })
  if (result.isError) {
    const text = result.content.find((item) => item.type === "text")
    const message = text && "text" in text ? String(text.text) : `${name} failed`
    const failure = ReadFailureSchema.safeParse(result.structuredContent)
    throw failure.success
      ? new ReadFailure(message, failure.data.readFailure.kind, failure.data.readFailure.retryAt)
      : new ReadFailure(message, "transient")
  }
  return (result.structuredContent ?? {}) as T
}

/** A provider operation result that reports failure in its own `status`. */
export const expectSuccess = <T extends { status?: string; error?: string }>(value: T): T => {
  if (value.status === "error")
    throw new ReadFailure(value.error ?? "The request failed", "transient")
  return value
}

const ResultSchema = z.object({}).passthrough()

/** Sends one Cypheria host request. */
export const hostRequest = async <T = unknown>(
  method: `cypheria/codeReview/${string}`,
  params: Record<string, unknown> = {}
): Promise<T> => {
  const result = (await app.request({ method, params }, ResultSchema)) as {
    value?: T
    error?: { message: string; kind?: ReadFailure["kind"]; retryAt?: number }
  }
  if (result.error) {
    throw new ReadFailure(
      result.error.message,
      result.error.kind ?? "transient",
      result.error.retryAt
    )
  }
  return result.value as T
}

type HostListener = (params: Record<string, unknown>) => void
const listeners = new Map<string, Set<HostListener>>()

/** Subscribes to one Cypheria host notification, such as a sidebar selection. */
export const onHostNotification = (method: string, listener: HostListener): (() => void) => {
  let set = listeners.get(method)
  if (!set) {
    set = new Set()
    listeners.set(method, set)
    app.setNotificationHandler(method, { params: z.record(z.string(), z.unknown()) }, (params) => {
      for (const current of listeners.get(method) ?? []) current(params as Record<string, unknown>)
    })
  }
  set.add(listener)
  return () => set?.delete(listener)
}

/** Applies the host's theme and CSS variables so the App matches Cypheria's appearance. */
export const applyHostContext = (context: McpUiHostContext | undefined): void => {
  if (!context) return
  const root = document.documentElement
  if (context.theme) {
    root.classList.toggle("dark", context.theme === "dark")
    root.style.colorScheme = context.theme
  }
  if (context.styles?.variables) {
    applyHostStyleVariables(context.styles.variables)
    root.dataset.hostStyles = ""
  }
  if (context.locale) root.lang = context.locale
}
