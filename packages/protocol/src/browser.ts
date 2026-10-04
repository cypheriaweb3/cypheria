// Browser automation command model adapted from Paseo (Apache-2.0),
// https://github.com/getpaseo/paseo, packages/protocol/src/browser-automation.
import { z } from "zod"

import { ProjectThreadIdSchema } from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"

export const BrowserTabKindSchema = z.enum(["web", "dapp"])
export type BrowserTabKind = z.infer<typeof BrowserTabKindSchema>

export const BrowserAutomationErrorCodeSchema = z.enum([
  "browser_disabled",
  "browser_no_host",
  "browser_tab_not_found",
  "browser_tab_closed",
  "browser_timeout",
  "screenshot_no_frame",
  "browser_denied",
  "browser_unsupported",
  "browser_stale_ref",
  "browser_target_not_found",
  "browser_qr_not_found",
  "browser_unknown_error",
])
export type BrowserAutomationErrorCode = z.infer<typeof BrowserAutomationErrorCodeSchema>

const BROWSER_ID_MESSAGE =
  "browserId must be a real id returned by browser_new_tab or browser_list_tabs"
const WAIT_CONDITION_MESSAGE = "browser_wait requires exactly one of text or url"

export const BROWSER_AUTOMATION_COMMAND_NAMES = [
  "list_tabs",
  "new_tab",
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
  "list_mcp_apps",
  "mcp_app",
] as const

export const BrowserAutomationCommandNameSchema = z.enum(BROWSER_AUTOMATION_COMMAND_NAMES)
export type BrowserAutomationCommandName = z.infer<typeof BrowserAutomationCommandNameSchema>

/** Commands that only read page state; every other command is audited as a mutation. */
export const BROWSER_AUTOMATION_READ_ONLY_COMMANDS: ReadonlySet<BrowserAutomationCommandName> =
  new Set([
    "list_tabs",
    "snapshot",
    "screenshot",
    "logs",
    "wait",
    "scan_qr",
    "extract_assets",
    "mark_deliverable",
    "mark_handoff",
    "list_mcp_apps",
  ])

export const BrowserIdSchema = z
  .string({ error: () => BROWSER_ID_MESSAGE })
  .uuid(BROWSER_ID_MESSAGE)
export type BrowserId = z.infer<typeof BrowserIdSchema>

const tabTarget = z.object({ browserId: BrowserIdSchema }).strict()
const BrowserRefSchema = z.string().regex(/^@e\d+$/u, "ref must look like @e12")
const MouseButtonSchema = z.enum(["left", "right", "middle"])
const InputModifierSchema = z.enum(["Alt", "Control", "Meta", "Shift"])
const HttpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === "http:" || protocol === "https:"
}, "URL must use http or https")

const command = <const T extends string, S extends z.ZodType>(name: T, args: S) =>
  z.object({ args, command: z.literal(name) }).strict()

