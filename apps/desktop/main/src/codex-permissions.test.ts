import type { CodexAppServerBridge } from "@cypheria/codex-bridge"
import { describe, expect, it } from "vitest"
import {
  listCodexPermissions,
  readCodexPermissionDefaults,
  writeCodexPermissionDefaults,
} from "./codex-permissions.js"

class FakeBridge {
  readonly calls: Array<{ method: string; params: unknown }> = []
  constructor(private readonly responses: Record<string, unknown>) {}
  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    const response = this.responses[method]
    if (response === undefined) throw new Error(`Missing response for ${method}`)
    return response
  }
}

const asBridge = (bridge: FakeBridge) => bridge as unknown as CodexAppServerBridge
const configResponse = {
  config: {
    approval_policy: "on-request",
    approvals_reviewer: "user",
    desktop: { showFullAccessInComposer: true },
    model_reasoning_summary: "auto",
    model_verbosity: "medium",
    sandbox_mode: "workspace-write",
    sandbox_workspace_write: { network_access: true },
    web_search: "cached",
  },
  layers: null,
  origins: {},
}

describe("Codex permission services", () => {
  it("discovers cwd-sensitive profiles and managed capabilities", async () => {
    const bridge = new FakeBridge({
      "config/read": configResponse,
      "configRequirements/read": {
        requirements: {
          allowedApprovalPolicies: ["on-request", "never"],
          allowedApprovalsReviewers: ["user", "auto_review"],
          allowedPermissionProfiles: { ":danger-full-access": true },
          allowedSandboxModes: ["workspace-write", "danger-full-access"],
          defaultPermissions: ":workspace",
        },
      },
      "permissionProfile/list": {
        data: [
          { allowed: true, description: "Workspace", id: ":workspace" },
          { allowed: true, description: "Docs only", id: "docs" },
        ],
        nextCursor: null,
      },
    })

    await expect(
      listCodexPermissions(asBridge(bridge), "/tmp/codex", "/tmp/project")
    ).resolves.toMatchObject({
      autoReviewAvailable: true,
      availableAgentModes: ["read-only", "auto", "guardian-approvals", "full-access"],
      fullAccessCanBeShown: true,
      profiles: [{ allowed: true, description: "Docs only", id: "docs" }],
      selected: { kind: "profile", profileId: ":workspace" },
      showFullAccess: true,
      source: "managed",
    })
    expect(bridge.calls.at(-1)).toEqual({
      method: "permissionProfile/list",
      params: { cursor: null, cwd: "/tmp/project", limit: 100 },
    })
  })

  it("reads and writes only Codex configuration keys", async () => {
    const bridge = new FakeBridge({
      "config/batchWrite": {
        filePath: "/tmp/config.toml",
        overriddenMetadata: null,
        status: "ok",
        version: "2",
      },
      "config/read": configResponse,
      "configRequirements/read": { requirements: null },
    })
    const settings = await readCodexPermissionDefaults(asBridge(bridge), "/tmp/codex")
    await writeCodexPermissionDefaults(asBridge(bridge), "/tmp/codex", {
      approvalPolicy: settings.approvalPolicy,
      approvalsReviewer: settings.approvalsReviewer,
      modelReasoningSummary: settings.modelReasoningSummary,
      modelVerbosity: settings.modelVerbosity,
      networkAccess: settings.networkAccess,
      sandboxMode: settings.sandboxMode,
      webSearch: settings.webSearch,
    })
    expect(bridge.calls[2]).toMatchObject({ method: "config/batchWrite" })
    expect(bridge.calls[2]?.params).toMatchObject({
      edits: expect.arrayContaining([
        expect.objectContaining({ keyPath: "approval_policy", value: "on-request" }),
        expect.objectContaining({ keyPath: "sandbox_workspace_write.network_access", value: true }),
      ]),
      reloadUserConfig: true,
    })
  })
})
