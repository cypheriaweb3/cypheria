import type { CodexProviderClientMessage, CodexProviderServerMessage } from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends CodexProviderClientMessage["type"]> = Extract<
  CodexProviderClientMessage,
  { type: T }
>["payload"]
type Value<T extends CodexProviderServerMessage["type"]> = Extract<
  Extract<CodexProviderServerMessage, { type: T }>["payload"],
  { ok: true }
>["value"]

const unwrap = <T>(message: CodexProviderServerMessage): T => {
  const payload = message.payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface CodexProviderActions {
  readonly account: {
    cancelLogin(loginId: string, options?: RequestOptions): Promise<boolean>
    get(
      refresh?: boolean,
      options?: RequestOptions
    ): Promise<Value<"provider.codex.account.get.response">>
    login(
      input: Payload<"provider.codex.account.login.request">,
      options?: RequestOptions
    ): Promise<Value<"provider.codex.account.login.response">>
    logout(options?: RequestOptions): Promise<void>
  }
  readonly models: {
    list(
      includeHidden?: boolean,
      options?: RequestOptions
    ): Promise<Value<"provider.codex.model.list.response">["models"]>
    settings(options?: RequestOptions): Promise<Value<"provider.codex.model-settings.get.response">>
    setSettings(
      input: Payload<"provider.codex.model-settings.set.request">,
      options?: RequestOptions
    ): Promise<Value<"provider.codex.model-settings.set.response">>
  }
}

export const createCodexProviderActions = (client: ServerClient): CodexProviderActions => {
  const request = async <T>(
    type: CodexProviderClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestCodexProvider(type, payload, options))
  return {
    account: {
      cancelLogin: async (loginId, options) =>
        (
          await request<Value<"provider.codex.account.login.cancel.response">>(
            "provider.codex.account.login.cancel.request",
            { loginId },
            options
          )
        ).cancelled,
      get: (refresh = false, options) =>
        request("provider.codex.account.get.request", { refresh }, options),
      login: (input, options) => request("provider.codex.account.login.request", input, options),
      logout: async (options) => {
        await request("provider.codex.account.logout.request", {}, options)
      },
    },
    models: {
      list: async (includeHidden = false, options) =>
        (
          await request<Value<"provider.codex.model.list.response">>(
            "provider.codex.model.list.request",
            { includeHidden },
            options
          )
        ).models,
      settings: (options) => request("provider.codex.model-settings.get.request", {}, options),
      setSettings: (input, options) =>
        request("provider.codex.model-settings.set.request", input, options),
    },
  }
}