export const BrowserAutomationListTabsCommandSchema = command(
  "list_tabs",
  z.object({}).strict().default({})
)
export const BrowserAutomationNewTabCommandSchema = command(
  "new_tab",
  z
    .object({ kind: BrowserTabKindSchema.default("web"), url: HttpUrlSchema.optional() })
    .strict()
    .default({ kind: "web" })
)
export const BrowserAutomationSnapshotCommandSchema = command("snapshot", tabTarget)
export const BrowserAutomationClickCommandSchema = command(
  "click",
  tabTarget
    .extend({
      button: MouseButtonSchema.default("left"),
      doubleClick: z.boolean().default(false),
      modifiers: z.array(InputModifierSchema).default([]),
      point: z.object({ x: z.number(), y: z.number() }).optional(),
      ref: BrowserRefSchema.optional(),
      selector: z.string().min(1).optional(),
    })
    .refine((args) => Boolean(args.ref) || Boolean(args.selector) || Boolean(args.point), {
      message: "click requires at least one of ref, selector, or point",
    })
)
export const BrowserAutomationFillCommandSchema = command(
  "fill",
  tabTarget
    .extend({
      ref: BrowserRefSchema.optional(),
      selector: z.string().min(1).optional(),
      value: z.string(),
    })
    .refine((args) => Boolean(args.ref) || Boolean(args.selector), {
      message: "fill requires either ref or selector",
    })
)
export const BrowserAutomationWaitCommandSchema = command(
  "wait",
  tabTarget
    .extend({
      text: z.string().min(1).optional(),
      timeoutMs: z.int().positive().max(30_000).optional(),
      url: z.string().min(1).optional(),
    })
    .refine((args) => Number(Boolean(args.text)) + Number(Boolean(args.url)) === 1, {
      message: WAIT_CONDITION_MESSAGE,
    })
)
export const BrowserAutomationTypeCommandSchema = command(
  "type",
  tabTarget.extend({
    ref: BrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
    text: z.string(),
  })
)
export const BrowserAutomationKeypressCommandSchema = command(
  "keypress",
  tabTarget.extend({
    key: z.string().min(1),
    ref: BrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
  })
)
export const BrowserAutomationNavigateCommandSchema = command(
  "navigate",
  tabTarget.extend({ url: HttpUrlSchema })
)
export const BrowserAutomationBackCommandSchema = command("back", tabTarget)
export const BrowserAutomationForwardCommandSchema = command("forward", tabTarget)
export const BrowserAutomationReloadCommandSchema = command("reload", tabTarget)
export const BrowserAutomationScreenshotCommandSchema = command(
  "screenshot",
  tabTarget.extend({ fullPage: z.boolean().default(false) })
)
export const BrowserAutomationUploadCommandSchema = command(
  "upload",
  tabTarget
    .extend({
      filePaths: z.array(z.string().min(1)).min(1),
      ref: BrowserRefSchema.optional(),
      selector: z.string().min(1).optional(),
    })
    .refine((args) => Boolean(args.ref) || Boolean(args.selector), {
      message: "upload requires either ref or selector",
    })
)
export const BrowserAutomationSelectCommandSchema = command(
  "select",
  tabTarget
    .extend({
      ref: BrowserRefSchema.optional(),
      selector: z.string().min(1).optional(),
      value: z.string(),
    })
    .refine((args) => Boolean(args.ref) || Boolean(args.selector), {
      message: "select requires either ref or selector",
    })
)
export const BrowserAutomationHoverCommandSchema = command(
  "hover",
  tabTarget
    .extend({
      modifiers: z.array(InputModifierSchema).default([]),
      point: z.object({ x: z.number(), y: z.number() }).optional(),
      ref: BrowserRefSchema.optional(),
      selector: z.string().min(1).optional(),
    })
    .refine((args) => Boolean(args.ref) || Boolean(args.selector) || Boolean(args.point), {
      message: "hover requires at least one of ref, selector, or point",
    })
)
export const BrowserAutomationDragCommandSchema = command(
  "drag",
  tabTarget
    .extend({
      sourcePoint: z.object({ x: z.number(), y: z.number() }).optional(),
      sourceRef: BrowserRefSchema.optional(),
      sourceSelector: z.string().min(1).optional(),
      targetPoint: z.object({ x: z.number(), y: z.number() }).optional(),
      targetRef: BrowserRefSchema.optional(),
      targetSelector: z.string().min(1).optional(),
    })
    .refine(
      (args) =>
        (Boolean(args.sourceRef) || Boolean(args.sourceSelector) || Boolean(args.sourcePoint)) &&
        (Boolean(args.targetRef) || Boolean(args.targetSelector) || Boolean(args.targetPoint)),
      { message: "drag requires a valid source and target (ref, selector, or point)" }
    )
)
export const BrowserAutomationLogsCommandSchema = command(
  "logs",
  tabTarget.extend({ maxEntries: z.int().positive().max(200).default(50) })
)
export const BrowserAutomationEvaluateCommandSchema = command(
  "evaluate",
  tabTarget.extend({
    function: z.string().min(1),
    ref: BrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
  })
)
export const BrowserAutomationScrollCommandSchema = command(
  "scroll",
  tabTarget.extend({
    deltaX: z.number(),
    deltaY: z.number(),
    point: z.object({ x: z.number(), y: z.number() }).optional(),
    ref: BrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
  })
)
export const BrowserAutomationResizeCommandSchema = command(
  "resize",
  tabTarget.extend({
    height: z.int().positive().max(10_000),
    width: z.int().positive().max(10_000),
  })
)
export const BrowserAutomationCloseTabCommandSchema = command("close_tab", tabTarget)
export const BrowserAutomationMarkDeliverableCommandSchema = command("mark_deliverable", tabTarget)
export const BrowserAutomationMarkHandoffCommandSchema = command("mark_handoff", tabTarget)
export const BrowserAutomationRequestManualHandoffCommandSchema = command(
  "request_manual_handoff",
  tabTarget.extend({
    reason: z.string().min(1),
  })
)
export const BrowserAutomationScanQrCommandSchema = command(
  "scan_qr",
  tabTarget.extend({
    ref: BrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
  })
)

