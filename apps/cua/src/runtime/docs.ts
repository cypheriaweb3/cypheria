import apps from "../../docs/apps.md?raw"
import browsers from "../../docs/browsers.md?raw"
import confirmations from "../../docs/confirmations.md?raw"
import core from "../../docs/core.md?raw"
import iab from "../../docs/iab.md?raw"
import mcpApps from "../../docs/mcp-apps.md?raw"
import pages from "../../docs/pages.md?raw"
import type { CuaSurface } from "../surfaces.ts"
import { writeText } from "./host.ts"

/** The documentation each surface adds on first use; pages share the page-interaction guide. */
const SURFACE_DOCS: Record<CuaSurface, readonly string[]> = {
  browsers: [pages, browsers],
  computer: [apps],
  iab: [pages, iab],
  mcpapps: [pages, mcpApps],
}

/**
 * Shows documentation progressively: the core guide when the runtime starts, and each surface's
 * guide the first time the model enters that surface. `rewrite` repeats everything shown so far,
 * for a context that was summarized.
 */
export class Documentation {
  readonly #shown: string[] = []

  constructor(readonly platform: string) {}

  start(): void {
    this.#show(`${core.trimEnd()}\n\n${confirmations.trimEnd()}`)
  }

  enter(surface: CuaSurface): void {
    for (const document of SURFACE_DOCS[surface]) this.#show(document.trimEnd())
  }

  rewrite(): void {
    for (const document of this.#shown) writeText(document)
  }

  #show(document: string): void {
    const rendered = document.replaceAll("{platform}", this.platform)
    if (this.#shown.includes(rendered)) return
    this.#shown.push(rendered)
    writeText(rendered)
  }
}
