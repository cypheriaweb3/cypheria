import { z } from "zod"

/**
 * The protocol between the Cypheria extension, its native messaging host, and Cypheria Desktop.
 * Every hop carries the same JSON messages: requests with an `id`, responses to them, and
 * notifications without one. Chrome frames them on the host's standard input and output; the
 * host frames them the same way (32-bit little-endian length, then UTF-8 JSON) on Desktop's
 * local socket. The host answers `hello` itself and passes everything else through unchanged.
 */

/** The native messaging host name; the manifest Desktop installs registers it per browser. */
export const NATIVE_HOST_NAME = "app.cypheria.browser_extension"

/** Raised whenever a message changes incompatibly; each side requires the other's to match. */
export const PROTOCOL_VERSION = 1

/**
 * The extension IDs the native host accepts, fixed by the manifest `key`. Store IDs join this
 * list once the extension is published.
 */
export const EXTENSION_IDS = ["jahdmaekjcmhofodmnpdhegangbeoaeh"] as const

/** Chrome refuses native messages larger than this toward the browser. */
export const MAX_MESSAGE_TO_BROWSER = 1024 * 1024

export const PROTOCOL_ERRORS = [
  /** The extension is older than Desktop's protocol. */
  "extension_update_required",
  /** Desktop is older than the extension's protocol. */
  "app_update_required",
  /** No Desktop is listening; the host keeps trying and reports when it connects. */
  "desktop_not_running",
  /** The caller is not an allowed extension or did not present Desktop's token. */
  "unauthorized",
  /** The message did not match its schema. */
  "invalid",
  /** The operation ran and failed. */
  "failed",
] as const
export type ProtocolErrorCode = (typeof PROTOCOL_ERRORS)[number]

const Id = z.union([z.string().max(64), z.int()])

export const RequestSchema = z.object({
  id: Id,
  method: z.string().min(1).max(64),
  params: z.unknown().optional(),
})
export type Request = z.infer<typeof RequestSchema>

export const ErrorSchema = z.object({
  code: z.string().max(64),
  message: z.string().max(4_096),
})
export type ProtocolError = z.infer<typeof ErrorSchema>

export const ResponseSchema = z.union([
  z.object({ id: Id, result: z.unknown() }),
  z.object({ error: ErrorSchema, id: Id }),
])
export type Response = z.infer<typeof ResponseSchema>

export const NotificationSchema = z.object({
  method: z.string().min(1).max(64),
  params: z.unknown().optional(),
})
export type Notification = z.infer<typeof NotificationSchema>

/** Classifies a decoded message; `undefined` for anything that is not one of the three. */
export const classify = (
  message: unknown
):
  | { readonly kind: "request"; readonly message: Request }
  | { readonly kind: "response"; readonly message: Response }
  | { readonly kind: "notification"; readonly message: Notification }
  | undefined => {
  if (typeof message !== "object" || message === null) return undefined
  if ("method" in message) {
    if ("id" in message) {
      const parsed = RequestSchema.safeParse(message)
      return parsed.success ? { kind: "request", message: parsed.data } : undefined
    }
    const parsed = NotificationSchema.safeParse(message)
    return parsed.success ? { kind: "notification", message: parsed.data } : undefined
  }
  const parsed = ResponseSchema.safeParse(message)
  return parsed.success ? { kind: "response", message: parsed.data } : undefined
}

// The extension and the host

export const HelloParamsSchema = z.object({
  extensionId: z.string().min(1).max(64),
  extensionVersion: z.string().min(1).max(32),
  protocolVersion: z.int().positive(),
})
export type HelloParams = z.infer<typeof HelloParamsSchema>

export const HelloResultSchema = z.object({
  desktopVersion: z.string().max(32),
  hostVersion: z.string().max(32),
  protocolVersion: z.int().positive(),
})
export type HelloResult = z.infer<typeof HelloResultSchema>

/** What the host reports about its Desktop connection after `hello`. */
export const DesktopStatusSchema = z.object({
  state: z.enum(["connected", "disconnected"]),
  error: ErrorSchema.optional(),
  desktopVersion: z.string().max(32).optional(),
})
export type DesktopStatus = z.infer<typeof DesktopStatusSchema>

