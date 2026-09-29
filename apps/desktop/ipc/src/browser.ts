import {
  BrowserAutomationOutcomeSchema,
  BrowserAutomationRequestSchema,
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
export const browserAutomationExecuteContract = contract(
  CYPHERIA_BROWSER_CHANNELS.automationExecute,
  BrowserAutomationRequestSchema,
  BrowserAutomationOutcomeSchema
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
