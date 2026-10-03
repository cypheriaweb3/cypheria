import {
  type BrowserAutomationCommandName,
  BrowserAutomationCommandSchema,
  type BrowserAutomationDialogEvent,
  type BrowserAutomationOutcome,
} from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"
import { z } from "zod"

const TAB_HINT = "Use a browserId from browser_new_tab or browser_list_tabs."
const REF_HINT =
  "Refs come from the latest browser_snapshot of the same tab and expire when the page changes."

const DESCRIPTIONS: Record<BrowserAutomationCommandName, string> = {
  back: `Go back in a Cypheria browser tab's history. ${TAB_HINT}`,
  click: `Click an element with real mouse input after waiting for it to be visible, enabled, and stable. ${REF_HINT}`,
  close_tab: `Close a Cypheria browser tab. ${TAB_HINT}`,
  drag: `Drag one element onto another. ${REF_HINT}`,
  evaluate: `Run a JavaScript function in the page and return its JSON result. With ref, the element is passed as the first argument. ${REF_HINT}`,
  fill: `Replace the value of an input-like element. ${REF_HINT}`,
  forward: `Go forward in a Cypheria browser tab's history. ${TAB_HINT}`,
  hover: `Hover an element with real mouse input so CSS :hover applies. ${REF_HINT}`,
  keypress:
    "Press a key such as Enter, Escape, Tab, or ArrowDown on an element or the focused element.",
  list_tabs:
    "List the Cypheria browser tabs attached to this thread across connected Desktop apps, including whether each tab is a web or dApp tab.",
  logs: `Read recent console messages and network timing for a tab. ${TAB_HINT}`,
  navigate: `Load an http(s) URL in a tab. ${TAB_HINT}`,
  new_tab:
    "Open a background Cypheria browser tab for this thread and return its browserId. kind=dapp opens the wallet-enabled dApp browser; the default web tab has no wallet.",
  reload: `Reload a tab. ${TAB_HINT}`,
  resize: `Set a tab's viewport size, for example to check phone or tablet layouts. ${TAB_HINT}`,
  screenshot: `Capture a PNG of the viewport, or the whole page with fullPage. ${TAB_HINT}`,
  scroll: "Scroll the page, or scroll with the wheel centered over an element when ref is given.",
  select: `Choose an option in a <select> element by its value. ${REF_HINT}`,
  snapshot: `Return the page as an accessibility tree. Interactive elements carry refs such as @e3. ${TAB_HINT}`,
  type: "Type text into an element, or into the focused element when ref is omitted.",
  upload: `Set files on a file input. Paths must be inside this thread's working directory. ${REF_HINT}`,
  wait: "Wait until the page contains text or its URL contains a fragment. Pass exactly one of text or url.",
  mark_deliverable: `Mark a Cypheria browser tab as a deliverable for the user so it remains open after the turn completes. ${TAB_HINT}`,
  mark_handoff: `Mark a Cypheria browser tab as needing user handoff so it remains open after the turn completes. ${TAB_HINT}`,
  request_manual_handoff: `Request manual user intervention on a tab (e.g. for login or 2FA) and activate the tab in the desktop window. ${TAB_HINT}`,
  scan_qr: `Scan the viewport or a specified element (via ref or selector) for a QR code and decode its payload. ${TAB_HINT}`,
  extract_assets: `Extract downloadable or referenced assets (images, SVGs, stylesheets, fonts) from a tab. ${TAB_HINT}`,
}

export const browserToolName = (command: BrowserAutomationCommandName): string =>
  `browser_${command}`

const commandForTool = new Map<string, BrowserAutomationCommandName>(
  BrowserAutomationCommandSchema.options.map((option) => {
    const name = option.shape.command.value
    return [browserToolName(name), name]
  })
)

export const browserCommandForTool = (tool: string): BrowserAutomationCommandName | undefined =>
  commandForTool.get(tool)

/** Codex dynamic tool specs generated from the protocol command schemas. */
export const browserToolSpecs = (): v2.DynamicToolSpec[] =>
  BrowserAutomationCommandSchema.options.map((option) => {
    const name = option.shape.command.value
    return {
      description: DESCRIPTIONS[name],
      inputSchema: z.toJSONSchema(option.shape.args, {
        io: "input",
        target: "draft-7",
        unrepresentable: "any",
      }) as v2.DynamicToolFunctionSpec["inputSchema"],
      name: browserToolName(name),
      type: "function",
    }
  })

const describeDialogs = (dialogs: readonly BrowserAutomationDialogEvent[] | undefined): string =>
  dialogs?.length
    ? `\n\nThe page opened ${dialogs.length} dialog(s): ${dialogs
        .map((dialog) => `${dialog.type} "${dialog.message}" was ${dialog.action}`)
        .join("; ")}.`
    : ""

const summarize = (outcome: Extract<BrowserAutomationOutcome, { ok: true }>): string => {
  const result = outcome.result
  switch (result.command) {
    case "snapshot":
      return [
        `Snapshot of ${result.browserId}: ${result.title || "(untitled)"} — ${result.url}`,
        result.truncated ? "The snapshot was truncated." : "",
        result.snapshot,
      ]
        .filter(Boolean)
        .join("\n")
    case "screenshot":
      return `Screenshot of ${result.browserId} (${result.width}×${result.height}).`
    case "evaluate":
      return `${result.resultJson}${result.truncated ? "\n(result truncated)" : ""}`
    case "scan_qr":
      return result.found
        ? `QR code detected in tab ${result.browserId}: ${result.text}`
        : `No QR code detected in tab ${result.browserId}.`
    case "extract_assets":
      return `Extracted ${result.assets.length} assets from tab ${result.browserId}:\n${result.assets
        .map((asset) => `- [${asset.kind}] ${asset.url}${asset.name ? ` (${asset.name})` : ""}`)
        .join("\n")}`
    case "mark_deliverable":
      return `Tab ${result.browserId} marked as deliverable.`
    case "mark_handoff":
      return `Tab ${result.browserId} marked for handoff.`
    case "request_manual_handoff":
      return `Manual handoff requested for tab ${result.browserId}.`
    default:
      return JSON.stringify(result, null, 2)
  }
}

/** Converts a broker outcome into Codex tool output without losing the structured result. */
export const browserToolResponse = (
  outcome: BrowserAutomationOutcome
): v2.DynamicToolCallResponse => {
  if (!outcome.ok) {
    const retry = outcome.error.retryable ? " This error is retryable." : ""
    return {
      contentItems: [
        {
          text: `${outcome.error.code}: ${outcome.error.message}${retry}${describeDialogs(outcome.dialogs)}`,
          type: "inputText",
        },
      ],
      success: false,
    }
  }
  const contentItems: v2.DynamicToolCallOutputContentItem[] = [
    { text: `${summarize(outcome)}${describeDialogs(outcome.dialogs)}`, type: "inputText" },
  ]
  if (outcome.result.command === "screenshot") {
    contentItems.push({
      imageUrl: `data:${outcome.result.mimeType};base64,${outcome.result.dataBase64}`,
      type: "inputImage",
    })
  }
  return { contentItems, success: true }
}