export const BrowserAssetKindSchema = z.enum(["image", "svg", "font", "stylesheet"])
export type BrowserAssetKind = z.infer<typeof BrowserAssetKindSchema>

export const BrowserAssetItemSchema = z
  .object({
    kind: BrowserAssetKindSchema,
    name: z.string().optional(),
    url: z.string(),
  })
  .strict()
export type BrowserAssetItem = z.infer<typeof BrowserAssetItemSchema>

export const BrowserAutomationExtractAssetsCommandSchema = command(
  "extract_assets",
  tabTarget.extend({
    kinds: z.array(BrowserAssetKindSchema).optional(),
  })
)

/**
 * One action on an MCP App a Desktop window shows. Apps are driven through their DOM with
 * synthetic events: there is no native input, navigation, or coordinate addressing.
 */
export const BrowserMcpAppActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot") }).strict(),
  z.object({ type: z.literal("screenshot") }).strict(),
  z.object({ ref: BrowserRefSchema, type: z.literal("click") }).strict(),
  z.object({ ref: BrowserRefSchema, type: z.literal("fill"), value: z.string() }).strict(),
  z
    .object({ ref: BrowserRefSchema.optional(), text: z.string(), type: z.literal("type") })
    .strict(),
  z
    .object({ key: z.string().min(1), ref: BrowserRefSchema.optional(), type: z.literal("press") })
    .strict(),
  z.object({ ref: BrowserRefSchema, type: z.literal("select"), value: z.string() }).strict(),
  z.object({ checked: z.boolean(), ref: BrowserRefSchema, type: z.literal("check") }).strict(),
  z
    .object({
      deltaX: z.number().optional(),
      deltaY: z.number(),
      ref: BrowserRefSchema.optional(),
      type: z.literal("scroll"),
    })
    .strict(),
])
export type BrowserMcpAppAction = z.infer<typeof BrowserMcpAppActionSchema>

export const BrowserAutomationMcpAppCommandSchema = command(
  "mcp_app",
  z.object({ action: BrowserMcpAppActionSchema, appId: z.string().min(1).max(256) }).strict()
)
/** The MCP Apps a window shows; the Server adds what it knows about each App instance. */
export const BrowserAutomationListMcpAppsCommandSchema = command(
  "list_mcp_apps",
  z.object({}).strict().default({})
)

export const BrowserAutomationCommandSchema = z.discriminatedUnion("command", [
  BrowserAutomationListTabsCommandSchema,
  BrowserAutomationNewTabCommandSchema,
  BrowserAutomationSnapshotCommandSchema,
  BrowserAutomationClickCommandSchema,
  BrowserAutomationFillCommandSchema,
  BrowserAutomationWaitCommandSchema,
  BrowserAutomationTypeCommandSchema,
  BrowserAutomationKeypressCommandSchema,
  BrowserAutomationNavigateCommandSchema,
  BrowserAutomationBackCommandSchema,
  BrowserAutomationForwardCommandSchema,
  BrowserAutomationReloadCommandSchema,
  BrowserAutomationScreenshotCommandSchema,
  BrowserAutomationUploadCommandSchema,
  BrowserAutomationSelectCommandSchema,
  BrowserAutomationHoverCommandSchema,
  BrowserAutomationDragCommandSchema,
  BrowserAutomationLogsCommandSchema,
  BrowserAutomationEvaluateCommandSchema,
  BrowserAutomationScrollCommandSchema,
  BrowserAutomationResizeCommandSchema,
  BrowserAutomationCloseTabCommandSchema,
  BrowserAutomationMarkDeliverableCommandSchema,
  BrowserAutomationMarkHandoffCommandSchema,
  BrowserAutomationRequestManualHandoffCommandSchema,
  BrowserAutomationScanQrCommandSchema,
  BrowserAutomationExtractAssetsCommandSchema,
  BrowserAutomationListMcpAppsCommandSchema,
  BrowserAutomationMcpAppCommandSchema,
])
export type BrowserAutomationCommand = z.infer<typeof BrowserAutomationCommandSchema>
/** Command arguments before defaults are applied, as written by an Agent or test. */
export type BrowserAutomationCommandInput = z.input<typeof BrowserAutomationCommandSchema>

