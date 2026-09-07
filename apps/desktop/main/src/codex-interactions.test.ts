import type {
  CodexAppServerBridge,
  CodexJsonValue,
  CodexServerRequestByMethod,
  ServerRequest,
} from "@cypheria/codex-bridge"
import { describe, expect, it } from "vitest"

import type { CodexInteractionEvent } from "../../ipc/src/index.js"
import { createCodexInteractionBroker } from "./codex-interactions.js"

class FakeInteractionBridge {
  readonly handlers = new Map<
    ServerRequest["method"],
    (request: ServerRequest) => CodexJsonValue | Promise<CodexJsonValue>
  >()

  onServerRequest<M extends ServerRequest["method"]>(
    method: M,
    handler: (request: CodexServerRequestByMethod<M>) => CodexJsonValue | Promise<CodexJsonValue>
  ): () => void {
    this.handlers.set(method, handler as (request: ServerRequest) => CodexJsonValue)
    return () => this.handlers.delete(method)
  }

  dispatch(request: ServerRequest): Promise<CodexJsonValue> {
    const handler = this.handlers.get(request.method)
    if (!handler) throw new Error(`No handler for ${request.method}`)
    return Promise.resolve(handler(request))
  }
}

const createHarness = () => {
  const bridge = new FakeInteractionBridge()
  const events: CodexInteractionEvent[] = []
  const broker = createCodexInteractionBroker({
    bridge: bridge as unknown as CodexAppServerBridge,
    emit: (event) => events.push(event),
  })
  return { bridge, broker, events }
}

describe("Codex interaction broker", () => {
  it("resolves command approvals through a typed desktop decision", async () => {
    const { bridge, broker, events } = createHarness()
    const resultPromise = bridge.dispatch({
      id: "server-1",
      method: "item/commandExecution/requestApproval",
      params: {
        approvalId: null,
        command: "pnpm test",
        commandActions: [],
        cwd: "/tmp/project",
        environmentId: null,
        itemId: "item-1",
        kind: "command",
        networkApprovalContext: null,
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: null,
        reason: "Run tests",
        startedAtMs: 1,
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })

    expect(events[0]).toMatchObject({
      kind: "approval",
      method: "item/commandExecution/requestApproval",
      threadId: "thread-1",
      title: "Approve command execution",
    })
    await broker.respond({
      action: "accept-for-session",
      interactionId: events[0]!.interactionId,
    })
    await expect(resultPromise).resolves.toEqual({ decision: "acceptForSession" })
  })

  it("returns structured request-user-input answers", async () => {
    const { bridge, broker, events } = createHarness()
    const resultPromise = bridge.dispatch({
      id: "server-2",
      method: "item/tool/requestUserInput",
      params: {
        autoResolutionMs: null,
        isBlocking: true,
        itemId: "item-2",
        questions: [
          {
            header: "Network",
            id: "network",
            isOther: false,
            isSecret: false,
            options: [{ description: "Ethereum mainnet", label: "Mainnet" }],
            question: "Choose a network",
          },
        ],
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })

    await broker.respond({
      action: "accept",
      answers: { network: ["Mainnet"] },
      interactionId: events[0]!.interactionId,
    })
    await expect(resultPromise).resolves.toEqual({
      answers: { network: { answers: ["Mainnet"] } },
    })
  })

  it("fails closed by canceling pending interactions when closed", async () => {
    const { bridge, broker } = createHarness()
    const resultPromise = bridge.dispatch({
      id: "server-3",
      method: "item/fileChange/requestApproval",
      params: {
        grantRoot: null,
        itemId: "item-3",
        reason: null,
        startedAtMs: 1,
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })

    broker.close()
    await expect(resultPromise).resolves.toEqual({ decision: "cancel" })
  })
})
