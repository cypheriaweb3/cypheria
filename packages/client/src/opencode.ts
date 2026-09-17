import {
  createOpencodeClient as createSdkOpenCodeClient,
  type OpencodeClient,
  type OpencodeClientConfig,
} from "@opencode-ai/sdk/client"
import type { CypheriaApi } from "./index.js"
import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type OpenCodeStream = "event" | "global.event"

export interface OpenCodeEndpoint {
  call(request: Request, options?: RequestOptions): Promise<Response>
  events(stream: OpenCodeStream, signal?: AbortSignal): AsyncGenerator<unknown>
}

type QueueWaiter = { reject(error: Error): void; resolve(value: IteratorResult<unknown>): void }

export const createOpenCodeEndpoint = (client: ServerClient): OpenCodeEndpoint => ({
  call: async (request, options) => {
    const url = new URL(request.url)
    const bodyText =
      request.method === "GET" || request.method === "HEAD" ? "" : await request.text()
    let body: unknown
    if (bodyText) {
      try {
        body = JSON.parse(bodyText)
      } catch {
        body = bodyText
      }
    }
    const query: Record<string, string | string[]> = {}
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key)
      query[key] = values.length === 1 ? (values[0] ?? "") : values
    }
    const headers = Object.fromEntries(request.headers.entries())
    const response = await client.requestOpenCodeCall(
      {
        ...(body === undefined ? {} : { body: body as never }),
        headers,
        operation: `${request.method} ${url.pathname}`,
        ...(Object.keys(query).length === 0 ? {} : { query }),
      },
      { ...options, signal: options?.signal ?? request.signal }
    )
    const payload = response.payload
    return new Response(JSON.stringify(payload.ok ? payload.data : payload.error), {
      headers: { "content-type": "application/json", ...payload.headers },
      status: payload.status,
    })
  },
  events: async function* (stream, signal) {
    const subscriptionId = `ocs_${crypto.randomUUID()}`
    const queue: unknown[] = []
    const waiters: QueueWaiter[] = []
    let complete = false
    let failure: Error | undefined
    const settle = (): void => {
      while (waiters.length > 0) {
        const waiter = waiters.shift()
        if (!waiter) continue
        if (failure) waiter.reject(failure)
        else if (queue.length > 0) waiter.resolve({ done: false, value: queue.shift() })
        else if (complete) waiter.resolve({ done: true, value: undefined })
        else {
          waiters.unshift(waiter)
          break
        }
      }
    }
    const unsubscribe = client.subscribe((message) => {
      if (
        !("payload" in message) ||
        !("subscriptionId" in message.payload) ||
        message.payload.subscriptionId !== subscriptionId
      )
        return
      if (message.type === "agent.opencode.event.notification") queue.push(message.payload.event)
      else if (message.type === "agent.opencode.event.error.notification")
        failure = new Error(message.payload.message)
      else if (message.type === "agent.opencode.event.complete.notification") complete = true
      settle()
    })
    const abort = (): void => {
      complete = true
      settle()
    }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      await client.subscribeOpenCodeEvents({ stream, subscriptionId }, { signal })
      while (!complete) {
        if (queue.length > 0) {
          yield queue.shift()
          continue
        }
        const item = await new Promise<IteratorResult<unknown>>((resolve, reject) =>
          waiters.push({ reject, resolve })
        )
        if (item.done) break
        yield item.value
      }
      if (failure) throw failure
    } finally {
      signal?.removeEventListener("abort", abort)
      unsubscribe()
      await client.cancelOpenCodeEvents(subscriptionId).catch(() => undefined)
    }
  },
})

export type CypheriaOpenCodeClientConfig = Omit<OpencodeClientConfig, "baseUrl" | "fetch">

/** Creates the stable @opencode-ai/sdk client over the Cypheria protocol. */
export const createOpencodeClient = (
  cypheria: CypheriaApi,
  config: CypheriaOpenCodeClientConfig = {}
): OpencodeClient => {
  const endpoint = cypheria.agent.opencode
  const client = createSdkOpenCodeClient({
    ...config,
    baseUrl: "http://cypheria.invalid",
    fetch: (request) => endpoint.call(request),
  })
  const event = client.event as unknown as {
    subscribe(options?: { signal?: AbortSignal }): { stream: AsyncGenerator<unknown> }
  }
  event.subscribe = (options) => ({ stream: endpoint.events("event", options?.signal) })
  const global = client.global as unknown as {
    event(options?: { signal?: AbortSignal }): { stream: AsyncGenerator<unknown> }
  }
  global.event = (options) => ({ stream: endpoint.events("global.event", options?.signal) })
  return client
}