export const BrowserTabInfoSchema = z
  .object({
    browserId: BrowserIdSchema,
    canGoBack: z.boolean().optional(),
    canGoForward: z.boolean().optional(),
    isActive: z.boolean().default(false),
    isLoading: z.boolean().default(false),
    kind: BrowserTabKindSchema,
    threadId: ProjectThreadIdSchema,
    title: z.string(),
    url: z.string(),
  })
  .strict()
export type BrowserTabInfo = z.infer<typeof BrowserTabInfoSchema>

const withBrowser = <const T extends string, S extends z.ZodRawShape>(name: T, shape: S) =>
  z.object({ browserId: BrowserIdSchema, command: z.literal(name), ...shape }).strict()
const point = { x: z.number().optional(), y: z.number().optional() }

export const BrowserAutomationSnapshotStatsSchema = z
  .object({
    iframeCount: z.int().nonnegative().optional(),
    maxDepth: z.int().nonnegative().optional(),
    nodeCount: z.int().nonnegative(),
    refCount: z.int().nonnegative(),
    textLength: z.int().nonnegative(),
  })
  .strict()

export const BrowserAutomationConsoleLogEntrySchema = z
  .object({
    level: z.string(),
    line: z.int().optional(),
    message: z.string(),
    source: z.string().optional(),
    timestamp: z.number(),
  })
  .strict()
export type BrowserAutomationConsoleLogEntry = z.infer<
  typeof BrowserAutomationConsoleLogEntrySchema
>

export const BrowserAutomationNetworkLogEntrySchema = z
  .object({
    duration: z.number(),
    method: z.string().optional(),
    startTime: z.number(),
    status: z.int().optional(),
    transferSize: z.number().optional(),
    type: z.string().optional(),
    url: z.string(),
  })
  .strict()
export type BrowserAutomationNetworkLogEntry = z.infer<
  typeof BrowserAutomationNetworkLogEntrySchema
>

/** An MCP App instance a window shows, with the Thread it belongs to or `null` outside any. */
export const BrowserMcpAppMountSchema = z
  .object({ appId: z.string().min(1), threadId: ProjectThreadIdSchema.nullable() })
  .strict()
export type BrowserMcpAppMount = z.infer<typeof BrowserMcpAppMountSchema>

