import type { CodexPermissionsMode } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { ThreadHarnessCreateInput } from "../thread/harness-adapter.js"
import type {
  AgentManager,
  AgentMessageContext,
  AgentRuntimeServerMessage,
} from "./agent-manager.js"
import { codexConfiguredPermissions, codexPermissionWire } from "./codex-permissions.js"
import { ManagedThreadAdapter } from "./managed-thread-adapter.js"

/** Hooks the adapter calls for the app tools plugin; tests run without the plugin. */
const appToolHooks = {
  appToolsThreadEnvironment: () => ({}),
  prepareAppTools: async () => undefined,
}

describe("codexPermissionWire", () => {
  it("sends the built-in profile with its approval settings", () => {
    expect(codexPermissionWire("auto")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      permissions: ":workspace",
    })
    expect(codexPermissionWire("guardian-approvals")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "guardian_subagent",
      permissions: ":workspace",
    })
    expect(codexPermissionWire("full-access")).toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      permissions: ":danger-full-access",
    })
  })

  it("sends nothing for agent-config or an unset mode", () => {
    expect(codexPermissionWire("agent-config")).toBeNull()
    expect(codexPermissionWire(null)).toBeNull()
    expect(codexPermissionWire(undefined)).toBeNull()
  })

  it("never mixes a profile with a legacy sandbox", () => {
    for (const mode of ["auto", "guardian-approvals", "full-access"] as const) {
      expect(codexPermissionWire(mode)).not.toHaveProperty("sandbox")
      expect(codexPermissionWire(mode)).not.toHaveProperty("sandboxPolicy")
    }
  })
})

describe("codexConfiguredPermissions", () => {
  it("states the configured sandbox when a preset has to be cleared", () => {
    expect(
      codexConfiguredPermissions({
        approval_policy: "on-request",
        approvals_reviewer: "user",
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: { network_access: true, writable_roots: ["/data"] },
      } as never)
    ).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: true,
        type: "workspaceWrite",
        writableRoots: ["/data"],
      },
    })
    expect(codexConfiguredPermissions({ sandbox_mode: "danger-full-access" } as never)).toEqual({
      sandboxPolicy: { type: "dangerFullAccess" },
    })
  })
})

const THREAD_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf399"

const create = (mode: CodexPermissionsMode | null): ThreadHarnessCreateInput => ({
  agentId: "codex",
  config: { model: null, permissionsMode: mode, speed: null, thinking: null },
  cwd: "/repo",
  onEvent: () => undefined,
  threadId: THREAD_ID,
  workspaceRoots: ["/repo", "/shared"],
})

const harness = () => {
  const requests: Record<string, unknown>[] = []
  const handleCodex = vi.fn(
    async (message: Record<string, unknown>, context: AgentMessageContext) => {
      requests.push(message)
      const reply = (type: string, payload: Record<string, unknown>) =>
        context.send({
          payload: { requestId: message.requestId, ...payload },
          type,
        } as unknown as AgentRuntimeServerMessage)
      switch (message.type) {
        case "agent.codex.config.read.request":
          reply("agent.codex.config.read.response", {
            config: {
              approval_policy: "never",
              approvals_reviewer: "user",
              sandbox_mode: "read-only",
            },
          })
          return
        case "agent.codex.thread.start.request":
          reply("agent.codex.thread.start.response", {
            thread: { id: "codex-thread-1", turns: [] },
          })
          return
        case "agent.codex.turn.start.request":
          reply("agent.codex.turn.start.response", {
            turn: { id: `turn-${requests.length}`, items: [], status: "inProgress" },
          })
          return
        case "agent.codex.thread.settings.update.request":
          reply("agent.codex.thread.settings.update.response", {})
          return
        default:
          reply(`${String(message.type).replace(/\.request$/, ".response")}`, {})
      }
    }
  )
  const manager = {
    codexDynamicTools: { resolveSpecs: async () => [] },
    codexDeveloperInstructions: async () => "<app-context>test</app-context>",
    handleCodex,
    ...appToolHooks,
  } as unknown as AgentManager
  const only = (type: string) => requests.filter((request) => request.type === type)
  return { adapter: new ManagedThreadAdapter(manager, "codex"), only, requests }
}

const turn = (
  adapter: ManagedThreadAdapter,
  overrides: {
    clientKind?: string
    cwd?: string
    mode?: CodexPermissionsMode | null
    roots?: string[]
    workspaceKind?: "project" | "projectless"
  } = {}
) =>
  adapter.startTurn({
    ...(overrides.clientKind ? { clientKind: overrides.clientKind } : {}),
    ...(overrides.workspaceKind ? { workspaceKind: overrides.workspaceKind } : {}),
    agentId: "codex",
    agentSessionId: "codex-thread-1",
    clientMessageId: `m-${Math.random()}`,
    config: {
      model: null,
      permissionsMode: overrides.mode === undefined ? "auto" : overrides.mode,
      speed: null,
      thinking: null,
    },
    content: [{ text: "hi", type: "text" }],
    cwd: overrides.cwd ?? "/repo",
    threadId: THREAD_ID,
    workspaceRoots: overrides.roots ?? ["/repo", "/shared"],
  })

