import type { Point } from "./input.ts"
import type { CdpTransport } from "./transport.ts"

const CURSOR_ID = "__cypheria_agent_cursor__"

/** An arrow pointer that reads on light and dark pages. */
const ARROW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.3 12.6 L16.4 12.6 Z" fill="#111827" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>'

/**
 * Shows the agent's pointer at a point of the page: a fixed element in a closed shadow root,
 * hidden from the accessibility tree and from hit testing, so it never changes what the page or
 * the engine sees. Failures are ignored; the pointer is only a hint for the person.
 */
export const showAgentCursor = async (transport: CdpTransport, point: Point): Promise<void> => {
  const expression = `(() => {
    let host = document.getElementById(${JSON.stringify(CURSOR_ID)});
    if (!host) {
      host = document.createElement("div");
      host.id = ${JSON.stringify(CURSOR_ID)};
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;margin:-2px 0 0 -3px;z-index:2147483647;pointer-events:none;transition:transform 140ms ease-out";
      host.attachShadow({ mode: "closed" }).innerHTML = ${JSON.stringify(ARROW)};
      document.documentElement.appendChild(host);
    }
    host.style.transform = "translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)";
  })()`
  await transport.send("Runtime.evaluate", { expression }).catch(() => {})
}

/** Removes the agent's pointer, such as when a claimed tab goes back to the person. */
export const hideAgentCursor = async (transport: CdpTransport): Promise<void> => {
  await transport
    .send("Runtime.evaluate", {
      expression: `document.getElementById(${JSON.stringify(CURSOR_ID)})?.remove()`,
    })
    .catch(() => {})
}
