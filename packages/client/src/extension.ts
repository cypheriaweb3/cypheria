import type {
  AgentId,
  ExtensionAppInstance,
  ExtensionAppTarget,
  ExtensionCatalog,
  ExtensionClientMessage,
  ExtensionMentionItem,
  ExtensionModelContext,
} from "@cypheria/protocol"

import { unwrapResult } from "./code-review.js"
import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

export type ExtensionSettingsView = {
  layout: Record<string, unknown>[]
  schema: Record<string, unknown>
  values: Record<string, unknown>
}

/**
 * Plugin Extensions: the catalog of plugin surfaces, App instances and their requests, model
 * context, structured settings, mentions, and the forms extension calls raise.
 */
export interface ExtensionActions {
  catalog(refresh?: boolean, options?: RequestOptions): Promise<ExtensionCatalog>
  /** Opens or attaches to an App instance. Apps render from its stored tool result. */
  open(target: ExtensionAppTarget, options?: RequestOptions): Promise<ExtensionAppInstance>
  /** The instance's App HTML, read in pieces. */
  readResource(
    instanceId: string,
    options?: RequestOptions
  ): Promise<{ mimeType: string | null; text: string }>
  /** One App request, such as `tools/call`, for the instance. */
  request(
    instanceId: string,
    method: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<unknown>
  /** Moves a global page's App to another chat, or to none; returns the updated instance. */
  bind(
    instanceId: string,
    threadId: string | null,
    options?: RequestOptions
  ): Promise<ExtensionAppInstance>
  close(instanceId: string, options?: RequestOptions): Promise<void>
  context: {
    list(threadId: string, options?: RequestOptions): Promise<ExtensionModelContext[]>
    remove(
      input: { index?: number; key: string; threadId: string },
      options?: RequestOptions
    ): Promise<void>
  }
  settings: {
    read(providerId: string, options?: RequestOptions): Promise<ExtensionSettingsView>
    update(
      providerId: string,
      set: Record<string, string | number | boolean>,
      options?: RequestOptions
    ): Promise<Record<string, unknown>>
    runTool(
      providerId: string,
      tool: string,
      options?: RequestOptions
    ): Promise<{ isError: boolean; text: string }>
  }
  mentions: {
    search(
      input: { agentId?: AgentId; providerIds?: string[]; query: string },
      options?: RequestOptions
    ): Promise<{ error: string | null; items: ExtensionMentionItem[]; providerId: string }[]>
  }
  respondElicitation(
    input: {
      action: "accept" | "decline" | "cancel"
      content?: Record<string, unknown>
      elicitationId: string
    },
    options?: RequestOptions
  ): Promise<void>
}

export const createExtensionActions = (client: ServerClient): ExtensionActions => {
  const request = async <T>(
    type: ExtensionClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrapResult<T>(await client.requestExtension(type, payload, options))
  return {
    catalog: (refresh, options) =>
      request("extension.catalog.get.request", refresh ? { refresh } : {}, options),
    bind: async (instanceId, threadId, options) =>
      (
        await request<{ instance: ExtensionAppInstance }>(
          "extension.app.bind.request",
          { instanceId, threadId },
          options
        )
      ).instance,
    close: async (instanceId, options) => {
      await request("extension.app.close.request", { instanceId }, options)
    },
    context: {
      list: async (threadId, options) =>
        (
          await request<{ entries: ExtensionModelContext[] }>(
            "extension.context.list.request",
            { threadId },
            options
          )
        ).entries,
      remove: async (input, options) => {
        await request("extension.context.remove.request", input, options)
      },
    },
    mentions: {
      search: async (input, options) =>
        (
          await request<{
            groups: { error: string | null; items: ExtensionMentionItem[]; providerId: string }[]
          }>("extension.mentions.search.request", input, options)
        ).groups,
    },
    open: async (target, options) =>
      (
        await request<{ instance: ExtensionAppInstance }>(
          "extension.app.open.request",
          { target },
          options
        )
      ).instance,
    readResource: async (instanceId, options) => {
      let offset: number | null = 0
      let text = ""
      let mimeType: string | null = null
      while (offset !== null) {
        const page: { mimeType: string | null; nextOffset: number | null; text: string } =
          await request(
            "extension.app.resource.read.request",
            { instanceId, ...(offset > 0 ? { offset } : {}) },
            options
          )
        text += page.text
        mimeType = page.mimeType
        offset = page.nextOffset
      }
      return { mimeType, text }
    },
    request: async (instanceId, method, params, options) =>
      (
        await request<{ result: unknown }>(
          "extension.app.request.request",
          { instanceId, method, ...(params ? { params } : {}) },
          options
        )
      ).result,
    respondElicitation: async (input, options) => {
      await request("extension.elicitation.respond.request", input, options)
    },
    settings: {
      read: (providerId, options) =>
        request("extension.settings.read.request", { providerId }, options),
      runTool: (providerId, tool, options) =>
        request("extension.settings.tool.request", { providerId, tool }, options),
      update: async (providerId, set, options) =>
        (
          await request<{ values: Record<string, unknown> }>(
            "extension.settings.update.request",
            { providerId, set },
            options
          )
        ).values,
    },
  }
}
