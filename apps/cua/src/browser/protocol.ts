import { z } from "zod"

import { BROWSER_MEMBERS, type BrowserMember, isBrowserMember } from "./members.ts"
import { BROWSER_BACKENDS } from "./types.ts"

const id = z.string().min(1).max(256)
/** A Playwright selector the runtime built from a locator chain, frames included. */
const selector = z.string().min(1).max(20_000)

const call = {
  args: z.array(z.unknown()).max(16),
  handle: id.optional(),
  member: z.string().min(1).max(64),
  selector: selector.optional(),
  tab: id.optional(),
}

/**
 * A browser request from the runtime: list the browsers, or call one member of a browser, one of
 * its tabs, a locator in a tab, or a download or file chooser a tab handed out. `browser` is an
 * ID or alias from `browsers.list`; the Server resolves it.
 */
export const BrowserRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("browsers.list") }).strict(),
  z.object({ browser: id, op: z.literal("browser.call"), ...call }).strict(),
])
export type BrowserRequest = z.input<typeof BrowserRequestSchema>

/**
 * A browser request as a host receives it: the Server has resolved the browser to one the host
 * owns, named the backend that serves it, and checked the member against the browser's type.
 */
export const BrowserHostRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("browsers.list") }).strict(),
  z
    .object({
      browser: id,
      op: z.literal("browser.call"),
      backend: z.enum(BROWSER_BACKENDS),
      ...call,
    })
    .strict(),
])
export type BrowserHostRequest = z.input<typeof BrowserHostRequestSchema>
export type ParsedBrowserHostRequest = z.output<typeof BrowserHostRequestSchema>
export type BrowserHostCall = Extract<ParsedBrowserHostRequest, { op: "browser.call" }>

/** A member call whose arguments matched the member's schema. */
export type ValidatedCall = {
  readonly member: BrowserMember
  readonly args: readonly unknown[]
}

/**
 * Checks a call's member and arguments, and that the call names what the member acts on.
 * Returns an error message for the model instead of throwing.
 */
export const validateCall = (input: {
  readonly member: string
  readonly args: readonly unknown[]
  readonly tab?: string
  readonly selector?: string
  readonly handle?: string
}): ValidatedCall | { readonly error: string } => {
  if (!isBrowserMember(input.member)) return { error: `Unknown browser API: ${input.member}.` }
  const spec = BROWSER_MEMBERS[input.member]
  const needsTab = spec.scope === "tab" || spec.scope === "locator" || spec.scope === "handle"
  if (needsTab && !input.tab) return { error: `${input.member} needs a tab.` }
  if (spec.scope === "locator" && !input.selector) {
    return { error: `${input.member} needs a locator.` }
  }
  if (spec.scope === "handle" && !input.handle) {
    return { error: `${input.member} needs a download or file chooser from waitForEvent().` }
  }
  // Optional trailing arguments may be omitted; the schemas are tuples with optional tails.
  const args = [...input.args]
  while (args.length > 0 && args.at(-1) === undefined) args.pop()
  const parsed = spec.args.safeParse(args)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? ` (argument ${issue.path.join(".")})` : ""
    return { error: `Invalid arguments for ${input.member}${where}: ${issue?.message}` }
  }
  return { args: parsed.data, member: input.member }
}
