import type { HarnessClientMessage, HarnessServerMessage } from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends HarnessClientMessage["type"]> = Extract<
  HarnessClientMessage,
  { type: T }
>["payload"]
type Value<T extends HarnessServerMessage["type"]> = Extract<
  Extract<HarnessServerMessage, { type: T }>["payload"],
  { ok: true }
>["value"]

const unwrap = <T>(message: HarnessServerMessage): T => {
  const payload = message.payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface HarnessActions {
  get(
    agentId: Payload<"harness.get.request">["agentId"],
    options?: RequestOptions
  ): Promise<Value<"harness.get.response">>
  readonly auth: {
    cancel(
      input: Payload<"harness.auth.cancel.request">,
      options?: RequestOptions
    ): Promise<boolean>
    logout(input: Payload<"harness.auth.logout.request">, options?: RequestOptions): Promise<void>
    poll(
      input: Payload<"harness.auth.poll.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.auth.poll.response">>
    respond(
      input: Payload<"harness.auth.respond.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.auth.respond.response">>
    start(
      input: Payload<"harness.auth.start.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.auth.start.response">>
    test(
      input: Payload<"harness.auth.test.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.auth.test.response">>
  }
  readonly models: {
    list(
      input: Payload<"harness.models.list.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.models.list.response">>
  }
  readonly settings: {
    get(
      input: Payload<"harness.settings.get.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.settings.get.response">>
    update(
      input: Payload<"harness.settings.update.request">,
      options?: RequestOptions
    ): Promise<Value<"harness.settings.update.response">>
  }
}

export const createHarnessActions = (client: ServerClient): HarnessActions => {
  const request = async <T>(
    type: HarnessClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestHarness(type, payload, options))
  return {
    auth: {
      cancel: async (input, options) =>
        (
          await request<Value<"harness.auth.cancel.response">>(
            "harness.auth.cancel.request",
            input,
            options
          )
        ).cancelled,
      logout: async (input, options) => {
        await request("harness.auth.logout.request", input, options)
      },
      poll: (input, options) => request("harness.auth.poll.request", input, options),
      respond: (input, options) => request("harness.auth.respond.request", input, options),
      start: (input, options) => request("harness.auth.start.request", input, options),
      test: (input, options) => request("harness.auth.test.request", input, options),
    },
    get: (agentId, options) => request("harness.get.request", { agentId }, options),
    models: {
      list: (input, options) => request("harness.models.list.request", input, options),
    },
    settings: {
      get: (input, options) => request("harness.settings.get.request", input, options),
      update: (input, options) => request("harness.settings.update.request", input, options),
    },
  }
}
