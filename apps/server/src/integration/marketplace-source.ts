import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

/** Files a local marketplace directory can carry, one per Agent that can read it. */
export const MARKETPLACE_FILES = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
] as const

/** Names Cypheria or an Agent vendor owns; a marketplace added from a source may not take them. */
export const RESERVED_MARKETPLACE_NAMES: ReadonlySet<string> = new Set([
  "cypheria-bundled",
  "openai-api-curated",
  "openai-bundled",
  "openai-curated",
  "openai-curated-remote",
  "openai-primary-runtime",
])

const MARKETPLACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const hasControl = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f
  })
const GITHUB = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[#@][^\s#@]+)?$/u
const SCP_LIKE = /^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+:[^\s]+$/u
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/u
const REF = /^[A-Za-z0-9._/-]{1,200}$/u

const invalid = (message: string): Error => {
  const error = new Error(message)
  error.name = "INTEGRATION_INVALID"
  return error
}

export type MarketplaceSourceInput = {
  refName?: string
  source: string
  sparsePaths?: string[]
}

const validateRemote = (source: string): void => {
  if (/\s/u.test(source)) throw invalid("A marketplace URL cannot contain spaces")
  if (!URL_SCHEME.test(source)) return
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw invalid("The marketplace URL is not valid")
  }
  if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) {
    throw invalid(`Marketplaces cannot be added over ${url.protocol}`)
  }
  if (!url.hostname) throw invalid("The marketplace URL has no host")
  // The source is stored and shown again, so it must not carry a secret.
  if (url.password || (url.username && (url.protocol === "https:" || url.protocol === "http:"))) {
    throw invalid(
      "The marketplace URL contains credentials. Remove them and use a git credential helper."
    )
  }
}

const validateLocal = async (path: string): Promise<string> => {
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
  if (!isAbsolute(expanded)) {
    throw invalid("Use an absolute path for a local marketplace")
  }
  const absolute = resolve(expanded)
  const info = await stat(absolute).catch(() => undefined)
  if (!info) throw invalid(`${absolute} does not exist`)
  if (info.isFile()) {
    if (!absolute.endsWith(".json")) throw invalid("A local marketplace file must be a .json file")
    return absolute
  }
  if (!info.isDirectory()) throw invalid(`${absolute} is not a directory`)
  const found = await Promise.all(
    MARKETPLACE_FILES.map((file) =>
      stat(join(absolute, file)).then(
        (entry) => entry.isFile(),
        () => false
      )
    )
  )
  if (!found.some(Boolean)) {
    throw invalid(`${absolute} has none of ${MARKETPLACE_FILES.join(" or ")}`)
  }
  return absolute
}

/**
 * Checks and normalizes a marketplace source before any Agent sees it. The
 * Agents still read the marketplace itself; this keeps malformed input,
 * option-like strings, credentials, and missing local files out of them.
 */
export const normalizeMarketplaceInput = async (
  input: MarketplaceSourceInput
): Promise<MarketplaceSourceInput> => {
  const source = input.source.trim()
  if (!source) throw invalid("Enter a marketplace source")
  if (source.length > 2048) throw invalid("The marketplace source is too long")
  if (hasControl(source)) throw invalid("The marketplace source contains control characters")
  if (source.startsWith("-")) throw invalid("A marketplace source cannot start with a dash")

  let normalized: string
  if (source.startsWith("/") || source.startsWith("~/") || WINDOWS_DRIVE.test(source)) {
    normalized = await validateLocal(source)
  } else if (source.startsWith("./") || source.startsWith("../")) {
    throw invalid("Use an absolute path for a local marketplace")
  } else if (URL_SCHEME.test(source)) {
    validateRemote(source)
    normalized = source
  } else if (SCP_LIKE.test(source)) {
    normalized = source
  } else if (GITHUB.test(source)) {
    normalized = source
  } else {
    throw invalid(
      "Use owner/repo, a git URL, a hosted marketplace.json URL, or an absolute local path"
    )
  }

  const refName = input.refName?.trim() || undefined
  if (refName !== undefined) {
    if (!REF.test(refName) || refName.startsWith("-") || refName.startsWith("/")) {
      throw invalid("The git ref is not valid")
    }
    if (refName.includes("..")) throw invalid("The git ref is not valid")
  }
  const sparsePaths = input.sparsePaths?.map((path) => path.trim())
  if (sparsePaths) {
    if (sparsePaths.length > 50) throw invalid("Too many sparse paths")
    for (const path of sparsePaths) {
      if (
        !path ||
        hasControl(path) ||
        path.startsWith("-") ||
        path.startsWith("/") ||
        path.startsWith("~") ||
        path.split(/[\\/]/u).includes("..")
      ) {
        throw invalid(`The sparse path ${JSON.stringify(path)} is not valid`)
      }
    }
  }
  return {
    ...(refName ? { refName } : {}),
    source: normalized,
    ...(sparsePaths?.length ? { sparsePaths } : {}),
  }
}

/** A marketplace name a source may register: plain, and not one Cypheria or a vendor owns. */
export const assertMarketplaceName = (name: string): void => {
  if (!MARKETPLACE_NAME.test(name)) {
    throw invalid(`The marketplace name ${JSON.stringify(name)} is not valid`)
  }
  if (RESERVED_MARKETPLACE_NAMES.has(name)) {
    throw invalid(`${name} is a reserved marketplace name. Rename the marketplace in its file.`)
  }
}

/** Two sources that name the same thing compare equal. */
export const sameMarketplaceSource = (
  left: { refName?: string | null; source: string },
  right: { refName?: string | null; source: string }
): boolean => {
  const key = (value: { refName?: string | null; source: string }) => {
    const [base = "", embedded = ""] = value.source.split(/[#@](?=[^/]*$)/u)
    const local = base.startsWith("/") || WINDOWS_DRIVE.test(base)
    const location = base.replace(/\.git$/u, "").replace(/\/+$/u, "")
    return `${local ? location : location.toLowerCase()}#${value.refName ?? embedded}`
  }
  return key(left) === key(right)
}
