import { EngineError, staleIndex } from "./errors.ts"
import type { PageSession } from "./page.ts"

/** Above this, the state is cut at a line boundary and says so. */
const MAX_STATE_LENGTH = 60_000
const MAX_FRAME_DEPTH = 3

const REF_PATTERN = /\[ref=([a-z0-9]+)\]/gu
const IFRAME_LINE = /^(\s*)- iframe\b.*\[ref=([a-z0-9]+)\]/u

/** Where an index points: a Playwright aria ref in one frame. */
type IndexTarget = { readonly ref: string; readonly frameId: string }

const SNAPSHOT_FN = `(injected) => {
  const root = document.body ?? document.documentElement;
  if (!root) return "";
  return injected.ariaSnapshot(root, { mode: "ai" });
}`

const RESOLVE_FN = `(injected, ref) => {
  const element = injected.querySelector(injected.parseSelector("aria-ref=" + ref), document, false);
  return element && element.isConnected ? element : null;
}`

/**
 * Numbers the interactable elements of a tab's accessibility state. Playwright keeps an
 * element's ref across snapshots while it stays the same element, so an index is stable as long
 * as its element is, and a state shown as a diff keeps the indices of unchanged lines.
 */
export class AxIndex {
  readonly #byRef = new Map<string, number>()
  readonly #byIndex = new Map<number, IndexTarget>()
  /** The indices of the latest state; anything else is stale. */
  #current = new Set<number>()
  #next = 1

  #indexOf(frameId: string, ref: string): number {
    const key = `${frameId}|${ref}`
    let index = this.#byRef.get(key)
    if (index === undefined) {
      index = this.#next++
      this.#byRef.set(key, index)
      this.#byIndex.set(index, { frameId, ref })
    }
    this.#current.add(index)
    return index
  }

  /** Renders the tab's current state, numbering its elements. */
  async state(page: PageSession): Promise<string> {
    this.#current = new Set()
    const frameId = await page.mainFrameId()
    const lines = await this.#frame(page, frameId, 0)
    const info = (await page
      .call("() => ({ title: document.title, url: location.href })", [])
      .catch(() => ({ title: "", url: "" }))) as { title: string; url: string }
    let body = lines.join("\n")
    if (body.length > MAX_STATE_LENGTH) {
      body = `${body.slice(0, MAX_STATE_LENGTH).replace(/\n[^\n]*$/u, "")}\n- (The state is truncated. Scroll, or use Playwright locators to read the rest.)`
    }
    return `Title: ${info.title || "(untitled)"}\nURL: ${info.url}\n${body || "- (The page is empty.)"}`
  }

  async #frame(page: PageSession, frameId: string, depth: number): Promise<string[]> {
    const yaml = String(await page.call(SNAPSHOT_FN, [], { frameId }))
    const output: string[] = []
    for (const line of yaml.split("\n")) {
      if (!line) continue
      const iframe = IFRAME_LINE.exec(line)
      output.push(line.replace(REF_PATTERN, (_, ref: string) => `[${this.#indexOf(frameId, ref)}]`))
      if (!iframe || depth >= MAX_FRAME_DEPTH) continue
      const indent = `${iframe[1]}  `
      const child = await this.#childFrame(page, frameId, iframe[2] as string)
      if (child === undefined) {
        output.push(
          `${indent}- (The frame's content is in another process; use screenshots and coordinates.)`
        )
        continue
      }
      const childLines = await this.#frame(page, child, depth + 1).catch(() => [])
      for (const childLine of childLines) output.push(`${indent}${childLine}`)
    }
    return output
  }

  async #childFrame(page: PageSession, frameId: string, ref: string): Promise<string | undefined> {
    const objectId = (await page
      .call(RESOLVE_FN, [ref], { frameId, handle: true })
      .catch(() => undefined)) as string | undefined
    if (!objectId) return undefined
    try {
      return await page.childFrame(objectId)
    } catch {
      return undefined
    } finally {
      await page.release(objectId)
    }
  }

  /** The element an index names, as a remote object the caller must release. */
  async resolve(page: PageSession, index: number): Promise<{ objectId: string; frameId: string }> {
    const target = this.#byIndex.get(index)
    if (!target || !this.#current.has(index)) throw staleIndex(index)
    const objectId = (await page.call(RESOLVE_FN, [target.ref], {
      frameId: target.frameId,
      handle: true,
    })) as string | undefined
    if (!objectId) throw staleIndex(index)
    return { frameId: target.frameId, objectId }
  }

  /** Forgets every index, after the tab navigated to another document. */
  reset(): void {
    this.#current = new Set()
  }
}

export const assertIndex = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new EngineError(
      "invalid_index",
      "Element indices come from the latest accessibility state, such as 12."
    )
  }
  return value
}
