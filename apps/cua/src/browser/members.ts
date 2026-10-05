import { z } from "zod"

import type { BrowserBackend } from "./types.ts"

/**
 * The browser API members the runtime forwards to a host, by their path in ChatGPT's
 * `agent.browsers` API (`api.json`). Builders such as `locator()`, `getByRole()`, `first()`, and
 * `frameLocator()` stay in the runtime and arrive here as one Playwright selector; `write()`
 * variants arrive as `ax.get`. Each member says which object it acts on, whether it changes
 * page or browser state, and which browser types support it.
 */
export type MemberScope = "browser" | "user" | "tabs" | "tab" | "locator" | "handle"

export type MemberSpec = {
  readonly scope: MemberScope
  readonly args: z.ZodType<readonly unknown[]>
  /** Whether the member changes a page, a tab, or the browser; mutations are audited. */
  readonly mutates: boolean
  readonly types: readonly BrowserBackend[]
}

const ALL: readonly BrowserBackend[] = ["iab", "chrome", "mcpapps"]
const PAGES: readonly BrowserBackend[] = ["iab", "chrome"]
const USER: readonly BrowserBackend[] = ["chrome"]

const text = z.string().max(100_000)
const url = z.string().min(1).max(8_192)
const timeout = z.int().positive().max(300_000)
const index = z.int().nonnegative()
const point = z.tuple([z.number().finite(), z.number().finite()])
const target = z.union([index, point])
const nullableIndex = index.nullable()
const keys = z.array(z.string().min(1).max(64)).min(1).max(8)
const modifiers = z.array(z.string().min(1).max(32)).max(4)
const xy = { x: z.number().finite(), y: z.number().finite() }
const direction = z.enum(["up", "down", "left", "right", "u", "d", "l", "r"])
const mouseButton = z.enum(["left", "right", "middle", "l", "r", "m"])
/** A page or element function, already turned into source text by the runtime. */
const script = z.string().min(1).max(200_000)
const timeoutOptions = z.object({ timeoutMs: timeout.optional() }).strict()
const optional = <S extends z.ZodType>(schema: S) => schema.optional()

const member = (
  scope: MemberScope,
  args: z.ZodType<readonly unknown[]>,
  mutates: boolean,
  types: readonly BrowserBackend[] = PAGES
): MemberSpec => ({ args, mutates, scope, types })

