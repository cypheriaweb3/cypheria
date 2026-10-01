import type { MagpieClientMessage, MagpieServerMessage, ServerMessage } from "@cypheria/protocol"
import type { Logger } from "pino"

import type { MagpieManager } from "./magpie-manager.js"

export type MagpieServiceOptions = {
  readonly logger: Logger
  readonly manager: MagpieManager
  readonly publish: (message: ServerMessage) => void
}

/** The `magpie.*` requests: the gateway's lifecycle and magpie's own data. */
export class MagpieService {
  readonly #logger: Logger
  readonly #manager: MagpieManager
  readonly #publish: (message: ServerMessage) => void

  constructor(options: MagpieServiceOptions) {
    this.#logger = options.logger.child({ module: "magpie-service" })
    this.#manager = options.manager
    this.#publish = options.publish
  }

  async handle(
    message: MagpieClientMessage,
    send: (message: MagpieServerMessage) => void
  ): Promise<boolean> {
    const type = message.type.replace(/\.request$/, ".response")
    try {
      let value: unknown
      switch (message.type) {
        case "magpie.status.get.request":
          value = this.#manager.view()
          break
        case "magpie.install.request":
          value = await this.#manager.install()
          break
        case "magpie.config.set.request":
          value =
            message.payload.patch.enabled === undefined
              ? this.#manager.view()
              : await this.#manager.setEnabled(message.payload.patch.enabled)
          break
        case "magpie.restart.request":
          value = await this.#manager.restart()
          break
        case "magpie.agents.list.request":
          value = { agents: await this.#manager.listAgents() }
          break
        case "magpie.agent.set.request":
          value = {
            agents: await this.#manager.setAgentField(
              message.payload.agentId,
              message.payload.field,
              message.payload.value
            ),
          }
          break
        case "magpie.agent.reapply.request":
          value = { agents: await this.#manager.reapplyAgent(message.payload.agentId) }
          break
        case "magpie.providers.list.request":
          value = { providers: await this.#manager.listProviders() }
          break
        case "magpie.groups.list.request":
          value = { groups: await this.#manager.listGroups() }
          break
        case "magpie.usage.get.request":
          value = await this.#manager.usage(message.payload.period)
          break
      }
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type,
      } as MagpieServerMessage)
    } catch (error) {
      const code = error instanceof Error && error.name !== "Error" ? error.name : "MAGPIE_FAILED"
      const text = error instanceof Error ? error.message : String(error)
      this.#logger.warn({ code, error: text, type: message.type }, "magpie request failed")
      send({
        payload: { error: { code, message: text || code }, ok: false },
        requestId: message.requestId,
        type,
      } as MagpieServerMessage)
    }
    return true
  }

  broadcastStatus(): void {
    this.#publish({
      payload: this.#manager.view(),
      type: "magpie.status.changed.notification",
    })
  }
}