export const BrowserAutomationResultSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list_tabs"), tabs: z.array(BrowserTabInfoSchema) }).strict(),
  withBrowser("new_tab", {
    kind: BrowserTabKindSchema,
    threadId: ProjectThreadIdSchema,
    url: z.string().min(1),
  }),
  withBrowser("snapshot", {
    format: z.literal("aria-yaml"),
    snapshot: z.string(),
    stats: BrowserAutomationSnapshotStatsSchema,
    title: z.string(),
    truncated: z.boolean(),
    url: z.string(),
  }),
  withBrowser("click", {
    point: z.object({ x: z.number(), y: z.number() }).optional(),
    ref: BrowserRefSchema.optional(),
    selector: z.string().optional(),
    ...point,
  }),
  withBrowser("fill", { ref: BrowserRefSchema.optional(), selector: z.string().optional() }),
  withBrowser("wait", { matched: z.enum(["text", "url"]) }),
  withBrowser("type", {
    ref: BrowserRefSchema.optional(),
    selector: z.string().optional(),
    ...point,
  }),
  withBrowser("keypress", {
    key: z.string().min(1),
    ref: BrowserRefSchema.optional(),
    selector: z.string().optional(),
    ...point,
  }),
  withBrowser("navigate", { url: z.string().min(1) }),
  withBrowser("back", {}),
  withBrowser("forward", {}),
  withBrowser("reload", {}),
  withBrowser("screenshot", {
    dataBase64: z.string().min(1),
    height: z.int().nonnegative(),
    mimeType: z.literal("image/png"),
    width: z.int().nonnegative(),
  }),
  withBrowser("upload", {
    filePaths: z.array(z.string().min(1)).min(1),
    ref: BrowserRefSchema.optional(),
    selector: z.string().optional(),
  }),
  withBrowser("select", {
    ref: BrowserRefSchema.optional(),
    selector: z.string().optional(),
    value: z.string(),
  }),
  withBrowser("hover", {
    ref: BrowserRefSchema.optional(),
    selector: z.string().optional(),
    ...point,
  }),
  withBrowser("drag", {
    sourcePoint: z.object({ x: z.number(), y: z.number() }).optional(),
    sourceRef: BrowserRefSchema.optional(),
    sourceSelector: z.string().optional(),
    sourceX: z.number().optional(),
    sourceY: z.number().optional(),
    targetPoint: z.object({ x: z.number(), y: z.number() }).optional(),
    targetRef: BrowserRefSchema.optional(),
    targetSelector: z.string().optional(),
    targetX: z.number().optional(),
    targetY: z.number().optional(),
  }),
  withBrowser("logs", {
    console: z.array(BrowserAutomationConsoleLogEntrySchema),
    network: z.array(BrowserAutomationNetworkLogEntrySchema),
  }),
  withBrowser("evaluate", { resultJson: z.string(), truncated: z.boolean() }),
  withBrowser("scroll", {
    deltaX: z.number(),
    deltaY: z.number(),
    ref: BrowserRefSchema.optional(),
    selector: z.string().optional(),
    ...point,
  }),
  withBrowser("resize", { height: z.int().positive(), width: z.int().positive() }),
  withBrowser("close_tab", {}),
  withBrowser("mark_deliverable", {}),
  withBrowser("mark_handoff", {}),
  withBrowser("request_manual_handoff", { status: z.enum(["completed", "dismissed"]) }),
  withBrowser("scan_qr", {
    bounds: z
      .object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() })
      .optional(),
    found: z.boolean(),
    text: z.string().optional(),
  }),
  withBrowser("extract_assets", {
    assets: z.array(BrowserAssetItemSchema),
    totalCount: z.number(),
  }),
  z
    .object({
      /** The action's type, such as `snapshot` or `click`. */
      action: z.string().min(1),
      appId: z.string().min(1),
      command: z.literal("mcp_app"),
      dataBase64: z.string().min(1).optional(),
      mimeType: z.literal("image/png").optional(),
      snapshot: z.string().optional(),
    })
    .strict(),
  z
    .object({
      apps: z.array(BrowserMcpAppMountSchema),
      command: z.literal("list_mcp_apps"),
    })
    .strict(),
])
export type BrowserAutomationResult = z.infer<typeof BrowserAutomationResultSchema>

export const BrowserAutomationErrorSchema = z
  .object({
    code: BrowserAutomationErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean().default(false),
  })
  .strict()
export type BrowserAutomationError = z.infer<typeof BrowserAutomationErrorSchema>

export const BrowserAutomationDialogEventSchema = z
  .object({
    action: z.enum(["accepted", "dismissed"]),
    defaultValue: z.string().optional(),
    message: z.string(),
    promptText: z.string().optional(),
    timestamp: z.number(),
    type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
  })
  .strict()
export type BrowserAutomationDialogEvent = z.infer<typeof BrowserAutomationDialogEventSchema>

/** One command addressed to a browser host. Tab commands require the calling Thread and only see its tabs. */
export const BrowserAutomationRequestSchema = z
  .object({
    automationId: RequestIdSchema,
    command: BrowserAutomationCommandSchema,
    cwd: z.string().min(1).optional(),
    threadId: ProjectThreadIdSchema.optional(),
  })
  .strict()