export const BROWSER_MEMBERS = {
  // Browser
  "browser.nameSession": member("browser", z.tuple([z.string().min(1).max(80)]), false),
  "browser.capabilities": member("browser", z.tuple([]), false),
  "browser.capability": member(
    "browser",
    z.tuple([z.string().min(1).max(64), z.string().min(1).max(64), z.array(z.unknown()).max(8)]),
    true
  ),
  // User-owned tabs
  "user.openTabs": member("user", z.tuple([]), false, USER),
  "user.claimTab": member("user", z.tuple([z.string().min(1).max(256)]), true, USER),
  // Tabs
  "tabs.list": member("tabs", z.tuple([]), false, ALL),
  "tabs.get": member("tabs", z.tuple([z.string().min(1).max(256)]), false, ALL),
  "tabs.new": member("tabs", z.tuple([]), true),
  "tabs.selected": member("tabs", z.tuple([]), false),
  // Tab
  "tab.info": member("tab", z.tuple([]), false, ALL),
  "tab.goto": member("tab", z.tuple([url]), true),
  "tab.back": member("tab", z.tuple([]), true),
  "tab.forward": member("tab", z.tuple([]), true),
  "tab.reload": member("tab", z.tuple([]), true),
  "tab.close": member("tab", z.tuple([]), true),
  "tab.screenshot": member(
    "tab",
    z.tuple([
      optional(
        z
          .object({
            clip: z
              .object({
                height: z.number().positive(),
                width: z.number().positive(),
                ...xy,
              })
              .strict()
              .optional(),
            fullPage: z.boolean().optional(),
          })
          .strict()
      ),
    ]),
    false,
    ALL
  ),
  "tab.getJsDialog": member("tab", z.tuple([]), false),
  "tab.markDeliverable": member("tab", z.tuple([]), false),
  "tab.markHandoff": member("tab", z.tuple([]), false),
  "tab.requestManualHandoff": member("tab", z.tuple([optional(text)]), false, ["iab"]),
  "tab.capabilities": member("tab", z.tuple([]), false),
  // Content exports save a file and, for YouTube, briefly switch the player's captions.
  "content.exportGsuite": member(
    "tab",
    z.tuple([z.enum(["pdf", "md", "xlsx", "csv", "docx", "pptx"])]),
    true
  ),
  "content.exportYouTubeTranscript": member("tab", z.tuple([]), true),
  "tab.capability": member(
    "tab",
    z.tuple([z.string().min(1).max(64), z.string().min(1).max(64), z.array(z.unknown()).max(8)]),
    true
  ),
  "dialog.accept": member("tab", z.tuple([optional(text)]), true),
  "dialog.dismiss": member("tab", z.tuple([]), true),
  // Accessibility
  "ax.get": member("tab", z.tuple([optional(z.enum(["state", "screenshot", "both"]))]), false),
  "ax.click": member(
    "tab",
    z.tuple([
      target,
      optional(
        z
          .object({
            clickCount: z.int().min(1).max(3).optional(),
            mouseButton: mouseButton.optional(),
          })
          .strict()
      ),
    ]),
    true
  ),
  "ax.drag": member("tab", z.tuple([point, point]), true),
  "ax.paste": member(
    "tab",
    z.tuple([
      nullableIndex,
      text,
      optional(z.object({ format: z.enum(["text", "md", "html"]).optional() }).strict()),
    ]),
    true
  ),
  "ax.performSecondaryAction": member("tab", z.tuple([index, z.string().min(1).max(64)]), true),
  "ax.pressKey": member("tab", z.tuple([nullableIndex, z.string().min(1).max(64)]), true),
  "ax.scroll": member(
    "tab",
    z.tuple([target, direction, optional(z.number().positive().max(50))]),
    true
  ),
  "ax.selectText": member(
    "tab",
    z.tuple([
      index,
      text,
      optional(
        z
          .object({
            prefix: z.string().max(10_000).optional(),
            selectionType: z.enum(["text", "cursor_before", "cursor_after"]).optional(),
            suffix: z.string().max(10_000).optional(),
          })
          .strict()
      ),
    ]),
    true
  ),
  "ax.setValue": member("tab", z.tuple([index, text]), true),
  "ax.typeText": member("tab", z.tuple([nullableIndex, text]), true),
  // Coordinate input
  "cua.click": member(
    "tab",
    z.tuple([
      z
        .object({ button: z.int().min(1).max(5).optional(), keypress: modifiers.optional(), ...xy })
        .strict(),
    ]),
    true
  ),
  "cua.double_click": member(
    "tab",
    z.tuple([z.object({ keypress: modifiers.optional(), ...xy }).strict()]),
    true
  ),
  "cua.drag": member(
    "tab",
    z.tuple([
      z
        .object({
          keys: modifiers.optional(),
          path: z.array(z.object(xy).strict()).min(2).max(1_000),
        })
        .strict(),
    ]),
    true
  ),
  "cua.keypress": member("tab", z.tuple([z.object({ keys }).strict()]), true),
  "cua.move": member(
    "tab",
    z.tuple([z.object({ keys: modifiers.optional(), ...xy }).strict()]),
    true
  ),
  "cua.scroll": member(
    "tab",
    z.tuple([
      z
        .object({
          keypress: modifiers.optional(),
          scrollX: z.number().finite(),
          scrollY: z.number().finite(),
          ...xy,
        })
        .strict(),
    ]),
    true
  ),
  "cua.type": member("tab", z.tuple([z.object({ text }).strict()]), true),
  // Visible DOM
  "dom.get_visible_dom": member("tab", z.tuple([]), false),
  "dom.click": member("tab", z.tuple([z.object({ node_id: z.string().min(1) }).strict()]), true),
  "dom.double_click": member(
    "tab",
    z.tuple([z.object({ node_id: z.string().min(1) }).strict()]),
    true
  ),
  "dom.keypress": member("tab", z.tuple([z.object({ keys }).strict()]), true),
  "dom.scroll": member(
    "tab",
    z.tuple([
      z.object({ node_id: z.string().min(1).optional(), x: z.number(), y: z.number() }).strict(),
    ]),
    true
  ),
  "dom.type": member("tab", z.tuple([z.object({ text }).strict()]), true),
  // Page through Playwright
  "playwright.domSnapshot": member("tab", z.tuple([]), false, ALL),
  "playwright.elementInfo": member(
    "tab",
    z.tuple([z.object({ includeNonInteractable: z.boolean().optional(), ...xy }).strict()]),
    false
  ),
  "playwright.elementScreenshot": member(
    "tab",
    z.tuple([z.object({ includeNonInteractable: z.boolean().optional(), ...xy }).strict()]),
    false
  ),
  "playwright.evaluate": member(
    "tab",
    z.tuple([script, z.unknown(), optional(timeoutOptions)]),
    false,
    ALL
  ),
  "playwright.navigationCount": member("tab", z.tuple([]), false),
  "playwright.waitForEvent": member(
    "tab",
    z.tuple([z.enum(["download", "filechooser"]), optional(timeoutOptions)]),
    false
  ),
  "playwright.waitForLoadState": member(
    "tab",
    z.tuple([
      optional(
        z
          .object({
            state: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
            timeoutMs: timeout.optional(),
          })
          .strict()
      ),
    ]),
    false
  ),
  "playwright.waitForURL": member(
    "tab",
    z.tuple([
      z.union([
        url,
        z.object({ flags: z.string().max(8), source: z.string().min(1).max(8_192) }).strict(),
      ]),
      optional(
        z
          .object({
            timeoutMs: timeout.optional(),
            waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).optional(),
          })
          .strict()
      ),
    ]),
    false
  ),
  // Locators, which carry their selector beside the arguments
  "locator.count": member("locator", z.tuple([]), false, ALL),
  "locator.all": member("locator", z.tuple([]), false, ALL),
  "locator.allTextContents": member("locator", z.tuple([optional(timeoutOptions)]), false, ALL),
  "locator.textContent": member("locator", z.tuple([optional(timeoutOptions)]), false, ALL),
  "locator.innerText": member("locator", z.tuple([optional(timeoutOptions)]), false, ALL),
  "locator.getAttribute": member(
    "locator",
    z.tuple([z.string().min(1).max(256), optional(timeoutOptions)]),
    false,
    ALL
  ),
  "locator.isEnabled": member("locator", z.tuple([]), false, ALL),
  "locator.isVisible": member("locator", z.tuple([]), false, ALL),
  "locator.waitFor": member(
    "locator",
    z.tuple([
      optional(
        z
          .object({
            state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
            timeoutMs: timeout.optional(),
          })
          .strict()
      ),
    ]),
    false,
    ALL
  ),
  "locator.downloadMedia": member("locator", z.tuple([optional(timeoutOptions)]), true),
  "locator.evaluate": member(
    "locator",
    z.tuple([script, z.unknown(), optional(timeoutOptions)]),
    false,
    ALL
  ),
  "locator.evaluateAll": member(
    "locator",
    z.tuple([script, z.unknown(), optional(timeoutOptions)]),
    false,
    ALL
  ),
  "locator.click": member(
    "locator",
    z.tuple([
      optional(
        z
          .object({
            button: z.enum(["left", "right", "middle"]).optional(),
            force: z.boolean().optional(),
            modifiers: modifiers.optional(),
            timeoutMs: timeout.optional(),
          })
          .strict()
      ),
    ]),
    true,
    ALL
  ),
  "locator.dblclick": member(
    "locator",
    z.tuple([
      optional(
        z
          .object({
            button: z.enum(["left", "right", "middle"]).optional(),
            force: z.boolean().optional(),
            modifiers: modifiers.optional(),
            timeoutMs: timeout.optional(),
          })
          .strict()
      ),
    ]),
    true
  ),
  "locator.fill": member("locator", z.tuple([text, optional(timeoutOptions)]), true, ALL),
  "locator.type": member("locator", z.tuple([text, optional(timeoutOptions)]), true, ALL),
  "locator.pressSequentially": member("locator", z.tuple([text, optional(timeoutOptions)]), true),
  "locator.press": member(
    "locator",
    z.tuple([z.string().min(1).max(64), optional(timeoutOptions)]),
    true
  ),
  "locator.check": member(
    "locator",
    z.tuple([
      optional(z.object({ force: z.boolean().optional(), timeoutMs: timeout.optional() }).strict()),
    ]),
    true,
    ALL
  ),
  "locator.uncheck": member(
    "locator",
    z.tuple([
      optional(z.object({ force: z.boolean().optional(), timeoutMs: timeout.optional() }).strict()),
    ]),
    true,
    ALL
  ),
  "locator.setChecked": member(
    "locator",
    z.tuple([
      z.boolean(),
      optional(z.object({ force: z.boolean().optional(), timeoutMs: timeout.optional() }).strict()),
    ]),
    true,
    ALL
  ),
  "locator.selectOption": member(
    "locator",
    z.tuple([
      z.array(
        z.union([
          z.string(),
          z
            .object({
              index: z.int().nonnegative().optional(),
              label: z.string().optional(),
              value: z.string().optional(),
            })
            .strict(),
        ])
      ),
      optional(timeoutOptions),
    ]),
    true,
    ALL
  ),
  // Downloads and file choosers waited for with `waitForEvent`
  "download.path": member("handle", z.tuple([optional(timeoutOptions)]), false),
  "fileChooser.setFiles": member(
    "handle",
    z.tuple([z.array(z.string().min(1).max(4_096)).min(1).max(32), optional(timeoutOptions)]),
    true
  ),
  // Clipboard and developer tools
  "clipboard.read": member("tab", z.tuple([]), false),
  "clipboard.readText": member("tab", z.tuple([]), false),
  "clipboard.write": member(
    "tab",
    z.tuple([
      z
        .array(
          z
            .object({
              entries: z
                .array(
                  z
                    .object({
                      base64: z.string().max(10_000_000).optional(),
                      mimeType: z.string().min(1).max(128),
                      text: text.optional(),
                    })
                    .strict()
                )
                .min(1)
                .max(8),
              presentationStyle: z.enum(["unspecified", "inline", "attachment"]).optional(),
            })
            .strict()
        )
        .max(8),
    ]),
    false
  ),
  "clipboard.writeText": member("tab", z.tuple([text]), false),
  "dev.logs": member(
    "tab",
    z.tuple([
      optional(
        z
          .object({
            filter: z.string().max(1_000).optional(),
            levels: z
              .array(z.enum(["debug", "info", "log", "warn", "error", "warning"]))
              .max(6)
              .optional(),
            limit: z.int().positive().max(1_000).optional(),
          })
          .strict()
      ),
    ]),
    false
  ),
} as const satisfies Record<string, MemberSpec>

export type BrowserMember = keyof typeof BROWSER_MEMBERS
export const BROWSER_MEMBER_NAMES = Object.keys(BROWSER_MEMBERS) as BrowserMember[]

export const isBrowserMember = (name: string): name is BrowserMember =>
  Object.hasOwn(BROWSER_MEMBERS, name)

/** Whether a browser of `type` supports `member`. */
export const supports = (type: BrowserBackend, member: BrowserMember): boolean =>
  BROWSER_MEMBERS[member].types.includes(type)
