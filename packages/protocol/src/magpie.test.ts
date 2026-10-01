import { describe, expect, it } from "vitest"

import {
  MAGPIE_DEFAULT_API_PORT,
  MAGPIE_DEFAULT_GATEWAY_PORT,
  MAGPIE_RESPONSE_TYPES,
  MagpieConfigSchema,
  MagpieServiceViewSchema,
  MagpieStatusGetRequestSchema,
  MagpieStatusGetResponseSchema,
} from "./magpie.ts"
import { MAGPIE_RELEASE, MagpieStateSchema } from "./magpie-api.ts"

describe("Magpie protocol", () => {
  it("defaults to ports away from a standalone magpie's", () => {
    const config = MagpieConfigSchema.parse({})
    expect(config).toEqual({
      apiPort: MAGPIE_DEFAULT_API_PORT,
      enabled: false,
      gatewayPort: MAGPIE_DEFAULT_GATEWAY_PORT,
    })
    expect(MagpieConfigSchema.safeParse({ gatewayPort: 3425 }).success).toBe(false)
    expect(MagpieConfigSchema.safeParse({ apiPort: 3430 }).success).toBe(false)
    expect(MagpieConfigSchema.safeParse({ apiPort: 4000, gatewayPort: 4000 }).success).toBe(false)
  })

  it("round-trips a status request and its result", () => {
    expect(
      MagpieStatusGetRequestSchema.parse({
        payload: {},
        requestId: "r1",
        type: "magpie.status.get.request",
      }).type
    ).toBe("magpie.status.get.request")
    const view = MagpieServiceViewSchema.parse({
      config: { apiPort: 3446, enabled: true, gatewayPort: 3445 },
      error: null,
      gatewayUrl: "http://127.0.0.1:3445",
      installedVersion: MAGPIE_RELEASE.version,
      startedAt: "2026-10-01T00:00:00.000Z",
      status: "ready",
      version: MAGPIE_RELEASE.version,
    })
    const response = MagpieStatusGetResponseSchema.parse({
      payload: { ok: true, value: view },
      requestId: "r1",
      type: "magpie.status.get.response",
    })
    expect(response.payload.ok).toBe(true)
    expect(MAGPIE_RESPONSE_TYPES).toContain("magpie.status.get.response")
    expect(MAGPIE_RESPONSE_TYPES.every((type) => type.endsWith(".response"))).toBe(true)
  })

  it("pins a release with a checksum for every platform", () => {
    expect(MAGPIE_RELEASE.version).toMatch(/-cypheria$/)
    expect(Object.values(MAGPIE_RELEASE.cliSha256).every((sum) => /^[0-9a-f]{64}$/.test(sum))).toBe(
      true
    )
  })

  it("reads magpie's agents from its state", () => {
    const state = MagpieStateSchema.parse({
      agents: [
        {
          fields: [
            {
              key: "model",
              label: "Model",
              options: [{ note: "", value: "gpt-5" }],
              value: "gpt-5",
            },
          ],
          icon: "codex",
          id: "codex",
          name: "Codex",
          path: "/x/config.toml",
        },
      ],
      catalog: "",
      clients: [],
      profiles: [],
      settings: {},
    })
    expect(state.agents[0]?.id).toBe("codex")
  })
})