describe("Codex permissions on the wire", () => {
  it.each([
    ["auto", { approvalsReviewer: "user", permissions: ":workspace" }],
    ["guardian-approvals", { approvalsReviewer: "guardian_subagent", permissions: ":workspace" }],
    ["full-access", { approvalPolicy: "never", permissions: ":danger-full-access" }],
  ] as const)("starts and runs a Thread in %s mode with a profile", async (mode, expected) => {
    const { adapter, only } = harness()
    await adapter.create(create(mode))
    await turn(adapter, { mode })
    for (const request of [
      only("agent.codex.thread.start.request")[0],
      only("agent.codex.turn.start.request")[0],
    ]) {
      expect(request).toMatchObject(expected)
      expect(request).not.toHaveProperty("sandbox")
      expect(request).not.toHaveProperty("sandboxPolicy")
    }
  })

  it("lets Codex apply its configuration in agent-config mode", async () => {
    const { adapter, only } = harness()
    await adapter.create(create("agent-config"))
    await turn(adapter, { mode: "agent-config" })
    for (const request of [
      only("agent.codex.thread.start.request")[0],
      only("agent.codex.turn.start.request")[0],
    ]) {
      for (const key of [
        "permissions",
        "approvalPolicy",
        "approvalsReviewer",
        "sandbox",
        "sandboxPolicy",
      ]) {
        expect(request).not.toHaveProperty(key)
      }
    }
    expect(only("agent.codex.thread.start.request")[0]).toMatchObject({
      config: { "features.request_permissions_tool": true },
    })
    expect(only("agent.codex.config.read.request")).toHaveLength(0)
  })

  it("states the configured values once when a preset switches to agent-config", async () => {
    const { adapter, only } = harness()
    await adapter.create(create("auto"))
    await turn(adapter, { mode: "agent-config" })
    expect(only("agent.codex.turn.start.request")[0]).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: { networkAccess: false, type: "readOnly" },
    })
    expect(only("agent.codex.turn.start.request")[0]).not.toHaveProperty("permissions")
    await turn(adapter, { mode: "agent-config" })
    expect(only("agent.codex.turn.start.request")[1]).not.toHaveProperty("sandboxPolicy")
    expect(only("agent.codex.config.read.request")).toHaveLength(1)
  })

  it("restores a preset after agent-config", async () => {
    const { adapter, only } = harness()
    await adapter.create(create("agent-config"))
    await turn(adapter, { mode: "full-access" })
    expect(only("agent.codex.turn.start.request")[0]).toMatchObject({
      permissions: ":danger-full-access",
    })
  })
})

describe("Codex turn workspace", () => {
  it("sends the working directory and roots on every turn", async () => {
    const { adapter, only } = harness()
    await adapter.create(create("auto"))
    await turn(adapter)
    await turn(adapter, { cwd: "/repo.worktree", roots: ["/repo.worktree", "/shared"] })
    const turns = only("agent.codex.turn.start.request")
    expect(turns[0]).toMatchObject({ cwd: "/repo", runtimeWorkspaceRoots: ["/repo", "/shared"] })
    expect(turns[1]).toMatchObject({
      cwd: "/repo.worktree",
      runtimeWorkspaceRoots: ["/repo.worktree", "/shared"],
    })
  })

  it("rejects a working directory outside the roots before calling Codex", async () => {
    const { adapter, only } = harness()
    await adapter.create(create("auto"))
    await expect(turn(adapter, { cwd: "/elsewhere" })).rejects.toThrow(
      "working directory must be one of its workspace roots"
    )
    expect(only("agent.codex.turn.start.request")).toHaveLength(0)
  })
})

describe("Codex turn attribution", () => {
  it("names this product as the turn source and the client that submitted it", async () => {
    const { adapter, only } = harness()
    await adapter.create(create("auto"))
    await turn(adapter, { clientKind: "desktop", workspaceKind: "projectless" })
    await turn(adapter, { clientKind: "schedule" })
    expect(only("agent.codex.turn.start.request")[0]).toMatchObject({
      responsesapiClientMetadata: {
        client_type: "desktop_app",
        source: "cypheria",
        workspace_kind: "projectless",
      },
      turnTrigger: "composer",
    })
    expect(only("agent.codex.turn.start.request")[1]).toMatchObject({
      responsesapiClientMetadata: {
        client_type: "schedule",
        source: "cypheria",
        workspace_kind: "project",
      },
    })
  })
})
