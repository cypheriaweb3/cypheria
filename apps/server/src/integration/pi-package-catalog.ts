import { z } from "zod"

/** The marketplace that lists public Pi packages. */
export const PI_PACKAGE_CATALOG = "pi-package-catalog"

const SEARCH_URL = "https://registry.npmjs.org/-/v1/search"
const PAGE_SIZE = 250
const CACHE_MS = 60 * 60 * 1000

const SearchSchema = z.object({
  objects: z.array(
    z.object({
      package: z
        .object({
          description: z.string().optional(),
          links: z.object({ homepage: z.string().optional() }).passthrough().optional(),
          name: z.string().min(1),
          publisher: z.object({ username: z.string() }).passthrough().optional(),
          version: z.string(),
        })
        .passthrough(),
    })
  ),
})

export type PiPackage = {
  description: string | null
  name: string
  publisher: string | null
  version: string
}

/**
 * Public Pi packages: npm packages with the `pi-package` keyword, the index the Pi package
 * gallery at pi.dev/packages shows. Results are cached for an hour.
 */
export class PiPackageCatalog {
  readonly #fetch: typeof fetch
  #cached: { at: number; packages: PiPackage[] } | undefined

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.#fetch = options.fetch ?? fetch
  }

  async list(forceRefresh = false): Promise<PiPackage[]> {
    if (!forceRefresh && this.#cached && Date.now() - this.#cached.at < CACHE_MS) {
      return this.#cached.packages
    }
    const url = new URL(SEARCH_URL)
    url.searchParams.set("text", "keywords:pi-package")
    url.searchParams.set("size", String(PAGE_SIZE))
    const response = await this.#fetch(url, { headers: { accept: "application/json" } })
    if (!response.ok) throw new Error(`The npm registry search failed with ${response.status}`)
    const parsed = SearchSchema.parse(await response.json())
    const packages = parsed.objects.map(({ package: entry }) => ({
      description: entry.description?.trim() || null,
      name: entry.name,
      publisher: entry.publisher?.username ?? null,
      version: entry.version,
    }))
    this.#cached = { at: Date.now(), packages }
    return packages
  }

  async find(name: string): Promise<PiPackage | undefined> {
    return (await this.list()).find((entry) => entry.name === name)
  }
}