export type BrowserAutomationRequest = z.infer<typeof BrowserAutomationRequestSchema>

export const BrowserAutomationOutcomeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      automationId: RequestIdSchema,
      dialogs: z.array(BrowserAutomationDialogEventSchema).optional(),
      ok: z.literal(true),
      result: BrowserAutomationResultSchema,
    })
    .strict(),
  z
    .object({
      automationId: RequestIdSchema,
      dialogs: z.array(BrowserAutomationDialogEventSchema).optional(),
      error: BrowserAutomationErrorSchema,
      ok: z.literal(false),
    })
    .strict(),
])
export type BrowserAutomationOutcome = z.infer<typeof BrowserAutomationOutcomeSchema>
export type BrowserAutomationOutcomeInput = z.input<typeof BrowserAutomationOutcomeSchema>

/**
 * One window offering itself as a browser host: its built-in browser tabs and the MCP Apps it
 * shows. Every window registers on its own connection, even when windows share a client ID.
 */
export const BrowserHostRegistrationSchema = z
  .object({
    hostKind: z.string().trim().min(1).max(64).default("browser host"),
    /** The device's name as people know it, such as its host name. */
    name: z.string().trim().min(1).max(128).optional(),
    supportedCommands: z
      .array(BrowserAutomationCommandNameSchema)
      .min(1)
      .transform((commands) => [...new Set(commands)]),
  })
  .strict()
export type BrowserHostRegistration = z.infer<typeof BrowserHostRegistrationSchema>
export type BrowserHostRegistrationInput = z.input<typeof BrowserHostRegistrationSchema>

const request = <const T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) }).strict()
const response = <const T extends string, S extends z.ZodType>(type: T, value: S) =>
  z
    .object({
      payload: z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value }).strict(),
        z
          .object({
            error: z.object({ code: z.string(), message: z.string() }).strict(),
            ok: z.literal(false),
          })
          .strict(),
      ]),
      requestId: RequestIdSchema,
      type: z.literal(type),
    })
    .strict()
const succeeded = z.object({ succeeded: z.literal(true) }).strict()

export const BrowserHostRegisterRequestSchema = request(
  "browser.host.register.request",
  BrowserHostRegistrationSchema
)
export const BrowserHostUnregisterRequestSchema = request(
  "browser.host.unregister.request",
  z.object({}).strict()
)
export const BrowserAutomationResultRequestSchema = request(
  "browser.automation.result.request",
  BrowserAutomationOutcomeSchema
)

export const BrowserHostRegisterResponseSchema = response(
  "browser.host.register.response",
  succeeded
)
export const BrowserHostUnregisterResponseSchema = response(
  "browser.host.unregister.response",
  succeeded
)
export const BrowserAutomationResultResponseSchema = response(
  "browser.automation.result.response",
  z.object({ accepted: z.boolean() }).strict()
)

/** Server-to-host command. The host answers with `browser.automation.result.request`. */
export const BrowserAutomationCommandNotificationSchema = z
  .object({
    payload: BrowserAutomationRequestSchema,
    type: z.literal("browser.automation.command.notification"),
  })
  .strict()

export const BROWSER_CLIENT_SCHEMAS = [
  BrowserHostRegisterRequestSchema,
  BrowserHostUnregisterRequestSchema,
  BrowserAutomationResultRequestSchema,
] as const
export const BROWSER_SERVER_SCHEMAS = [
  BrowserHostRegisterResponseSchema,
  BrowserHostUnregisterResponseSchema,
  BrowserAutomationResultResponseSchema,
  BrowserAutomationCommandNotificationSchema,
] as const
export const BROWSER_RESPONSE_TYPES = BROWSER_SERVER_SCHEMAS.slice(0, 3).map(
  (schema) => schema.shape.type.value
)

export type BrowserClientMessage = z.infer<(typeof BROWSER_CLIENT_SCHEMAS)[number]>
export type BrowserServerMessage = z.infer<(typeof BROWSER_SERVER_SCHEMAS)[number]>
