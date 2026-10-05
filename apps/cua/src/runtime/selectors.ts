/**
 * Builds Playwright's internal selector strings for locator chains, as Playwright's client does,
 * so the injected script's engines resolve them on the page. The runtime never sees the page;
 * a locator is only its selector until an action runs.
 */
export type TextMatcher = string | RegExp

/** As Playwright's `escapeRegexForSelector`: quotes and `>>` would end the selector part. */
const escapeRegex = (regex: RegExp): string => {
  if (regex.unicode || regex.unicodeSets) return String(regex)
  return String(regex)
    .replace(/(^|[^\\])(\\\\)*(["'`])/gu, "$1$2\\$3")
    .replace(/>>/gu, "\\>\\>")
}

/** A text value in a selector: case-insensitive substring by default, `s` suffix for exact. */
export const escapeForText = (text: TextMatcher, exact = false): string =>
  text instanceof RegExp ? escapeRegex(text) : `${JSON.stringify(text)}${exact ? "s" : "i"}`

/** An attribute value in `[name=value]`: case-insensitive by default, `s` suffix for exact. */
export const escapeForAttribute = (value: TextMatcher, exact = false): string =>
  value instanceof RegExp
    ? escapeRegex(value)
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"${exact ? "s" : "i"}`

export const roleSelector = (
  role: string,
  options: { name?: TextMatcher; exact?: boolean } = {}
): string => {
  const name =
    options.name === undefined ? "" : `[name=${escapeForAttribute(options.name, options.exact)}]`
  return `internal:role=${role}${name}`
}

export const textSelector = (text: TextMatcher, exact?: boolean) =>
  `internal:text=${escapeForText(text, exact)}`

export const labelSelector = (text: TextMatcher, exact?: boolean) =>
  `internal:label=${escapeForText(text, exact)}`

export const placeholderSelector = (text: TextMatcher, exact?: boolean) =>
  `internal:attr=[placeholder=${escapeForAttribute(text, exact)}]`

export const testIdSelector = (testId: string) =>
  `internal:testid=[data-testid=${escapeForAttribute(testId, true)}]`

export type FilterOptions = {
  hasText?: TextMatcher
  hasNotText?: TextMatcher
  has?: { readonly selector: string }
  hasNot?: { readonly selector: string }
  visible?: boolean
}

/** The selector parts a `filter()` or `locator()` option bag adds. */
export const filterSelector = (options: FilterOptions = {}): string => {
  const parts: string[] = []
  if (options.hasText !== undefined)
    parts.push(`internal:has-text=${escapeForText(options.hasText)}`)
  if (options.hasNotText !== undefined) {
    parts.push(`internal:has-not-text=${escapeForText(options.hasNotText)}`)
  }
  if (options.has) parts.push(`internal:has=${JSON.stringify(options.has.selector)}`)
  if (options.hasNot) parts.push(`internal:has-not=${JSON.stringify(options.hasNot.selector)}`)
  if (options.visible !== undefined) parts.push(`visible=${options.visible ? "true" : "false"}`)
  return parts.join(" >> ")
}

export const chain = (...parts: (string | undefined)[]): string =>
  parts.filter((part): part is string => Boolean(part)).join(" >> ")

/** Entering a frame: the frame element's selector, then every later part runs inside it. */
export const ENTER_FRAME = "internal:control=enter-frame"
