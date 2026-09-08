import { describe, expect, it } from "vitest"

import {
  ApprovalRequestViewSchema,
  approvalRequestDecideContract,
  approvalRequestsListContract,
  automationRunStartContract,
  automationTaskCreateContract,
  automationTaskPauseContract,
  browserSessionOpenContract,
  CodexLoginRequestSchema,
  ConnectionProxySettingsSchema,
  codexChatSteerContract,
  codexMarketplaceAddContract,
  codexMarketplaceRemoveContract,
  codexPluginEnabledWriteContract,
  codexPluginInstallContract,
  codexSkillEnabledWriteContract,
  codexThreadForkContract,
  codexThreadQueueAddContract,
  dappProviderRequestContract,
  networkCreateContract,
  networkEndpointSetEnabledContract,
  workspaceTerminalOpenContract,
  workspaceTerminalResizeContract,
  workspaceTerminalWriteContract,
} from "./index.js"

const view = {
  approval: {
    expiresAt: "2026-09-01T07:05:00.000Z",
    id: "approval_one",
    intentId: "signing_intent_one",
    requestedAt: "2026-09-01T07:00:00.000Z",
    revision: 1,
    status: "pending" as const,
  },
  intent: {
    approvalId: "approval_one",
    decision: "require-human-approval" as const,
    decisionId: "policy_decision_one",
    expiresAt: "2026-09-01T07:05:00.000Z",
    intent: {
      account: {
        address: "0x0000000000000000000000000000000000000001",
        chainAccountId: "chain_account_one",
        chainKey: "eip155:1",
        walletAccountId: "account_one",
        walletId: "wallet_one",
      },
      correlationId: "request_one",
      createdAt: "2026-09-01T07:00:00.000Z",
      id: "signing_intent_one",
      kind: "sign-transaction" as const,
      transaction: { chainId: 1, value: 1n },
    },
    mode: "human-approval" as const,
    payloadHash: `sha256:${"1".repeat(64)}`,
    revision: 1,
    source: "dapp" as const,
    status: "pending-approval" as const,
    updatedAt: "2026-09-01T07:00:00.000Z",
  },
}

describe("approval IPC contracts", () => {
  it("validates exact approval payloads including transaction bigint values", () => {
    expect(approvalRequestsListContract.request.parse({ status: "pending" })).toEqual({
      status: "pending",
    })
    expect(ApprovalRequestViewSchema.parse(view)).toEqual(view)
    expect(() => ApprovalRequestViewSchema.parse({ ...view, privateKey: "secret" })).toThrow()
  })

  it("requires an optimistic revision for approval decisions", () => {
    expect(
      approvalRequestDecideContract.request.parse({
        approvalId: "approval_one",
        decision: "approved",
        expectedRevision: 1,
        reviewer: "user",
      })
    ).toMatchObject({ decision: "approved", expectedRevision: 1 })
    expect(() =>
      approvalRequestDecideContract.request.parse({
        approvalId: "approval_one",
        decision: "approved",
        expectedRevision: 0,
        reviewer: "user",
      })
    ).toThrow()
  })
})

