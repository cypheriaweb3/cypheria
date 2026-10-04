import { z } from "zod"

import { BROWSER_FAMILIES } from "./families.ts"

/**
 * Requests the `cua` runtime sends to its host over `nodeRepl.rpc(CUA_SERVICE, request)`. Model
 * code can call the service directly, so the host validates every request and owns every
 * decision; the runtime only shapes calls and output.
 */
export const CUA_SERVICE = "cua"

const point = z.tuple([z.number().finite(), z.number().finite()])
const elementIndex = z.int().nonnegative()
/** An element ref from the latest page snapshot, such as `@e12`. */
const ref = z
  .string()
  .regex(/^@?e\d+$/u, "ref must look like @e12")
  .transform((value) => (value.startsWith("@") ? value : `@${value}`))
const mouseButton = z.enum(["left", "right", "middle"])
const direction = z.enum(["up", "down", "left", "right"])
const modifier = z.enum(["cmd", "ctrl", "alt", "shift", "fn"])
const text = z.string().max(100_000)
const key = z.string().min(1).max(64)
const url = z.string().min(1).max(8_192)

export const AppHandleSchema = z.object({ pid: z.int().positive(), windowId: z.int().positive() })
export type AppHandle = z.infer<typeof AppHandleSchema>

export const AppActionSchema = z.discriminatedUnion("type", [
  z.object({
    button: mouseButton.optional(),
    count: z.int().min(1).max(3).optional(),
    modifiers: z.array(modifier).max(4).optional(),
    target: z.union([elementIndex, point]),
    type: z.literal("click"),
  }),
  z.object({
    element: elementIndex.optional(),
    point: point.optional(),
    text,
    type: z.literal("type"),
  }),
  z.object({ key, type: z.literal("press") }),
  z.object({
    amount: z.int().min(1).max(50).optional(),
    by: z.enum(["line", "page"]).optional(),
    direction,
    target: z.union([elementIndex, point]),
    type: z.literal("scroll"),
  }),
  z.object({ from: point, to: point, type: z.literal("drag") }),
  z.object({ element: elementIndex, type: z.literal("set_value"), value: text }),
  z.object({
    action: z.string().min(1).max(64),
    element: elementIndex,
    type: z.literal("perform"),
  }),
  z.object({ path: z.array(z.string().min(1)).min(1).max(8), type: z.literal("menu") }),
  z.object({ type: z.literal("activate") }),
])
export type AppAction = z.infer<typeof AppActionSchema>

/** One action on a claimed external browser tab, translated by the host into agent-browser. */
export const PageActionSchema = z.discriminatedUnion("type", [
  z.object({
    full: z.boolean().optional(),
    interactive: z.boolean().optional(),
    type: z.literal("snapshot"),
  }),
  z.object({
    annotate: z.boolean().optional(),
    fullPage: z.boolean().optional(),
    type: z.literal("screenshot"),
  }),
  z.object({
    button: mouseButton.optional(),
    double: z.boolean().optional(),
    target: z.union([ref, point]),
    type: z.literal("click"),
  }),
  z.object({ ref, type: z.literal("fill"), value: text }),
  z.object({ ref: ref.optional(), text, type: z.literal("type") }),
  z.object({ key, ref: ref.optional(), type: z.literal("press") }),
  z.object({ target: z.union([ref, point]), type: z.literal("hover") }),
  z.object({ ref, type: z.literal("select"), values: z.array(z.string()).min(1).max(64) }),
  z.object({ checked: z.boolean(), ref, type: z.literal("check") }),
  z.object({
    direction,
    pixels: z.int().positive().max(20_000).optional(),
    ref: ref.optional(),
    type: z.literal("scroll"),
  }),
  z.object({ from: ref, to: ref, type: z.literal("drag") }),
  z.object({
    paths: z.array(z.string().min(1)).min(1).max(32),
    ref,
    type: z.literal("upload"),
  }),
  z.object({
    ref: ref.optional(),
    type: z.literal("get"),
    what: z.enum(["text", "html", "value", "title", "url"]),
  }),
  z.object({ script: z.string().min(1).max(100_000), type: z.literal("evaluate") }),
  z.object({
    ms: z.int().positive().max(30_000).optional(),
    selector: z.string().min(1).max(1_000).optional(),
    text: z.string().min(1).max(1_000).optional(),
    type: z.literal("wait"),
    url: z.string().min(1).max(1_000).optional(),
  }),
  z.object({ type: z.literal("goto"), url }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("forward") }),
  z.object({ type: z.literal("reload") }),
  z.object({ accept: z.boolean(), text: z.string().optional(), type: z.literal("dialog") }),
  z.object({ type: z.literal("close") }),
  z.object({ disposition: z.enum(["deliverable", "handoff"]), type: z.literal("mark") }),
])
export type PageAction = z.infer<typeof PageActionSchema>

