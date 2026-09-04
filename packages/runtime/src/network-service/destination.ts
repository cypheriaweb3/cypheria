import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { isLoopbackHostname } from "@cypheria/network-core"

export type ResolveRpcAddresses = (hostname: string) => Promise<readonly string[]>

export type RpcDestinationPolicy = {
  readonly localDevelopment: boolean
}

const blockedHostnames = new Set(["0.0.0.0", "metadata.google.internal", "metadata.aws.internal"])

const isBlockedIpv4 = (address: string): boolean => {
  const parts = address.split(".").map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a = 0, b = 0] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

const isLoopbackAddress = (address: string): boolean =>
  address === "::1" || (isIP(address) === 4 && address.startsWith("127."))

const isBlockedAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 4) return isBlockedIpv4(address)
  if (family !== 6) return true
  const normalized = address.toLowerCase()
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:")
  )
}

export const defaultResolveRpcAddresses: ResolveRpcAddresses = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address)

export const assertRpcDestination = async (
  input: string,
  policy: RpcDestinationPolicy,
  resolveAddresses: ResolveRpcAddresses = defaultResolveRpcAddresses
): Promise<URL> => {
  const url = new URL(input)
  const hostname = url.hostname.toLowerCase()
  if (url.username || url.password || url.hash || blockedHostnames.has(hostname)) {
    throw new NetworkRuntimeError("RPC_DESTINATION_BLOCKED", "The RPC destination is blocked.")
  }

  const addresses = await resolveAddresses(hostname).catch(() => [])
  if (addresses.length === 0) {
    throw new NetworkRuntimeError("RPC_ENDPOINT_UNAVAILABLE", "The RPC host could not be resolved.")
  }

  if (policy.localDevelopment) {
    if (
      !new Set(["http:", "ws:"]).has(url.protocol) ||
      !isLoopbackHostname(hostname) ||
      addresses.some((address) => !isLoopbackAddress(address))
    ) {
      throw new NetworkRuntimeError(
        "RPC_DESTINATION_BLOCKED",
        "A development RPC must resolve only to loopback addresses."
      )
    }
  } else if (!new Set(["https:", "wss:"]).has(url.protocol) || addresses.some(isBlockedAddress)) {
    throw new NetworkRuntimeError("RPC_DESTINATION_BLOCKED", "The RPC destination is blocked.")
  }
  return url
}

export type NetworkRuntimeErrorCode =
  | "NETWORK_DISABLED"
  | "NETWORK_IDENTITY_MISMATCH"
  | "NETWORK_NOT_FOUND"
  | "NETWORK_REVISION_CONFLICT"
  | "RPC_BROADCAST_INDETERMINATE"
  | "RPC_DESTINATION_BLOCKED"
  | "RPC_ENDPOINT_UNAVAILABLE"
  | "RPC_REQUEST_FAILED"
  | "RPC_REQUEST_TIMEOUT"

export class NetworkRuntimeError extends Error {
  readonly code: NetworkRuntimeErrorCode
  readonly retryable: boolean

  constructor(code: NetworkRuntimeErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "NetworkRuntimeError"
    this.code = code
    this.retryable = retryable
  }
}
