import { describe, expect, it } from "vitest"

import {
  HarnessAuthFlowSchema,
  HarnessAuthStartRequestSchema,
  HarnessAuthTestResponseSchema,
  HarnessViewSchema,
} from "./harness.ts"

describe("harness authentication protocol", () => {
  it("groups mutually exclusive methods under one provider", () => {
    expect(
      HarnessViewSchema.parse({
        agentId: "pi",
        connections: [],
        mode: "multiple",
        providers: [
          {
            authMethods: [
              { description: null, fields: [], id: "oauth", label: "Account" },
              {
                description: null,
                fields: [
                  {
                    defaultValue: null,
                    description: null,
                    hidden: false,
                    id: "key",
                    label: "API key",
                    max: null,
                    min: null,
                    options: [],
                    placeholder: null,
                    required: true,
                    type: "secret",
                    url: null,
                    when: [],
                  },
                ],
                id: "api_key",
                label: "API key",
              },
            ],
            busy: false,
            description: "Anthropic credentials",
            id: "anthropic",
            label: "Anthropic",
          },
        ],
      }).providers[0]?.authMethods.map(({ id }) => id)
    ).toEqual(["oauth", "api_key"])
  })

  it("requires both a provider and one of its methods when authentication starts", () => {
    expect(() =>
      HarnessAuthStartRequestSchema.parse({
        payload: { agentId: "opencode", methodId: "oauth:browser" },
        requestId: "request_1",
        type: "harness.auth.start.request",
      })
    ).toThrow()
  })

  it("accepts method-scoped form values without a legacy secret field", () => {
    expect(
      HarnessAuthStartRequestSchema.parse({
        payload: {
          agentId: "opencode",
          methodId: "key:key",
          providerId: "openai",
          values: { key: "test-key", region: "us" },
        },
        requestId: "request_values",
        type: "harness.auth.start.request",
      }).payload.values
    ).toEqual({ key: "test-key", region: "us" })
    expect(() =>
      HarnessAuthStartRequestSchema.parse({
        payload: {
          agentId: "opencode",
          methodId: "key:key",
          providerId: "openai",
          secret: "legacy-key",
        },
        requestId: "request_legacy",
        type: "harness.auth.start.request",
      })
    ).toThrow()
  })

  it("returns structured connection test results", () => {
    expect(
      HarnessAuthTestResponseSchema.parse({
        payload: {
          ok: true,
          value: {
            latencyMs: 42,
            message: "Connected to OpenAI.",
            status: "succeeded",
            testedAt: "2026-09-21T00:00:00.000Z",
          },
        },
        requestId: "request_2",
        type: "harness.auth.test.response",
      }).payload.ok
    ).toBe(true)
  })

  it("preserves interactive choices and device codes as structured auth state", () => {
    expect(
      HarnessAuthFlowSchema.parse({
        deviceCode: null,
        externalUrl: null,
        flowId: "pi:flow",
        input: "select",
        inputOptions: [
          { description: null, label: "Browser login", value: "browser" },
          { description: "For headless use", label: "Device code", value: "device_code" },
        ],
        message: "Choose a login method",
        placeholder: null,
        state: "pending",
        terminalId: null,
      })
    ).toMatchObject({ input: "select" })

    expect(
      HarnessAuthFlowSchema.parse({
        deviceCode: {
          expiresInSeconds: 900,
          intervalSeconds: 5,
          userCode: "ABCD-EFGH",
          verificationUri: "https://example.com/device",
        },
        externalUrl: "https://example.com/device",
        flowId: "pi:device",
        input: "none",
        inputOptions: [],
        message: null,
        placeholder: null,
        state: "pending",
        terminalId: null,
      })
    ).toMatchObject({ deviceCode: { userCode: "ABCD-EFGH" } })
  })
})
