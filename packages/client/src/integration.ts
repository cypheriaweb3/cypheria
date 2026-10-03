import type { IntegrationClientMessage, IntegrationServerMessage } from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends IntegrationClientMessage["type"]> = Extract<
  IntegrationClientMessage,
  { type: T }
>["payload"]
type Value<T extends IntegrationServerMessage["type"]> = Extract<
  Extract<IntegrationServerMessage, { type: T }>["payload"],
  { ok: true }
>["value"]

const unwrap = <T>(message: IntegrationServerMessage): T => {
  const payload = message.payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface SkillActions {
  list(
    input: Payload<"integration.skill.list.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.skill.list.response">>
  setEnabled(
    input: Payload<"integration.skill.set-enabled.request">,
    options?: RequestOptions
  ): Promise<void>
}
export interface HookActions {
  list(
    input: Payload<"integration.hook.list.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.hook.list.response">>
  setEnabled(
    input: Payload<"integration.hook.set-enabled.request">,
    options?: RequestOptions
  ): Promise<void>
  trust(input: Payload<"integration.hook.trust.request">, options?: RequestOptions): Promise<void>
}
export interface McpActions {
  add(input: Payload<"integration.mcp.add.request">, options?: RequestOptions): Promise<void>
  list(
    input: Payload<"integration.mcp.list.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.mcp.list.response">>
  login(
    input: Payload<"integration.mcp.login.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.mcp.login.response">>
  setEnabled(
    input: Payload<"integration.mcp.set-enabled.request">,
    options?: RequestOptions
  ): Promise<void>
}
export interface PluginActions {
  agents(
    input: Payload<"integration.plugin.agents.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.agents.response">>
  readConfig(
    input: Payload<"integration.plugin.config.read.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.config.read.response">>
  writeConfig(
    input: Payload<"integration.plugin.config.write.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.config.write.response">>
  setGlobalEnabled(
    input: Payload<"integration.plugin.set-global-enabled.request">,
    options?: RequestOptions
  ): Promise<void>
  install(
    input: Payload<"integration.plugin.install.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.install.response">>
  list(
    input: Payload<"integration.plugin.list.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.list.response">>
  read(
    input: Payload<"integration.plugin.read.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.read.response">>
  setEnabled(
    input: Payload<"integration.plugin.set-enabled.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.set-enabled.response">>
  uninstall(
    input: Payload<"integration.plugin.uninstall.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.plugin.uninstall.response">>
}
export interface MarketplaceActions {
  add(
    input: Payload<"integration.marketplace.add.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.marketplace.add.response">>
  remove(
    input: Payload<"integration.marketplace.remove.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.marketplace.remove.response">>
  upgrade(
    input: Payload<"integration.marketplace.upgrade.request">,
    options?: RequestOptions
  ): Promise<Value<"integration.marketplace.upgrade.response">>
}
export interface CodexAppActions {
  connect(
    appId: string,
    options?: RequestOptions
  ): Promise<Value<"integration.codex.app.connect.response">>
  list(
    forceRefresh?: boolean,
    options?: RequestOptions
  ): Promise<Value<"integration.codex.app.list.response">>
  setEnabled(appId: string, enabled: boolean, options?: RequestOptions): Promise<void>
}
export interface IntegrationActions {
  readonly apps: CodexAppActions
  readonly hooks: HookActions
  readonly marketplaces: MarketplaceActions
  readonly mcp: McpActions
  readonly plugins: PluginActions
  readonly skills: SkillActions
}

export const createIntegrationActions = (client: ServerClient): IntegrationActions => {
  const request = async <T>(
    type: IntegrationClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestIntegration(type, payload, options))
  const mutation = async (
    type: IntegrationClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<void> => {
    await request(type, payload, options)
  }
  return {
    apps: {
      connect: (appId, options) =>
        request("integration.codex.app.connect.request", { appId }, options),
      list: (forceRefresh, options) =>
        request("integration.codex.app.list.request", { forceRefresh }, options),
      setEnabled: (appId, enabled, options) =>
        mutation("integration.codex.app.set-enabled.request", { appId, enabled }, options),
    },
    hooks: {
      list: (input, options) => request("integration.hook.list.request", input, options),
      setEnabled: (input, options) =>
        mutation("integration.hook.set-enabled.request", input, options),
      trust: (input, options) => mutation("integration.hook.trust.request", input, options),
    },
    marketplaces: {
      add: (input, options) => request("integration.marketplace.add.request", input, options),
      remove: (input, options) => request("integration.marketplace.remove.request", input, options),
      upgrade: (input, options) =>
        request("integration.marketplace.upgrade.request", input, options),
    },
    mcp: {
      add: (input, options) => mutation("integration.mcp.add.request", input, options),
      list: (input, options) => request("integration.mcp.list.request", input, options),
      login: (input, options) => request("integration.mcp.login.request", input, options),
      setEnabled: (input, options) =>
        mutation("integration.mcp.set-enabled.request", input, options),
    },
    plugins: {
      agents: (input, options) => request("integration.plugin.agents.request", input, options),
      setGlobalEnabled: (input, options) =>
        mutation("integration.plugin.set-global-enabled.request", input, options),
      install: (input, options) => request("integration.plugin.install.request", input, options),
      list: (input, options) => request("integration.plugin.list.request", input, options),
      read: (input, options) => request("integration.plugin.read.request", input, options),
      readConfig: (input, options) =>
        request("integration.plugin.config.read.request", input, options),
      writeConfig: (input, options) =>
        request("integration.plugin.config.write.request", input, options),
      setEnabled: (input, options) =>
        request("integration.plugin.set-enabled.request", input, options),
      uninstall: (input, options) =>
        request("integration.plugin.uninstall.request", input, options),
    },
    skills: {
      list: (input, options) => request("integration.skill.list.request", input, options),
      setEnabled: (input, options) =>
        mutation("integration.skill.set-enabled.request", input, options),
    },
  }
}
