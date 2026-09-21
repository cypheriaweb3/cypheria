import { zInitializeResponse as AcpV1InitializeResponseSchema } from "@agentclientprotocol/sdk/zod"

export const ACP_V1_FALLBACK_REQUIRED_CODE = -32_099

export class AcpV1FallbackRequiredError extends Error {
  constructor() {
    super("ACP agent returned v1 initialize fields while claiming protocol version 2")
    this.name = "AcpV1FallbackRequiredError"
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

/**
 * Google Antigravity 1.1.1 answers a v2 initialize request with
 * `protocolVersion: 2`, but serializes the rest of the result with the v1
 * `agentCapabilities` and `agentInfo` fields. Detect only that exact hybrid
 * shape so callers can close the invalid v2 connection and retry a fresh v1
 * handshake. Do not normalize it into v2: the remaining connection must use
 * one negotiated ACP version and its corresponding method/schema surface.
 */
export const isMisreportedAcpV1InitializeResult = (value: unknown): boolean => {
  if (!isRecord(value) || value.protocolVersion !== 2) return false
  const hasV1Fields = Object.hasOwn(value, "agentCapabilities") || Object.hasOwn(value, "agentInfo")
  const hasV2Fields = Object.hasOwn(value, "capabilities") || Object.hasOwn(value, "info")
  if (!hasV1Fields || hasV2Fields) return false
  return AcpV1InitializeResponseSchema.safeParse({ ...value, protocolVersion: 1 }).success
}

export const acpInitializeParams = (protocolVersion: 1 | 2): Record<string, unknown> =>
  protocolVersion === 2
    ? {
        capabilities: { auth: { terminal: {} } },
        info: { name: "cypheria", title: "Cypheria", version: "0.0.0" },
        protocolVersion,
      }
    : {
        clientCapabilities: {},
        clientInfo: { name: "cypheria", version: "0.0.0" },
        protocolVersion,
      }
