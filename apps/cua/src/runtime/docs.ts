import apps from "../../docs/apps.md?raw"
import audio from "../../docs/audio.md?raw"
import browser from "../../docs/browser.md?raw"
import browserChrome from "../../docs/browser-chrome.md?raw"
import browserIab from "../../docs/browser-iab.md?raw"
import browserMcpApps from "../../docs/browser-mcpapps.md?raw"
import browserTroubleshooting from "../../docs/browser-troubleshooting.md?raw"
import viewport from "../../docs/capabilities/browser/viewport.md?raw"
import visibility from "../../docs/capabilities/browser/visibility.md?raw"
import chromeTroubleshooting from "../../docs/chrome-troubleshooting.md?raw"
import confirmations from "../../docs/confirmations.md?raw"
import core from "../../docs/core.md?raw"
import fileUploads from "../../docs/file-uploads.md?raw"
import localWebDevelopment from "../../docs/local-web-development.md?raw"
import screenshots from "../../docs/screenshots.md?raw"
import type { BrowserBackend } from "../browser/types.ts"
import { writeText } from "./host.ts"

/**
 * Documents by name, for `agent.documentation.get(name)`: the guides shown as the model reaches
 * each part of the API, the reference documents it reads when their situation comes up, and the
 * guide of each capability.
 */
const DOCUMENTS: Record<string, string> = {
  apps,
  audio,
  browser,
  "browser-chrome": browserChrome,
  "browser-iab": browserIab,
  "browser-mcpapps": browserMcpApps,
  "browser-troubleshooting": browserTroubleshooting,
  "capabilities/browser/viewport": viewport,
  "capabilities/browser/visibility": visibility,
  "chrome-troubleshooting": chromeTroubleshooting,
  confirmations,
  core,
  "file-uploads": fileUploads,
  "local-web-development": localWebDevelopment,
  screenshots,
}

const BROWSER_DOCUMENTS: Record<BrowserBackend, readonly string[]> = {
  chrome: ["browser", "browser-chrome"],
  iab: ["browser", "browser-iab"],
  mcpapps: ["browser", "browser-mcpapps"],
}

/**
 * Shows documentation progressively: the core guide and the confirmation policy when the
 * runtime starts, a browser type's guide the first time a browser of that type is used, a
 * capability's guide the first time it is used, and the native app guide, with computer audio
 * when the Server enables audio, the first time an app is. `rewrite` repeats everything shown so
 * far, for a context that was summarized.
 */
export class Documentation {
  readonly #shown: string[] = []

  constructor(
    readonly platform: string,
    /** Whether the REPL can emit audio, which computer audio recording needs. */
    readonly audio = false
  ) {}

  start(): void {
    this.#show(`${core.trimEnd()}\n\n${confirmations.trimEnd()}`)
  }

  enterBrowser(type: BrowserBackend): void {
    for (const name of BROWSER_DOCUMENTS[type]) this.#show(this.get(name))
  }

  /** Shows a capability's guide, when it has one, the first time the model uses it. */
  enterCapability(scope: "browser" | "tab", id: string): void {
    const name = `capabilities/${scope}/${id}`
    if (DOCUMENTS[name] !== undefined) this.#show(this.get(name))
  }

  enterApps(): void {
    this.#show(this.get("apps"))
    if (this.audio) this.#show(this.get("audio"))
  }

  browserDocumentation(type: BrowserBackend): string {
    return BROWSER_DOCUMENTS[type].map((name) => this.get(name)).join("\n\n")
  }

  get(name: string): string {
    const document = DOCUMENTS[name]
    if (document === undefined) {
      throw new Error(`No document ${name}. Documents: ${Object.keys(DOCUMENTS).join(", ")}.`)
    }
    return document.trimEnd().replaceAll("{platform}", this.platform)
  }

  rewrite(): void {
    for (const document of this.#shown) writeText(document)
  }

  #show(document: string): void {
    if (this.#shown.includes(document)) return
    this.#shown.push(document)
    writeText(document)
  }
}
