import { BROWSER_MEMBERS, supports, validateCall } from "@cypheria/cua/browser"
import { DomTab } from "@cypheria/cua/dom-engine"
import { EngineError } from "@cypheria/cua/engine"
import type { WebContents, WebFrameMain } from "electron"

import type { BrowserCallOutcome, McpAppCall } from "../../../../ipc/src/index.js"
import { failureOutcome } from "./built-in-tabs.js"

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

/** Captures the App's iframe as the window shows it. */
const captureApp = async (host: WebContents, origin: string) => {
  const rect = (await host.mainFrame.executeJavaScript(`(() => {
    const frame = [...document.querySelectorAll("iframe")].find((item) => item.src.startsWith(${JSON.stringify(origin.replace(/\/$/u, ""))}));
    if (!frame) return null;
    const box = frame.getBoundingClientRect();
    return { height: Math.round(box.height), width: Math.round(box.width), x: Math.round(box.left), y: Math.round(box.top) };
  })()`)) as { height: number; width: number; x: number; y: number } | null
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    throw new EngineError("not_visible", "The MCP App is not visible, so it cannot be captured.")
  }
  const image = await host.capturePage(rect)
  return { data: new Uint8Array(image.toPNG()), mimeType: "image/png" }
}

/**
 * Runs one browser API member in a mounted MCP App on the DOM-only engine. The App has no CDP
 * target, navigation, or native input; the window found the App for the Thread, and this side
 * checks the member against the `mcpapps` support matrix again.
 */
export const executeMcpAppCall = async (
  host: WebContents,
  call: McpAppCall
): Promise<BrowserCallOutcome> => {
  try {
    const validated = validateCall({
      args: call.args,
      member: call.member,
      tab: call.appId,
      ...(call.selector ? { selector: call.selector } : {}),
    })
    if ("error" in validated) throw new EngineError("invalid", validated.error)
    const scope = BROWSER_MEMBERS[validated.member].scope
    if (!supports("mcpapps", validated.member) || (scope !== "tab" && scope !== "locator")) {
      throw new EngineError("invalid", `${validated.member} is not a page member of an MCP App.`)
    }
    const frame = appFrame(host, call.origin)
    if (!frame)
      throw new EngineError("not_found", "This MCP App is no longer open. List the Apps again.")
    const tab = new DomTab(
      {
        evaluate: (expression) => frame.executeJavaScript(expression),
        screenshot: () => captureApp(host, call.origin),
      },
      process.platform
    )
    const value = await tab.call(validated.member, validated.args, {
      ...(call.selector ? { selector: call.selector } : {}),
    })
    return { ok: true, value }
  } catch (error) {
    return failureOutcome(error)
  }
}
