import type { CodexClientResponseMap, CodexServerRequestResponseMap } from "@cypheria/protocol"
import {
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_RPC,
  type AgentCodexClientNotificationMessage,
  type AgentCodexClientRequestMessage,
  type RequestId,
} from "@cypheria/protocol"

export type CodexClientMethod = keyof typeof AGENT_CODEX_CLIENT_RPC
export type CodexServerMethod = keyof typeof AGENT_CODEX_SERVER_RPC
export type CodexClientNotificationMethod = keyof typeof AGENT_CODEX_CLIENT_NOTIFICATIONS

export type CodexRequestParams<M extends CodexClientMethod> = Omit<
  Extract<AgentCodexClientRequestMessage, { type: (typeof AGENT_CODEX_CLIENT_RPC)[M]["request"] }>,
  "requestId" | "type"
>

export type CodexClientNotificationParams<M extends CodexClientNotificationMethod> = Omit<
  Extract<
    AgentCodexClientNotificationMessage,
    { type: (typeof AGENT_CODEX_CLIENT_NOTIFICATIONS)[M]["notification"] }
  >,
  "type"
>

export type CodexRequestAction<M extends CodexClientMethod> = (
  ...args: keyof CodexRequestParams<M> extends never
    ? [params?: CodexRequestParams<M>]
    : [params: CodexRequestParams<M>]
) => Promise<CodexClientResponseMap[M]>

export type CodexClientNotificationAction<M extends CodexClientNotificationMethod> = (
  ...args: keyof CodexClientNotificationParams<M> extends never
    ? [params?: CodexClientNotificationParams<M>]
    : [params: CodexClientNotificationParams<M>]
) => Promise<void>

export type CodexServerResponseAction<M extends CodexServerMethod> = (
  requestId: RequestId,
  response: CodexServerRequestResponseMap[M]
) => Promise<void>

type PathAction<Path extends string, Action> = Path extends `${infer Head}/${infer Tail}`
  ? { readonly [Key in Head]: PathAction<Tail, Action> }
  : { readonly [Key in Path]: Action }

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection
) => void
  ? Intersection
  : never

export type CodexRequestActions = UnionToIntersection<
  {
    [Method in CodexClientMethod]: PathAction<Method, CodexRequestAction<Method>>
  }[CodexClientMethod]
>

export type CodexClientNotificationActions = UnionToIntersection<
  {
    [Method in CodexClientNotificationMethod]: PathAction<
      Method,
      CodexClientNotificationAction<Method>
    >
  }[CodexClientNotificationMethod]
>

export type CodexServerResponseActions = UnionToIntersection<
  {
    [Method in CodexServerMethod]: PathAction<Method, CodexServerResponseAction<Method>>
  }[CodexServerMethod]
>

export type CodexActions = CodexRequestActions & {
  readonly notify: CodexClientNotificationActions
  readonly respond: CodexServerResponseActions
}

type ActionTree = Record<string, unknown>

const createActionTree = <Method extends string, Action extends (...args: never[]) => unknown>(
  methods: readonly Method[],
  createAction: (method: Method) => Action
): ActionTree => {
  const root: ActionTree = {}
  for (const method of methods) {
    const segments = method.split("/")
    let node = root
    for (const [index, segment] of segments.entries()) {
      const isLeaf = index === segments.length - 1
      if (isLeaf) {
        const action = createAction(method)
        const current = node[segment]
        if (typeof current === "object" && current !== null) {
          Object.assign(action, current)
        } else if (current !== undefined) {
          throw new Error(`Duplicate Codex client action path: ${method}`)
        }
        node[segment] = action
        continue
      }
      const current = node[segment]
      if (current === undefined) {
        const child: ActionTree = {}
        node[segment] = child
        node = child
      } else if (
        (typeof current === "object" && current !== null) ||
        typeof current === "function"
      ) {
        node = current as ActionTree
      } else {
        throw new Error(`Conflicting Codex client action path: ${method}`)
      }
    }
  }
  return root
}

export type CodexActionInvokers = {
  readonly notify: (method: CodexClientNotificationMethod, params?: unknown) => Promise<void>
  readonly request: (method: CodexClientMethod, params?: unknown) => Promise<unknown>
  readonly respond: (
    method: CodexServerMethod,
    requestId: RequestId,
    response: unknown
  ) => Promise<void>
}

/** Mechanically turns the protocol registries into one async method per message pair. */
export const createCodexActions = (invokers: CodexActionInvokers): CodexActions => {
  const requests = createActionTree(
    Object.keys(AGENT_CODEX_CLIENT_RPC) as CodexClientMethod[],
    (method) => async (params?: unknown) => invokers.request(method, params)
  )
  if (Object.hasOwn(requests, "notify") || Object.hasOwn(requests, "respond")) {
    throw new Error("Codex request methods conflict with reserved notify/respond action groups")
  }
  requests.notify = createActionTree(
    Object.keys(AGENT_CODEX_CLIENT_NOTIFICATIONS) as CodexClientNotificationMethod[],
    (method) => async (params?: unknown) => invokers.notify(method, params)
  )
  requests.respond = createActionTree(
    Object.keys(AGENT_CODEX_SERVER_RPC) as CodexServerMethod[],
    (method) => async (requestId: RequestId, response: unknown) =>
      invokers.respond(method, requestId, response)
  )
  return requests as CodexActions
}
