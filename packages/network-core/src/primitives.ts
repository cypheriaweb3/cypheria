import { z } from "zod"

export type NetworkId = `network_${string}`
export type RpcEndpointId = `rpc_${string}`
export type NetworkCredentialRef = `network_credential_${string}`
export type ChainKey = `eip155:${string}` | `solana:${string}`

const prefixedIdSchema = <TPrefix extends string>(prefix: TPrefix) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]*$`, "u"))

export const networkIdSchema = prefixedIdSchema("network").transform((value) => value as NetworkId)
export const rpcEndpointIdSchema = prefixedIdSchema("rpc").transform(
  (value) => value as RpcEndpointId
)
export const networkCredentialRefSchema = prefixedIdSchema("network_credential").transform(
  (value) => value as NetworkCredentialRef
)

export const timestampSchema = z.iso.datetime()
