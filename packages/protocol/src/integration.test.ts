import { describe, expect, it } from "vitest"

import { parseSessionInboundMessage, parseSessionOutboundMessage } from "./index.js"

describe("integration protocol", () => {
  it("keeps marketplace source and plugin ecosystem provenance separate", () => {
    const message = parseSessionOutboundMessage({
      payload: {
        ok: true,
        value: {
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
                  installPolicy: "AVAILABLE",
                  logoUrl: null,
                  marketplaceName: "team",
                  marketplacePath: "/catalog",
                  name: "review",
                  provider: { agentId: "codex", nativeId: "review@team" },
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

  it("rejects Apps operations outside the Codex provider namespace", () => {
    expect(() =>
      parseSessionInboundMessage({
        payload: { agentId: "claude" },
        requestId: "req_apps",
        type: "integration.claude.app.list.request",
      })
    ).toThrow()
  })
})