/** One action on an MCP App: DOM-only, with synthetic events and no native input. */
export const McpAppActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot") }),
  z.object({ type: z.literal("screenshot") }),
  z.object({ ref, type: z.literal("click") }),
  z.object({ ref, type: z.literal("fill"), value: text }),
  z.object({ ref: ref.optional(), text, type: z.literal("type") }),
  z.object({ key, ref: ref.optional(), type: z.literal("press") }),
  z.object({ ref, type: z.literal("select"), value: z.string() }),
  z.object({ checked: z.boolean(), ref, type: z.literal("check") }),
  z.object({
    deltaX: z.number().finite().optional(),
    deltaY: z.number().finite(),
    ref: ref.optional(),
    type: z.literal("scroll"),
  }),
])
export type McpAppAction = z.infer<typeof McpAppActionSchema>

/** Built-in browser commands the `iab` API forwards, by their protocol name. */
export const IAB_COMMANDS = [
  "snapshot",
  "click",
  "fill",
  "wait",
  "type",
  "keypress",
  "navigate",
  "back",
  "forward",
  "reload",
  "screenshot",
  "upload",
  "select",
  "hover",
  "drag",
  "logs",
  "evaluate",
  "scroll",
  "resize",
  "close_tab",
  "mark_deliverable",
  "mark_handoff",
  "request_manual_handoff",
  "scan_qr",
  "extract_assets",
] as const
export type IabCommand = (typeof IAB_COMMANDS)[number]

const browserId = z.enum(BROWSER_FAMILIES)
const tabId = z.string().min(1).max(256)

export const CuaRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("state") }),
  z.object({ op: z.literal("apps.list") }),
  z.object({ op: z.literal("apps.windows"), pid: z.int().positive().optional() }),
  z.object({
    app: z.union([z.string().min(1).max(1_024), z.object({ windowId: z.int().positive() })]),
    op: z.literal("apps.get"),
  }),
  z.object({
    handle: AppHandleSchema,
    op: z.literal("apps.observe"),
    query: z.string().min(1).max(256).optional(),
    screenshot: z.boolean().optional(),
    tree: z.boolean().optional(),
  }),
  z.object({ action: AppActionSchema, handle: AppHandleSchema, op: z.literal("apps.act") }),
  z.object({ op: z.literal("iab.tabs") }),
  z.object({
    kind: z.enum(["web", "dapp"]).optional(),
    op: z.literal("iab.new"),
    url: url.optional(),
  }),
  z.object({
    args: z.record(z.string(), z.unknown()).default({}),
    command: z.enum(IAB_COMMANDS),
    op: z.literal("iab.command"),
    tabId,
  }),
  z.object({ op: z.literal("browsers.list") }),
  z.object({ browserId, op: z.literal("browsers.tabs") }),
  z.object({ browserId, op: z.literal("browsers.new"), url: url.optional() }),
  z.object({ browserId, op: z.literal("browsers.claim"), tabId }),
  z.object({ action: PageActionSchema, browserId, op: z.literal("browsers.act"), tabId }),
  z.object({ op: z.literal("mcpapps.list") }),
  z.object({ action: McpAppActionSchema, appId: tabId, op: z.literal("mcpapps.act") }),
])
export type CuaRequest = z.input<typeof CuaRequestSchema>
export type ParsedCuaRequest = z.output<typeof CuaRequestSchema>

/** A screenshot crossing the RPC boundary. */
export type CuaImage = { readonly dataBase64: string; readonly mimeType: string }

/** What the host returns for an observation: text for the model and optional pixels. */
export type CuaObservation = { readonly text: string; readonly image?: CuaImage }

export type AppInfo = {
  readonly name: string
  readonly bundleId?: string
  readonly pid?: number
  readonly running: boolean
  readonly windows?: readonly WindowInfo[]
}

export type WindowInfo = {
  readonly windowId: number
  readonly pid: number
  readonly app: string
  readonly title?: string
  readonly onScreen?: boolean
}

export type AppBinding = AppHandle & { readonly name: string; readonly bundleId?: string }

export type IabTabInfo = {
  readonly id: string
  readonly kind: "web" | "dapp"
  readonly title: string
  readonly url: string
  readonly active: boolean
}

export type ExternalBrowserInfo = {
  readonly id: (typeof BROWSER_FAMILIES)[number]
  readonly name: string
  readonly installed: boolean
  /** Whether remote debugging is on and the browser is reachable. */
  readonly connectable: boolean
  /** Why the browser cannot be used yet, with what the person must do. */
  readonly setup?: string
}

export type ExternalTabInfo = {
  readonly id: string
  readonly title: string
  readonly url: string
  /** Whether this Thread controls the tab: it opened or claimed it. */
  readonly controlled: boolean
}

export type McpAppInfo = {
  readonly id: string
  readonly title: string
  readonly server: string
  readonly pluginId: string | null
  readonly displayMode: string
}

export type CuaState = {
  readonly apps?: readonly AppInfo[]
  readonly iab?: readonly IabTabInfo[]
  readonly browsers?: readonly (ExternalBrowserInfo & { tabs?: readonly ExternalTabInfo[] })[]
  readonly mcpApps?: readonly McpAppInfo[]
  readonly errors?: readonly string[]
}
