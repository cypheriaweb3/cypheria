import { z } from "zod"

import { AUDIO_CHUNK_BYTES, MAX_AUDIO_RECORDING_MS } from "./audio.ts"
import { BROWSER_MEMBERS, isBrowserMember } from "./browser/members.ts"
import { BrowserHostRequestSchema, BrowserRequestSchema } from "./browser/protocol.ts"
import type { BrowserInfo, TabInfo } from "./browser/types.ts"
import type { HostCapability } from "./surfaces.ts"

/**
 * Requests the `cua` runtime sends to its host over `nodeRepl.rpc(CUA_SERVICE, request)`. Model
 * code can call the service directly, so the host validates every request and owns every
 * decision; the runtime only shapes calls and output.
 */
export const CUA_SERVICE = "cua"

const point = z.tuple([z.number().finite(), z.number().finite()])
const elementIndex = z.int().nonnegative()
const mouseButton = z.enum(["left", "right", "middle"])
const direction = z.enum(["up", "down", "left", "right"])
const modifier = z.enum(["cmd", "ctrl", "alt", "shift", "fn"])
const text = z.string().max(100_000)
const key = z.string().min(1).max(64)
const _url = z.string().min(1).max(8_192)

/** A Computer Use host: the client ID of the device whose browsers and apps a request uses. */
const host = z.string().min(1).max(128)

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
    amount: z.number().positive().max(50).optional(),
    by: z.enum(["line", "page"]).optional(),
    pixels: z.int().positive().max(20_000).optional(),
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
  z.object({ format: z.enum(["text", "md", "html"]).optional(), text, type: z.literal("paste") }),
  z.object({
    element: elementIndex,
    prefix: z.string().max(10_000).optional(),
    selectionType: z.enum(["text", "cursor_before", "cursor_after"]).optional(),
    suffix: z.string().max(10_000).optional(),
    text,
    type: z.literal("select_text"),
  }),
])
export type AppAction = z.infer<typeof AppActionSchema>

/** Requests about the host device's native apps, which the Server forwards to that device. */
const APP_REQUESTS = [
  z.object({ host: host.optional(), op: z.literal("apps.list") }),
  z.object({
    host: host.optional(),
    op: z.literal("apps.windows"),
    pid: z.int().positive().optional(),
  }),
  z.object({
    app: z.union([z.string().min(1).max(1_024), z.object({ windowId: z.int().positive() })]),
    host: host.optional(),
    op: z.literal("apps.get"),
  }),
  z.object({
    handle: AppHandleSchema,
    host,
    op: z.literal("apps.observe"),
    query: z.string().min(1).max(256).optional(),
    screenshot: z.boolean().optional(),
    tree: z.boolean().optional(),
  }),
  z.object({ action: AppActionSchema, handle: AppHandleSchema, host, op: z.literal("apps.act") }),
  z.object({
    app: z.string().min(1).max(1_024),
    host: host.optional(),
    op: z.literal("apps.launch"),
  }),
  z.object({
    host: host.optional(),
    maxDurationMs: z.int().min(100).max(MAX_AUDIO_RECORDING_MS).optional(),
    op: z.literal("apps.audio.start"),
  }),
  z.object({ host: host.optional(), op: z.literal("apps.audio.stop") }),
  z.object({
    host: host.optional(),
    length: z.int().positive().max(AUDIO_CHUNK_BYTES),
    offset: z.int().nonnegative(),
    op: z.literal("apps.audio.read"),
  }),
] as const

export const CuaRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("state") }),
  z.object({ op: z.literal("hosts") }),
  ...APP_REQUESTS,
  ...BrowserRequestSchema.options,
])
export type CuaRequest = z.input<typeof CuaRequestSchema>
export type ParsedCuaRequest = z.output<typeof CuaRequestSchema>

/**
 * What a host device executes: its native app requests, its `chrome` browser requests, and the
 * Server's lifecycle notices. The device validates it again, since it arrives over the network.
 */
export const CuaDeviceRequestSchema = z.discriminatedUnion("op", [
  ...APP_REQUESTS,
  ...BrowserHostRequestSchema.options,
  z.object({ op: z.literal("device.turnEnded") }),
  z.object({ op: z.literal("device.closeThread") }),
])
export type CuaDeviceRequest = z.input<typeof CuaDeviceRequestSchema>
export type ParsedCuaDeviceRequest = z.output<typeof CuaDeviceRequestSchema>

const REPEATABLE_DEVICE_OPS: ReadonlySet<string> = new Set([
  "apps.list",
  "apps.windows",
  "apps.observe",
  "apps.audio.read",
  "browsers.list",
  "device.turnEnded",
  "device.closeThread",
])

/**
 * Whether a device request that got no answer may simply run again: reads and the idempotent
 * lifecycle notices. Anything else may already have acted.
 */
export const isRepeatableDeviceRequest = (request: ParsedCuaDeviceRequest): boolean =>
  REPEATABLE_DEVICE_OPS.has(request.op) ||
  (request.op === "browser.call" &&
    isBrowserMember(request.member) &&
    !BROWSER_MEMBERS[request.member].mutates)

/** A screenshot crossing the RPC boundary. */
export type CuaImage = { readonly dataBase64: string; readonly mimeType: string }

/** A finished computer audio recording, which `apps.audio.read` returns piece by piece. */
export type CuaAudioRecording = { readonly mimeType: string; readonly size: number }

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

/** A device that can act for Computer Use, as the model sees it. */
export type CuaHostInfo = {
  readonly id: string
  readonly name: string
  /** Whether this is the device the person sent the current turn from. */
  readonly current: boolean
  /** What the device offers: browser backends and native app control. */
  readonly capabilities: readonly HostCapability[]
}

/** A browser in the state inventory, with the tabs the Thread controls in it. */
export type BrowserState = BrowserInfo & { readonly tabs?: readonly TabInfo[] }

export type CuaState = {
  readonly hosts: readonly CuaHostInfo[]
  /** The device the state's native apps come from. */
  readonly host?: string
  readonly apps?: readonly AppInfo[]
  readonly browsers?: readonly BrowserState[]
  /** Inventory failures; the rest of the state remains usable. */
  readonly errors?: readonly string[]
}
