import type { CodexHarnessClientMessage, CodexHarnessServerMessage } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends CodexHarnessClientMessage["type"]> = Extract<
  CodexHarnessClientMessage,
  { type: T }
>["payload"]
type Value<T extends CodexHarnessServerMessage["type"]> = Extract<
  Extract<CodexHarnessServerMessage, { type: T }>["payload"],
  { ok: true }
>["value"]

const unwrap = <T>(message: CodexHarnessServerMessage): T => {
  const payload = message.payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface CodexHarnessActions {
  readonly guardian: {
    retry(
      input: Payload<"harness.codex.guardian.retry.request">,
      options?: RequestOptions
    ): Promise<void>
  }
  readonly account: {
    cancelLogin(loginId: string, options?: RequestOptions): Promise<boolean>
    get(
      refresh?: boolean,
      options?: RequestOptions
    ): Promise<Value<"harness.codex.account.get.response">>
    login(
      input: Payload<"harness.codex.account.login.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.codex.account.login.response">>
    logout(options?: RequestOptions): Promise<void>
    rateLimits(
      input?: v2.GetAccountRateLimitsParams,
      options?: RequestOptions
    ): Promise<v2.GetAccountRateLimitsResponse>
    subscribeRateLimits(
      handler: (update: v2.AccountRateLimitsUpdatedNotification) => void
    ): () => void
  }
  readonly models: {
    list(
      includeHidden?: boolean,
      options?: RequestOptions
    ): Promise<Value<"harness.codex.model.list.response">["models"]>
    settings(options?: RequestOptions): Promise<Value<"harness.codex.model-settings.get.response">>
    setSettings(
      input: Payload<"harness.codex.model-settings.set.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.codex.model-settings.set.response">>
  }
  readonly permissions: {
    catalog(
      cwd?: string,
      options?: RequestOptions
    ): Promise<Value<"harness.codex.permissions.catalog.get.response">>
    defaults(
      options?: RequestOptions
    ): Promise<Value<"harness.codex.permissions.defaults.get.response">>
    setDefaults(
      input: Payload<"harness.codex.permissions.defaults.set.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.codex.permissions.defaults.set.response">>
    setShowFullAccess(
      enabled: boolean,
      options?: RequestOptions
    ): Promise<Value<"harness.codex.permissions.show-full-access.set.response">>
  }
  readonly threads: {
    readonly backgroundTerminals: {
      clean(
        input: v2.ThreadBackgroundTerminalsCleanParams,
        options?: RequestOptions
      ): Promise<v2.ThreadBackgroundTerminalsCleanResponse>
      list(
        input: v2.ThreadBackgroundTerminalsListParams,
        options?: RequestOptions
      ): Promise<v2.ThreadBackgroundTerminalsListResponse>
      terminate(
        input: v2.ThreadBackgroundTerminalsTerminateParams,
        options?: RequestOptions
      ): Promise<v2.ThreadBackgroundTerminalsTerminateResponse>
    }
    compact(
      input: v2.ThreadCompactStartParams,
      options?: RequestOptions
    ): Promise<v2.ThreadCompactStartResponse>
    readonly goal: {
      clear(
        input: v2.ThreadGoalClearParams,
        options?: RequestOptions
      ): Promise<v2.ThreadGoalClearResponse>
      get(
        input: v2.ThreadGoalGetParams,
        options?: RequestOptions
      ): Promise<v2.ThreadGoalGetResponse>
      set(
        input: v2.ThreadGoalSetParams,
        options?: RequestOptions
      ): Promise<v2.ThreadGoalSetResponse>
    }
    readonly queue: {
      add(
        input: v2.ThreadQueueAddParams,
        options?: RequestOptions
      ): Promise<v2.ThreadQueueAddResponse>
      delete(
        input: v2.ThreadQueueDeleteParams,
        options?: RequestOptions
      ): Promise<v2.ThreadQueueDeleteResponse>
      list(
        input: v2.ThreadQueueListParams,
        options?: RequestOptions
      ): Promise<v2.ThreadQueueListResponse>
      reorder(
        input: v2.ThreadQueueReorderParams,
        options?: RequestOptions
      ): Promise<v2.ThreadQueueReorderResponse>
      start(
        input: v2.ThreadQueueStartParams,
        options?: RequestOptions
      ): Promise<v2.ThreadQueueStartResponse>
      update(
        input: v2.ThreadQueueUpdateParams,
        options?: RequestOptions
      ): Promise<v2.ThreadQueueUpdateResponse>
    }
    revert(input: v2.ThreadRevertParams, options?: RequestOptions): Promise<v2.ThreadRevertResponse>
    readonly review: {
      start(input: v2.ReviewStartParams, options?: RequestOptions): Promise<v2.ReviewStartResponse>
    }
    usage(threadId: string, options?: RequestOptions): Promise<v2.GetAccountTokenUsageResponse>
    subscribeUsage(
      threadId: string,
      handler: (update: v2.ThreadTokenUsageUpdatedNotification) => void
    ): () => void
  }
}

export const createCodexHarnessActions = (client: ServerClient): CodexHarnessActions => {
  const request = async <T>(
    type: CodexHarnessClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestCodexHarness(type, payload, options))
  return {
    guardian: {
      retry: async (input, options) => {
        await request("harness.codex.guardian.retry.request", input, options)
      },
    },
    account: {
      cancelLogin: async (loginId, options) =>
        (
          await request<Value<"harness.codex.account.login.cancel.response">>(
            "harness.codex.account.login.cancel.request",
            { loginId },
            options
          )
        ).cancelled,
      get: (refresh = false, options) =>
        request("harness.codex.account.get.request", { refresh }, options),
      login: (input, options) => request("harness.codex.account.login.request", input, options),
      logout: async (options) => {
        await request("harness.codex.account.logout.request", {}, options)
      },
      rateLimits: (input = {}, options) =>
        request("harness.codex.account.rate-limits.get.request", input, options),
      subscribeRateLimits: (handler) =>
        client.on("thread.event.notification", ({ payload }) => {
          if (
            payload.event.type === "harness" &&
            payload.event.agentId === "codex" &&
            payload.event.nativeType === "agent.codex.account.rate_limits.updated.notification"
          ) {
            handler(payload.event.payload as v2.AccountRateLimitsUpdatedNotification)
          }
        }),
    },
    models: {
      list: async (includeHidden = false, options) =>
        (
          await request<Value<"harness.codex.model.list.response">>(
            "harness.codex.model.list.request",
            { includeHidden },
            options
          )
        ).models,
      settings: (options) => request("harness.codex.model-settings.get.request", {}, options),
      setSettings: (input, options) =>
        request("harness.codex.model-settings.set.request", input, options),
    },
    permissions: {
      catalog: (cwd, options) =>
        request(
          "harness.codex.permissions.catalog.get.request",
          { ...(cwd ? { cwd } : {}) },
          options
        ),
      defaults: (options) => request("harness.codex.permissions.defaults.get.request", {}, options),
      setDefaults: (input, options) =>
        request("harness.codex.permissions.defaults.set.request", input, options),
      setShowFullAccess: (enabled, options) =>
        request("harness.codex.permissions.show-full-access.set.request", { enabled }, options),
    },
    threads: {
      backgroundTerminals: {
        clean: (input, options) =>
          request("harness.codex.thread.background-terminals.clean.request", input, options),
        list: (input, options) =>
          request("harness.codex.thread.background-terminals.list.request", input, options),
        terminate: (input, options) =>
          request("harness.codex.thread.background-terminals.terminate.request", input, options),
      },
      compact: (input, options) => request("harness.codex.thread.compact.request", input, options),
      goal: {
        clear: (input, options) =>
          request("harness.codex.thread.goal.clear.request", input, options),
        get: (input, options) => request("harness.codex.thread.goal.get.request", input, options),
        set: (input, options) => request("harness.codex.thread.goal.set.request", input, options),
      },
      queue: {
        add: (input, options) => request("harness.codex.thread.queue.add.request", input, options),
        delete: (input, options) =>
          request("harness.codex.thread.queue.delete.request", input, options),
        list: (input, options) =>
          request("harness.codex.thread.queue.list.request", input, options),
        reorder: (input, options) =>
          request("harness.codex.thread.queue.reorder.request", input, options),
        start: (input, options) =>
          request("harness.codex.thread.queue.start.request", input, options),
        update: (input, options) =>
          request("harness.codex.thread.queue.update.request", input, options),
      },
      revert: (input, options) => request("harness.codex.thread.revert.request", input, options),
      review: {
        start: (input, options) =>
          request("harness.codex.thread.review.start.request", input, options),
      },
      usage: (threadId, options) =>
        request("harness.codex.thread.usage.get.request", { threadId }, options),
      subscribeUsage: (threadId, handler) =>
        client.on("thread.event.notification", ({ payload }) => {
          if (
            payload.threadId === threadId &&
            payload.event.type === "harness" &&
            payload.event.agentId === "codex" &&
            payload.event.nativeType === "agent.codex.thread.token_usage.updated.notification"
          ) {
            handler(payload.event.payload as v2.ThreadTokenUsageUpdatedNotification)
          }
        }),
    },
  }
}
