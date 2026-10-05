import {
  BrowserAutomationErrorSchema,
  BrowserIdSchema,
  BrowserTabKindSchema,
} from "@cypheria/protocol"
import { z } from "zod"

import { CYPHERIA_BROWSER_CHANNELS } from "./browser-channels.js"

export * from "./browser-channels.js"

const IPC_VERSION = 1 as const

/** Every browser tab, web or dApp, belongs to exactly one Cypheria Thread. */
export const BrowserThreadIdSchema = z.uuidv7()

export const BrowserAttachedRegistrationSchema = z
  .object({
    browserId: BrowserIdSchema,
    kind: BrowserTabKindSchema,
    threadId: BrowserThreadIdSchema,
    webContentsId: z.int().positive(),
  })
  .strict()
export type BrowserAttachedRegistration = z.infer<typeof BrowserAttachedRegistrationSchema>

const BrowserShortcutPrefixSchema = z
  .object({
    alt: z.boolean(),
    code: z.string().min(1).max(64),
    codeFallback: z.literal(true).optional(),
    control: z.boolean(),
    editable: z.literal(false).optional(),
    key: z.string().min(1).max(64).optional(),
    meta: z.boolean(),
    repeat: z.literal(false).optional(),
    shift: z.boolean(),
    shiftedKey: z.string().min(1).max(64).optional(),
  })
  .strict()
export const BrowserKeyboardPolicySchema = z
  .object({
    menuPrefixes: z.array(BrowserShortcutPrefixSchema).max(256),
    prefixes: z.array(BrowserShortcutPrefixSchema).max(256),
  })
  .strict()
export type BrowserKeyboardPolicyInput = z.infer<typeof BrowserKeyboardPolicySchema>

export const BrowserClearDataSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("web") }).strict(),
  z.object({ scope: z.literal("dapp") }).strict(),
  z.object({ origin: z.url(), scope: z.literal("dapp-origin") }).strict(),
])
export type BrowserClearData = z.infer<typeof BrowserClearDataSchema>

export const BrowserNewTabRequestSchema = z
  .object({ sourceBrowserId: BrowserIdSchema, url: z.string().min(1) })
  .strict()
export type BrowserNewTabRequest = z.infer<typeof BrowserNewTabRequestSchema>

export const BrowserShortcutInputSchema = z
  .object({
    alt: z.boolean(),
    browserId: BrowserIdSchema,
    code: z.string(),
    control: z.boolean(),
    key: z.string(),
    meta: z.boolean(),
    repeat: z.boolean(),
    shift: z.boolean(),
  })
  .strict()
export type BrowserShortcutInput = z.infer<typeof BrowserShortcutInputSchema>

export const BrowserReservedShortcutSchema = z
  .object({ action: z.literal("focus-url"), browserId: BrowserIdSchema })
  .strict()
export type BrowserReservedShortcut = z.infer<typeof BrowserReservedShortcutSchema>

/**
 * One browser API member that runs on a page: a built-in browser tab, which Electron main drives
 * through the engine, or an MCP App. The renderer keeps tab lifecycle; `member` and `args` follow
 * the `@cypheria/cua` grammar, which Electron main checks again.
 */
const MemberCallFields = {
  args: z.array(z.unknown()).max(16),
  cwd: z.string().min(1).optional(),
  handle: z.string().min(1).max(256).optional(),
  member: z.string().min(1).max(64),
  selector: z.string().min(1).max(20_000).optional(),
}
export const BrowserTabCallSchema = z
  .object({ browserId: BrowserIdSchema, threadId: BrowserThreadIdSchema, ...MemberCallFields })
  .strict()
export type BrowserTabCall = z.infer<typeof BrowserTabCallSchema>

/** The sandbox origin of a mounted MCP App, which identifies its frames in the main window. */
export const McpAppSandboxOriginSchema = z
  .string()
  .regex(/^cypheria-sandbox:\/\/[a-z0-9]{1,63}\/?$/u)

export const McpAppCallSchema = z
  .object({
    appId: z.string().min(1).max(256),
    origin: McpAppSandboxOriginSchema,
    ...MemberCallFields,
  })
  .strict()
export type McpAppCall = z.infer<typeof McpAppCallSchema>

/** A member call's result, or the error the model reads; errors keep their engine codes. */
export const BrowserCallOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ error: BrowserAutomationErrorSchema, ok: z.literal(false) }).strict(),
])
export type BrowserCallOutcome = z.infer<typeof BrowserCallOutcomeSchema>

const contract = <const C extends string, Req extends z.ZodType, Res extends z.ZodType>(
  channel: C,
  request: Req,
  response: Res
) => ({ channel, namespace: "browser" as const, request, response, version: IPC_VERSION })
const browserOnly = z.object({ browserId: BrowserIdSchema }).strict()

export const browserAttachedRegisterContract = contract(
  CYPHERIA_BROWSER_CHANNELS.attachedRegister,
  BrowserAttachedRegistrationSchema,
  z.object({ registered: z.literal(true) }).strict()
)
export const browserUnregisterContract = contract(
  CYPHERIA_BROWSER_CHANNELS.unregister,
  browserOnly,
  z.object({ unregistered: z.literal(true) }).strict()
)
export const browserActiveSetContract = contract(
  CYPHERIA_BROWSER_CHANNELS.activeSet,
  z.object({ browserId: BrowserIdSchema.nullable(), threadId: BrowserThreadIdSchema }).strict(),
  z.object({ updated: z.literal(true) }).strict()
)
export const browserFocusContract = contract(
  CYPHERIA_BROWSER_CHANNELS.focus,
  browserOnly,
  z.object({ focused: z.boolean() }).strict()
)
export const browserDevToolsOpenContract = contract(
  CYPHERIA_BROWSER_CHANNELS.devToolsOpen,
  browserOnly,
  z.object({ opened: z.boolean() }).strict()
)
/** Tabs that have a live guest in any window, so a window does not report them as restored. */
export const browserLiveListContract = contract(
  CYPHERIA_BROWSER_CHANNELS.liveList,
  z.object({}).strict(),
  z.object({ browserIds: z.array(BrowserIdSchema) }).strict()
)
export const browserAutomationExecuteContract = contract(
  CYPHERIA_BROWSER_CHANNELS.automationExecute,
  BrowserTabCallSchema,
  BrowserCallOutcomeSchema
)
export const browserShortcutPolicySetContract = contract(
  CYPHERIA_BROWSER_CHANNELS.shortcutPolicySet,
  BrowserKeyboardPolicySchema,
  z.object({ updated: z.literal(true) }).strict()
)
export const browserDataClearContract = contract(
  CYPHERIA_BROWSER_CHANNELS.dataClear,
  BrowserClearDataSchema,
  z.object({ cleared: z.literal(true) }).strict()
)
