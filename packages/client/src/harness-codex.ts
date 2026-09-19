import type { CodexHarnessClientMessage, CodexHarnessServerMessage } from "@cypheria/protocol"

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
  }
}
