import { describe, expect, it } from "vitest"

import { parseSessionInboundMessage, parseSessionOutboundMessage } from "./index.js"

describe("integration protocol", () => {
  it("keeps marketplace source and plugin ecosystem provenance separate", () => {
    const message = parseSessionOutboundMessage({
      payload: {
        ok: true,
        value: {
          capabilities: {
            addMarketplace: true,
            configure: false,
            install: true,
            readDetail: true,
            removeMarketplace: true,
            scopes: [],
            setEnabled: true,
            uninstall: true,
            upgradeMarketplace: true,
          },
          errors: [],
          marketplaces: [
            {
              displayName: "Team catalog",
              name: "team",
              path: "/catalog",
              plugins: [
                {
                  availability: "AVAILABLE",
                  brandColor: null,
                  capabilities: [],
                  category: null,
                  compatibility: ["codex"],
                  description: null,
                  developerName: null,
                  displayName: "Review",
                  ecosystem: "openai",
                  enabled: true,
                  featured: false,
                  id: "review@team",
                  installed: false,
                  installedScopes: [],
                  installPolicy: "AVAILABLE",
                  logoUrl: null,
                  marketplaceName: "team",
                  marketplacePath: "/catalog",
                  name: "review",
                  harness: { agentId: "codex", nativeId: "review@team" },
                  sourceType: "git",
                  version: null,
                },
              ],
              sourceKind: "custom",
            },
          ],
        },
      },
      requestId: "req_integrations",
      type: "integration.plugin.list.response",
    })
    expect(message.payload).toMatchObject({
      value: { marketplaces: [{ plugins: [{ ecosystem: "openai" }], sourceKind: "custom" }] },
    })
  })

  it("offers an install to every supporting Agent and asks per Agent to confirm install commands", () => {
    const sha256 = "a".repeat(64)
    const message = parseSessionOutboundMessage({
      payload: {
        ok: true,
        value: {
          results: [
            { agentId: "codex", appsNeedingAuth: [], reloadPending: false, status: "done" },
            {
              agentId: "claude",
              confirmation: { command: "my-tool path", pluginId: "tool@team", sha256 },
              status: "confirmation_required",
            },
            { agentId: "pi", message: "unsupported", status: "failed" },
          ],
        },
      },
      requestId: "req_install",
      type: "integration.plugin.install.response",
    })
    expect(message.payload).toMatchObject({
      value: {
        results: [{ status: "done" }, { status: "confirmation_required" }, { status: "failed" }],
      },
    })
    expect(
      parseSessionInboundMessage({
        payload: {
          acceptCommands: { claude: sha256 },
          agentIds: ["claude"],
          marketplaceName: "team",
          pluginName: "tool",
          scope: "user",
        },
        requestId: "req_install_accept",
        type: "integration.plugin.install.request",
      }).type
    ).toBe("integration.plugin.install.request")
    expect(() =>
      parseSessionInboundMessage({
        payload: {
          acceptCommands: { claude: "short" },
          marketplaceName: "team",
          pluginName: "tool",
        },
        requestId: "req_install_bad",
        type: "integration.plugin.install.request",
      })
    ).toThrow()
  })

  it("adds, updates and removes marketplaces for every Agent without naming one", () => {
    expect(() =>
      parseSessionInboundMessage({
        payload: { agentId: "codex", source: "acme/team" },
        requestId: "req_add",
        type: "integration.marketplace.add.request",
      })
    ).toThrow()
    expect(
      parseSessionInboundMessage({
        payload: { source: "acme/team" },
        requestId: "req_add",
        type: "integration.marketplace.add.request",
      }).type
    ).toBe("integration.marketplace.add.request")
  })

  it("rejects Apps operations outside the Codex harness namespace", () => {
    expect(() =>
      parseSessionInboundMessage({
        payload: { agentId: "claude" },
        requestId: "req_apps",
        type: "integration.claude.app.list.request",
      })
    ).toThrow()
  })
})
