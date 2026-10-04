import type { IabTabInfo, McpAppInfo } from "@cypheria/cua"
import { type CuaHostContext, CuaHostError, type DesktopSurfaces } from "@cypheria/cua/host"
import type {
  BrowserAutomationCommandInput,
  BrowserAutomationDialogEvent,
  BrowserAutomationOutcome,
  BrowserAutomationResult,
} from "@cypheria/protocol"

import type { BrowserToolsService } from "../browser-tools/service.js"

const describeDialogs = (dialogs: readonly BrowserAutomationDialogEvent[] | undefined) =>
  dialogs?.length
    ? `The page opened ${dialogs.length} dialog(s): ${dialogs
        .map((dialog) => `${dialog.type} "${dialog.message}" was ${dialog.action}`)
        .join("; ")}.`
    : undefined

/**
 * Built-in browser tabs and MCP Apps for `cua_repl`, through the browser host broker that reaches
 * the Desktop windows. Desktop scopes every command to the calling Thread's tabs and Apps.
 */
export class BrokeredDesktopSurfaces implements DesktopSurfaces {
  readonly #browser: BrowserToolsService

  constructor(browser: BrowserToolsService) {
    this.#browser = browser
  }

  async listTabs(context: CuaHostContext): Promise<IabTabInfo[]> {
    const result = await this.#run(context, { args: {}, command: "list_tabs" })
    return result.command === "list_tabs"
      ? result.tabs
          .filter((tab) => tab.threadId === context.threadId)
          .map((tab) => ({
            active: tab.isActive,
            id: tab.browserId,
            kind: tab.kind,
            title: tab.title,
            url: tab.url,
          }))
      : []
  }

  async newTab(
    context: CuaHostContext,
    options: { url?: string; kind: "web" | "dapp" }
  ): Promise<IabTabInfo> {
    const result = await this.#run(context, {
      args: { kind: options.kind, ...(options.url ? { url: options.url } : {}) },
      command: "new_tab",
    })
    if (result.command !== "new_tab")
      throw new CuaHostError("browser_error", "The browser did not open a tab.")
    return { active: false, id: result.browserId, kind: result.kind, title: "", url: result.url }
  }

  async command(
    context: CuaHostContext,
    tabId: string,
    command: string,
    args: Record<string, unknown>
  ): Promise<{ result: Record<string, unknown>; notice?: string }> {
    const outcome = await this.#execute(context, {
      args: { ...args, browserId: tabId },
      command,
    } as BrowserAutomationCommandInput)
    const result = this.#unwrap(outcome)
    const notice = describeDialogs(outcome.dialogs)
    return { result: result as Record<string, unknown>, ...(notice ? { notice } : {}) }
  }

  async listMcpApps(context: CuaHostContext): Promise<McpAppInfo[]> {
    const result = await this.#run(context, { args: {}, command: "list_mcp_apps" })
    return result.command === "list_mcp_apps"
      ? result.apps
          .filter((app) => app.threadId === context.threadId)
          .map((app) => ({
            displayMode: app.displayMode,
            id: app.appId,
            pluginId: app.pluginId,
            server: app.server,
            title: app.title,
          }))
      : []
  }

  async mcpApp(
    context: CuaHostContext,
    appId: string,
    action: Parameters<DesktopSurfaces["mcpApp"]>[2]
  ): Promise<{ text?: string; image?: { dataBase64: string; mimeType: string } }> {
    const result = await this.#run(context, { args: { action, appId }, command: "mcp_app" })
    if (result.command !== "mcp_app") return {}
    return {
      ...(result.snapshot !== undefined ? { text: result.snapshot } : {}),
      ...(result.dataBase64
        ? { image: { dataBase64: result.dataBase64, mimeType: result.mimeType ?? "image/png" } }
        : {}),
    }
  }

  async #run(
    context: CuaHostContext,
    command: BrowserAutomationCommandInput
  ): Promise<BrowserAutomationResult> {
    return this.#unwrap(await this.#execute(context, command))
  }

  #execute(context: CuaHostContext, command: BrowserAutomationCommandInput) {
    return this.#browser.execute({
      command,
      ...(context.cwd ? { cwd: context.cwd } : {}),
      threadId: context.threadId,
    })
  }

  #unwrap(outcome: BrowserAutomationOutcome): BrowserAutomationResult {
    if (outcome.ok) return outcome.result
    const retry = outcome.error.retryable ? " This error is retryable." : ""
    throw new CuaHostError(outcome.error.code, `${outcome.error.message}${retry}`)
  }
}
