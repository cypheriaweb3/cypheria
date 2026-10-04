import type { BrowserMcpAppAction } from "@cypheria/protocol"
import type { WebContents, WebFrameMain } from "electron"

import type { McpAppExecuteResult } from "../../../../ipc/src/index.js"
import { BrowserSnapshotEngine, type SnapshotPage } from "./snapshot-engine.js"

/** Snapshot refs per App, keyed by window and App so refs never cross Apps or windows. */
const engines = new WeakMap<WebContents, BrowserSnapshotEngine>()

const engineFor = (host: WebContents) => {
  let engine = engines.get(host)
  if (!engine) {
    engine = new BrowserSnapshotEngine()
    engines.set(host, engine)
  }
  return engine
}

/**
 * The App document of a mounted MCP App: the frame inside the sandbox proxy whose origin is
 * `origin`, found only within the requesting window.
 */
const appFrame = (host: WebContents, origin: string): WebFrameMain | null => {
  const wanted = origin.replace(/\/$/u, "")
  const proxy = host.mainFrame.framesInSubtree.find(
    (frame) => frame.origin === wanted && frame.parent === host.mainFrame
  )
  if (!proxy) return null
  return proxy.frames.find((frame) => frame.origin === wanted) ?? null
}

const page = (frame: WebFrameMain): SnapshotPage => ({
  executeJavaScript: (code) => frame.executeJavaScript(code),
  getURL: () => frame.url,
})

const KEY_CODES: Record<string, string> = {
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  Backspace: "Backspace",
  Enter: "Enter",
  Escape: "Escape",
  Space: "Space",
  Tab: "Tab",
}

/** Synthetic DOM actions on one element, or the focused element when `expression` is null. */
const actionScript = (expression: string | null, body: string) => `(() => {
  const element = ${expression ?? "document.activeElement || document.body"};
  if (!element || !element.isConnected) return { ok: false, reason: "stale_ref" };
  element.scrollIntoView?.({ block: "center", inline: "center" });
  ${body}
  return { ok: true };
})()`

const scriptFor = (action: BrowserMcpAppAction, expression: string | null): string => {
  switch (action.type) {
    case "click":
      return actionScript(expression, "element.focus?.(); element.click();")
    case "check":
      return actionScript(expression, `if (element.checked !== ${action.checked}) element.click();`)
    case "type":
      return actionScript(
        expression,
        `element.focus?.();
        const text = ${JSON.stringify(action.text)};
        if (!document.execCommand("insertText", false, text) && "value" in element) {
          element.value += text;
          element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
        }`
      )
    case "press": {
      const key = action.key === "Space" ? " " : action.key
      const code = KEY_CODES[action.key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key)
      return actionScript(
        expression,
        `element.focus?.();
        const init = { bubbles: true, cancelable: true, code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)} };
        const proceed = element.dispatchEvent(new KeyboardEvent("keydown", init));
        element.dispatchEvent(new KeyboardEvent("keyup", init));
        if (proceed && init.key === "Enter" && element.form && element.tagName !== "TEXTAREA") element.form.requestSubmit();`
      )
    }
    case "scroll":
      return actionScript(
        expression ?? "document.scrollingElement || document.body",
        `element.scrollBy({ left: ${action.deltaX ?? 0}, top: ${action.deltaY} });`
      )
    default:
      throw new Error(`Unsupported MCP App action ${action.type}`)
  }
}

const refFailure = (ref: string) =>
  new Error(`Ref ${ref} is not in the latest snapshot of this App. Take a snapshot first.`)

/**
 * Runs one DOM action in a mounted MCP App with synthetic events. The App has no native input,
 * navigation, or coordinates; refs come from the same engine as the built-in browser's snapshots.
 */
export const executeMcpAppAction = async (
  host: WebContents,
  input: { action: BrowserMcpAppAction; appId: string; origin: string }
): Promise<McpAppExecuteResult> => {
  const frame = appFrame(host, input.origin)
  if (!frame) throw new Error("This MCP App is no longer open. List the Apps again.")
  const engine = engineFor(host)
  const key = `mcpapp:${input.appId}`
  const { action } = input
  if (action.type === "snapshot") {
    const snapshot = await engine.snapshot({ browserId: key, page: page(frame) })
    return { snapshot: snapshot.snapshot }
  }
  if (action.type === "screenshot") {
    const rect = (await host.mainFrame.executeJavaScript(`(() => {
      const frame = [...document.querySelectorAll("iframe")].find((item) => item.src.startsWith(${JSON.stringify(input.origin.replace(/\/$/u, ""))}));
      if (!frame) return null;
      const box = frame.getBoundingClientRect();
      return { height: Math.round(box.height), width: Math.round(box.width), x: Math.round(box.left), y: Math.round(box.top) };
    })()`)) as { height: number; width: number; x: number; y: number } | null
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      throw new Error("The MCP App is not visible, so it cannot be captured.")
    }
    const image = await host.capturePage(rect)
    return { dataBase64: image.toPNG().toString("base64"), mimeType: "image/png" }
  }
  if (action.type === "fill" || action.type === "select") {
    const result = await engine[action.type]({
      browserId: key,
      page: page(frame),
      ref: action.ref,
      value: action.value,
    })
    if (!result.ok) throw refFailure(action.ref)
    return {}
  }
  const ref = "ref" in action ? action.ref : undefined
  let expression: string | null = null
  if (ref) {
    const resolved = engine.runtimeElementExpression({ browserId: key, ref })
    if (typeof resolved !== "string") throw refFailure(ref)
    expression = resolved
  }
  const result = (await frame.executeJavaScript(scriptFor(action, expression))) as {
    ok: boolean
  } | null
  if (!result?.ok) throw ref ? refFailure(ref) : new Error("The App has no focused element.")
  return {}
}