/** The host's first message on Desktop's socket. */
export const ConnectParamsSchema = z.object({
  token: z.string().min(16).max(256),
  hostVersion: z.string().max(32),
  /** The extension origin Chrome passed to the host. */
  origin: z.string().max(256),
  hello: HelloParamsSchema,
})
export type ConnectParams = z.infer<typeof ConnectParamsSchema>

/** The discovery file Desktop writes for the host, `$CYPHERIA_HOME/run/browser-extension.json`. */
export const DiscoverySchema = z.object({
  /** A Unix socket path, or a named pipe on Windows. */
  endpoint: z.string().min(1).max(1_024),
  token: z.string().min(16).max(256),
  protocolVersion: z.int().positive(),
  desktopVersion: z.string().max(32),
  pid: z.int().positive(),
})
export type Discovery = z.infer<typeof DiscoverySchema>

// Desktop to the extension

const TabId = z.int().nonnegative()

export const BrowserInfoSchema = z.object({
  /** The Chromium family, such as `chrome`, `edge`, or `brave`. */
  family: z.string().max(32),
  extensionVersion: z.string().max(32),
  /** A random ID the extension keeps per profile, so Desktop can tell profiles apart. */
  instanceId: z.string().min(1).max(64),
  /** The name the person gave the profile, when the browser shares it. */
  profileName: z.string().max(256).optional(),
})
export type BrowserInfo = z.infer<typeof BrowserInfoSchema>

export const TabSchema = z.object({
  id: TabId,
  windowId: z.int(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
  /** Milliseconds since the epoch when the tab was last active. */
  lastAccessed: z.number().optional(),
  groupTitle: z.string().optional(),
})
export type Tab = z.infer<typeof TabSchema>

/** A group key names one Thread's tab group without telling the extension anything about it. */
const GroupKey = z.string().min(1).max(128)
const GroupTitle = z.string().max(80)

export const DesktopRequests = {
  getInfo: { params: z.object({}), result: BrowserInfoSchema },
  listTabs: { params: z.object({}), result: z.array(TabSchema) },
  /** Opens a background tab in the group, creating the group with the title on first use. */
  openTab: {
    params: z.object({ group: GroupKey, title: GroupTitle.optional() }),
    result: z.object({ id: TabId }),
  },
  nameGroup: { params: z.object({ group: GroupKey, title: GroupTitle }), result: z.null() },
  closeTab: { params: z.object({ tabId: TabId }), result: z.null() },
  /** Attaches the debugger to a tab; attaching twice is harmless. */
  attach: { params: z.object({ tabId: TabId }), result: z.null() },
  detach: { params: z.object({ tabId: TabId }), result: z.null() },
  /** One CDP command on an attached tab. */
  cdp: {
    params: z.object({
      tabId: TabId,
      method: z.string().min(1).max(128),
      params: z.record(z.string(), z.unknown()).optional(),
    }),
    result: z.record(z.string(), z.unknown()),
  },
} as const
export type DesktopMethod = keyof typeof DesktopRequests
export type DesktopParams<M extends DesktopMethod> = z.infer<(typeof DesktopRequests)[M]["params"]>
export type DesktopResult<M extends DesktopMethod> = z.infer<(typeof DesktopRequests)[M]["result"]>

// The extension to Desktop

export const ExtensionNotifications = {
  cdpEvent: z.object({
    tabId: TabId,
    method: z.string().min(1).max(128),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  /** The debugger left the tab: it closed, the person cancelled, or another debugger took it. */
  cdpDetached: z.object({ tabId: TabId, reason: z.string().max(64) }),
  downloadChanged: z.object({
    id: z.int(),
    state: z.enum(["in_progress", "complete", "interrupted"]),
    filename: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
} as const
export type ExtensionNotification = keyof typeof ExtensionNotifications
export type ExtensionNotificationParams<N extends ExtensionNotification> = z.infer<
  (typeof ExtensionNotifications)[N]
>

// The host to the extension

export const HostNotifications = {
  desktopStatus: DesktopStatusSchema,
} as const
