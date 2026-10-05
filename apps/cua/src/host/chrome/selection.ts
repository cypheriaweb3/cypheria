import type { ChromeDriver } from "./driver.ts"

/**
 * How a device drives its `chrome` browsers: through the Cypheria extension and its native host
 * (`extension`), or over the Chrome DevTools Protocol (`cdp`), attaching to a running browser's
 * remote debugging endpoint. The choice is the device's own setting. Neither the Server nor `cua_repl` sees it: both list
 * `chrome` browsers with the same info and API either way.
 */
export const CHROME_IMPLEMENTATION_TYPES = ["extension", "cdp"] as const
export type ChromeImplementationType = (typeof CHROME_IMPLEMENTATION_TYPES)[number]

/** A source of `chrome` drivers, such as `CdpDrivers`. */
export interface ChromeDriverSource {
  drivers(): Promise<readonly ChromeDriver[]>
  dispose?(): void
}

export type SelectedChromeDriversOptions = {
  /** The implementation type the device's settings select; read on every call. */
  readonly selected: () => ChromeImplementationType
  /** The implementation types this build offers. */
  readonly sources: Partial<Record<ChromeImplementationType, ChromeDriverSource>>
}

/**
 * The drivers of the implementation the device selects. An implementation the build does not
 * offer has no browsers. Switching releases the previous implementation's connections.
 */
export class SelectedChromeDrivers implements ChromeDriverSource {
  readonly #options: SelectedChromeDriversOptions
  #current: ChromeImplementationType | undefined

  constructor(options: SelectedChromeDriversOptions) {
    this.#options = options
  }

  /** The implementation types this build offers, in preference order. */
  get available(): ChromeImplementationType[] {
    return CHROME_IMPLEMENTATION_TYPES.filter((name) => this.#options.sources[name])
  }

  /** Whether the selected implementation is offered, so the device can serve `chrome`. */
  get ready(): boolean {
    return !!this.#options.sources[this.#options.selected()]
  }

  async drivers(): Promise<readonly ChromeDriver[]> {
    const selected = this.#options.selected()
    if (this.#current !== undefined && this.#current !== selected) {
      this.#options.sources[this.#current]?.dispose?.()
    }
    this.#current = selected
    return (await this.#options.sources[selected]?.drivers()) ?? []
  }

  dispose(): void {
    for (const source of Object.values(this.#options.sources)) source?.dispose?.()
    this.#current = undefined
  }
}