describe("dApp browser IPC contracts", () => {
  it("accepts scoped provider requests and rejects non-JSON parameters", () => {
    expect(
      dappProviderRequestContract.request.parse({
        id: "provider_1",
        method: "personal_sign",
        origin: "https://app.example",
        params: ["hello", "0x0000000000000000000000000000000000000001"],
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toMatchObject({ method: "personal_sign", origin: "https://app.example" })
    expect(() =>
      dappProviderRequestContract.request.parse({
        id: "provider_2",
        method: "personal_sign",
        origin: "https://app.example",
        params: [1n],
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toThrow()
  })

  it("accepts scoped Solana Wallet Standard requests", () => {
    expect(
      dappProviderRequestContract.request.parse({
        id: "solana_provider_1",
        input: { silent: true },
        method: "standard:connect",
        origin: "https://app.example",
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toMatchObject({ method: "standard:connect", origin: "https://app.example" })
    expect(() =>
      dappProviderRequestContract.request.parse({
        id: "solana_provider_2",
        input: { silent: true },
        method: "standard:connect",
        origin: "https://app.example",
        sessionKey: "cypheria:dapp:https://evil.example",
      })
    ).toThrow()
  })

  it("restricts browser sessions to secure dApp URLs", () => {
    expect(browserSessionOpenContract.request.parse({ url: "https://app.example/path" })).toEqual({
      url: "https://app.example/path",
    })
  })
})

describe("Codex connection IPC contracts", () => {
  it("accepts only API key and ChatGPT managed login requests", () => {
    expect(CodexLoginRequestSchema.parse({ type: "chatgpt" })).toEqual({ type: "chatgpt" })
    expect(CodexLoginRequestSchema.parse({ apiKey: "sk-test", type: "apiKey" })).toEqual({
      apiKey: "sk-test",
      type: "apiKey",
    })
    expect(CodexLoginRequestSchema.safeParse({ type: "chatgptDeviceCode" }).success).toBe(false)
    expect(
      CodexLoginRequestSchema.safeParse({
        apiKey: "key",
        region: "us-east-1",
        type: "amazonBedrock",
      }).success
    ).toBe(false)
  })

  it("validates global manual proxy settings", () => {
    expect(
      ConnectionProxySettingsSchema.parse({
        bypass: "localhost, example.test",
        host: "127.0.0.1",
        mode: "manual",
        password: "secret",
        port: 7890,
        protocol: "socks5",
        username: "proxy-user",
      })
    ).toMatchObject({ mode: "manual", port: 7890, protocol: "socks5" })
    expect(
      ConnectionProxySettingsSchema.safeParse({
        bypass: "",
        host: "https://proxy.example",
        mode: "manual",
        password: "",
        port: 70_000,
        protocol: "http",
        username: "",
      }).success
    ).toBe(false)
  })
})

describe("workspace terminal IPC contracts", () => {
  it("keeps terminal working directories behind project identifiers", () => {
    expect(workspaceTerminalOpenContract.request.parse({ projectId: "project-1" })).toEqual({
      projectId: "project-1",
    })
    expect(workspaceTerminalOpenContract.request.safeParse({ cwd: "/private" }).success).toBe(false)
  })

  it("bounds terminal input and resize messages", () => {
    const terminalId = "de305d54-75b4-431b-adb2-eb6b9e546014"
    expect(workspaceTerminalWriteContract.request.parse({ data: "pwd\r", terminalId })).toEqual({
      data: "pwd\r",
      terminalId,
    })
    expect(
      workspaceTerminalResizeContract.request.parse({ cols: 120, rows: 32, terminalId })
    ).toEqual({ cols: 120, rows: 32, terminalId })
    expect(
      workspaceTerminalResizeContract.request.safeParse({ cols: 1, rows: 32, terminalId }).success
    ).toBe(false)
  })
})

describe("network IPC contracts", () => {
  it("validates strict custom network inputs and optimistic endpoint mutations", () => {
    expect(
      networkCreateContract.request.parse({
        chain: { namespace: "eip155", reference: "137" },
        enabled: true,
        endpoints: [
          {
            enabled: true,
            label: "Primary",
            localDevelopment: false,
            transport: "http",
            url: "https://polygon.example/rpc",
          },
        ],
        explorers: [],
        name: "Polygon",
        nativeCurrency: { decimals: 18, name: "POL", symbol: "POL" },
        testnet: false,
        verification: { kind: "evm-chain-id" },
      })
    ).toMatchObject({ chain: { namespace: "eip155", reference: "137" } })
    expect(
      networkEndpointSetEnabledContract.request.parse({
        enabled: false,
        endpointId: "rpc_primary",
        expectedRevision: 2,
      })
    ).toEqual({ enabled: false, endpointId: "rpc_primary", expectedRevision: 2 })
    expect(() =>
      networkEndpointSetEnabledContract.request.parse({
        enabled: false,
        endpointId: "rpc_primary",
        expectedRevision: 0,
      })
    ).toThrow()
  })
})

describe("automation IPC contracts", () => {
  it("validates task creation and lifecycle inputs", () => {
    expect(
      automationTaskCreateContract.request.parse({
        definition: { handler: "noop" },
        title: "Inspect positions",
        trigger: { kind: "manual", requestedBy: "user" },
        walletPolicyScope: { accountIds: [], chainKeys: ["eip155:1"], mode: "read-only" },
        workspace: { id: "workspace_one", path: "/tmp/cypheria" },
      })
    ).toMatchObject({ definition: { handler: "noop" }, title: "Inspect positions" })
    expect(
      automationTaskPauseContract.request.parse({ expectedRevision: 1, taskId: "task_one" })
    ).toEqual({ expectedRevision: 1, taskId: "task_one" })
    expect(automationRunStartContract.request.parse({ taskId: "task_one" })).toEqual({
      taskId: "task_one",
    })
  })

  it("rejects secret or non-JSON task definition input", () => {
    expect(() =>
      automationTaskCreateContract.request.parse({
        definition: { handler: "noop", input: { amount: 1n, privateKey: "secret" } },
        title: "Invalid task",
        trigger: { kind: "manual", requestedBy: "user" },
        walletPolicyScope: { accountIds: [], chainKeys: ["eip155:1"], mode: "read-only" },
        workspace: { id: "workspace_one", path: "/tmp/cypheria" },
      })
    ).toThrow()
  })
})

describe("plugin and skill IPC contracts", () => {
  it("accepts only an exact marketplace name for removal, never renderer paths", () => {
    expect(codexMarketplaceRemoveContract.request.parse({ marketplaceName: "team" })).toEqual({
      marketplaceName: "team",
    })
    expect(codexMarketplaceRemoveContract.request.safeParse({ marketplaceName: "" }).success).toBe(
      false
    )
    expect(
      codexMarketplaceRemoveContract.request.safeParse({
        marketplaceName: "team",
        path: "/tmp/other",
      }).success
    ).toBe(false)
  })
  it("validates plugin locators, toggles, and marketplace sources", () => {
    expect(
      codexPluginInstallContract.request.parse({
        marketplaceName: "OpenAI",
        marketplacePath: null,
        pluginName: "github",
      })
    ).toMatchObject({ pluginName: "github" })
    expect(
      codexPluginEnabledWriteContract.request.parse({
        enabled: false,
        pluginId: "github@openai",
      })
    ).toEqual({ enabled: false, pluginId: "github@openai" })
    expect(
      codexSkillEnabledWriteContract.request.parse({
        enabled: true,
        path: "/skills/example/SKILL.md",
      })
    ).toMatchObject({ enabled: true })
    expect(codexMarketplaceAddContract.request.parse({ source: "org/plugins" })).toEqual({
      source: "org/plugins",
    })
  })
})

describe("chat follow-up IPC contracts", () => {
  it("accepts steer and queue input while rejecting empty follow-ups", () => {
    const requestId = "01991111-1111-7111-8111-111111111111"
    expect(
      codexChatSteerContract.request.parse({ files: [], requestId, text: "Focus on tests" })
    ).toMatchObject({ requestId, text: "Focus on tests" })
    expect(
      codexThreadQueueAddContract.request.parse({
        clientUserMessageId: "01992222-2222-7222-8222-222222222222",
        files: [{ mediaType: "image/png", url: "data:image/png;base64,AQID" }],
        text: "",
        threadId: "thread-1",
      })
    ).toMatchObject({ threadId: "thread-1" })
    expect(
      codexChatSteerContract.request.safeParse({ files: [], requestId, text: "   " }).success
    ).toBe(false)
  })

  it("scopes a fork to a concrete thread and optional completed turn", () => {
    expect(
      codexThreadForkContract.request.parse({ lastTurnId: "turn-3", threadId: "thread-1" })
    ).toEqual({ lastTurnId: "turn-3", threadId: "thread-1" })
  })
})
