import { describe, expect, it } from "vitest"

import { codexPermissionWire } from "./codex-permissions.js"
import {
  codexThreadConfig,
  codexThreadForkParams,
  codexThreadResumeParams,
  codexThreadStartParams,
} from "./codex-thread-launch.js"

const config = {
  model: "gpt-5.5",
  permissionsMode: "auto",
  speed: "priority",
  thinking: "high",
} as const
const base = {
  config,
  cwd: "/repo",
  permissions: codexPermissionWire("auto") ?? {},
  workspaceRoots: ["/repo", "/shared"],
}

describe("codexThreadStartParams", () => {
  it("states the full desktop launch", () => {
    expect(
      codexThreadStartParams({
        ...base,
        developerInstructions: "<app-context>x</app-context>",
        dynamicTools: [],
        worktreeConfig: { shell_environment_policy: { set: { A: "1" } } },
      })
    ).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      config: {
        "features.request_permissions_tool": true,
        model_reasoning_effort: "high",
        shell_environment_policy: { set: { A: "1" } },
      },
      cwd: "/repo",
      developerInstructions: "<app-context>x</app-context>",
      dynamicTools: [],
      historyMode: "paginated",
      model: "gpt-5.5",
      permissions: ":workspace",
      runtimeWorkspaceRoots: ["/repo", "/shared"],
      serviceTier: "priority",
      threadSource: "user",
    })
  })

  it("leaves model and tier to Codex when unset and never states base instructions", () => {
    const params = codexThreadStartParams({
      ...base,
      config: { ...config, model: null, speed: null, thinking: null },
      dynamicTools: [],
    })
    for (const key of [
      "model",
      "serviceTier",
      "baseInstructions",
      "personality",
      "serviceName",
      "projectId",
      "sandbox",
    ]) {
      expect(params).not.toHaveProperty(key)
    }
    expect(params.config).toEqual({ "features.request_permissions_tool": true })
  })
})

describe("codexThreadResumeParams", () => {
  it("resumes without turns so history is paged", () => {
    expect(
      codexThreadResumeParams({ ...base, developerInstructions: "d", threadId: "t-1" })
    ).toMatchObject({
      developerInstructions: "d",
      excludeTurns: true,
      permissions: ":workspace",
      threadId: "t-1",
    })
  })
})

describe("codexThreadForkParams", () => {
  it("inherits instructions from the source history", () => {
    const params = codexThreadForkParams(base)
    expect(params).not.toHaveProperty("developerInstructions")
    expect(params).toMatchObject({ excludeTurns: true, threadSource: "user" })
  })
})

describe("codexThreadConfig", () => {
  it("always lets Codex ask for additional permissions", () => {
    expect(codexThreadConfig({ ...base, config: { ...config, thinking: null } })).toEqual({
      "features.request_permissions_tool": true,
    })
  })

  it("injects node_repl into mcp_servers when nodeReplConfig is provided", () => {
    const nodeReplConfig = {
      command: "/path/to/node_repl",
      env: { TEST: "1" },
    }
    expect(
      codexThreadConfig({ ...base, config: { ...config, thinking: null }, nodeReplConfig })
    ).toEqual({
      "features.request_permissions_tool": true,
      mcp_servers: {
        node_repl: nodeReplConfig,
      },
    })
  })
})
