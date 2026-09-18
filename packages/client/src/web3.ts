import type { Web3ClientMessage, Web3ServerMessage } from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends Web3ClientMessage["type"]> = Extract<
  Web3ClientMessage,
  { type: T }
>["payload"]
type Value<T extends Web3ServerMessage["type"]> = Extract<
  Extract<Web3ServerMessage, { type: T }>["payload"],
  { ok: true }
>["value"]

const unwrap = <T>(message: Web3ServerMessage): T => {
  const payload = message.payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface Web3NetworkActions {
  list(options?: RequestOptions): Promise<Value<"web3.network.list.response">>
  create(
    input: Payload<"web3.network.create.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.network.create.response">>
  setEnabled(
    input: Payload<"web3.network.set-enabled.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.network.set-enabled.response">>
  remove(input: Payload<"web3.network.remove.request">, options?: RequestOptions): Promise<void>
  reorder(
    networkIds: Payload<"web3.network.reorder.request">["networkIds"],
    options?: RequestOptions
  ): Promise<void>
  addEndpoint(
    input: Payload<"web3.endpoint.add.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.endpoint.add.response">>
  probeEndpoint(
    endpointId: Payload<"web3.endpoint.probe.request">["endpointId"],
    options?: RequestOptions
  ): Promise<Value<"web3.endpoint.probe.response">>
  setEndpointEnabled(
    input: Payload<"web3.endpoint.set-enabled.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.endpoint.set-enabled.response">>
  removeEndpoint(
    endpointId: Payload<"web3.endpoint.remove.request">["endpointId"],
    options?: RequestOptions
  ): Promise<void>
  reorderEndpoints(
    input: Payload<"web3.endpoint.reorder.request">,
    options?: RequestOptions
  ): Promise<void>
}

export interface Web3WalletActions {
  list(options?: RequestOptions): Promise<Value<"web3.wallet.list.response">>
  generate(
    input: Payload<"web3.wallet.generate.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.generate.response">>
  derive(
    input: Payload<"web3.wallet.derive.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.derive.response">>
  importHd(
    input: Payload<"web3.wallet.import-hd.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.import-hd.response">>
  importPrivateKey(
    input: Payload<"web3.wallet.import-private-key.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.import-private-key.response">>
  addWatch(
    input: Payload<"web3.wallet.add-watch.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.add-watch.response">>
  rename(
    input: Payload<"web3.wallet.rename.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.rename.response">>
  reorder(
    walletIds: Payload<"web3.wallet.reorder.request">["walletIds"],
    options?: RequestOptions
  ): Promise<void>
  reorderAccounts(
    input: Payload<"web3.wallet.reorder-accounts.request">,
    options?: RequestOptions
  ): Promise<void>
  delete(
    walletId: Payload<"web3.wallet.delete.request">["walletId"],
    options?: RequestOptions
  ): Promise<void>
  getActive(options?: RequestOptions): Promise<Value<"web3.wallet.active.get.response">>
  setActive(
    input: Payload<"web3.wallet.active.set.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.active.set.response">>
  clearActive(options?: RequestOptions): Promise<void>
  lock(
    walletId: Payload<"web3.wallet.lock.request">["walletId"],
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.lock.response">>
  unlock(
    walletId: Payload<"web3.wallet.unlock.request">["walletId"],
    options?: RequestOptions
  ): Promise<Value<"web3.wallet.unlock.response">>
}

export interface Web3PolicyActions {
  list(
    input?: Payload<"web3.policy.list.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.policy.list.response">>
  create(
    input: Payload<"web3.policy.create.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.policy.create.response">>
  update(
    input: Payload<"web3.policy.update.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.policy.update.response">>
  disable(
    input: Payload<"web3.policy.disable.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.policy.disable.response">>
}

export interface Web3ApprovalActions {
  list(
    input?: Payload<"web3.approval.list.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.approval.list.response">>
  decide(
    input: Payload<"web3.approval.decide.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.approval.decide.response">>
}

export interface Web3AuditActions {
  list(
    input?: Payload<"web3.audit.list.request">,
    options?: RequestOptions
  ): Promise<Value<"web3.audit.list.response">>
}

export interface Web3Actions {
  readonly approvals: Web3ApprovalActions
  readonly audit: Web3AuditActions
  readonly networks: Web3NetworkActions
  readonly policies: Web3PolicyActions
  readonly wallets: Web3WalletActions
}

export const createWeb3Actions = (client: ServerClient): Web3Actions => {
  const request = async <T>(
    type: Web3ClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestWeb3(type, payload, options))
  return {
    approvals: {
      decide: (input, options) => request("web3.approval.decide.request", input, options),
      list: (input = {}, options) => request("web3.approval.list.request", input, options),
    },
    audit: { list: (input = {}, options) => request("web3.audit.list.request", input, options) },
    networks: {
      addEndpoint: (input, options) => request("web3.endpoint.add.request", input, options),
      create: (input, options) => request("web3.network.create.request", input, options),
      list: (options) => request("web3.network.list.request", {}, options),
      probeEndpoint: (endpointId, options) =>
        request("web3.endpoint.probe.request", { endpointId }, options),
      remove: async (input, options) => {
        await request("web3.network.remove.request", input, options)
      },
      removeEndpoint: async (endpointId, options) => {
        await request("web3.endpoint.remove.request", { endpointId }, options)
      },
      reorder: async (networkIds, options) => {
        await request("web3.network.reorder.request", { networkIds }, options)
      },
      reorderEndpoints: async (input, options) => {
        await request("web3.endpoint.reorder.request", input, options)
      },
      setEnabled: (input, options) => request("web3.network.set-enabled.request", input, options),
      setEndpointEnabled: (input, options) =>
        request("web3.endpoint.set-enabled.request", input, options),
    },
    policies: {
      create: (input, options) => request("web3.policy.create.request", input, options),
      disable: (input, options) => request("web3.policy.disable.request", input, options),
      list: (input = {}, options) => request("web3.policy.list.request", input, options),
      update: (input, options) => request("web3.policy.update.request", input, options),
    },
    wallets: {
      addWatch: (input, options) => request("web3.wallet.add-watch.request", input, options),
      clearActive: async (options) => {
        await request("web3.wallet.active.clear.request", {}, options)
      },
      delete: async (walletId, options) => {
        await request("web3.wallet.delete.request", { walletId }, options)
      },
      derive: (input, options) => request("web3.wallet.derive.request", input, options),
      generate: (input, options) => request("web3.wallet.generate.request", input, options),
      getActive: (options) => request("web3.wallet.active.get.request", {}, options),
      importHd: (input, options) => request("web3.wallet.import-hd.request", input, options),
      importPrivateKey: (input, options) =>
        request("web3.wallet.import-private-key.request", input, options),
      list: (options) => request("web3.wallet.list.request", {}, options),
      lock: (walletId, options) => request("web3.wallet.lock.request", { walletId }, options),
      rename: (input, options) => request("web3.wallet.rename.request", input, options),
      reorder: async (walletIds, options) => {
        await request("web3.wallet.reorder.request", { walletIds }, options)
      },
      reorderAccounts: async (input, options) => {
        await request("web3.wallet.reorder-accounts.request", input, options)
      },
      setActive: (input, options) => request("web3.wallet.active.set.request", input, options),
      unlock: (walletId, options) => request("web3.wallet.unlock.request", { walletId }, options),
    },
  }
}
