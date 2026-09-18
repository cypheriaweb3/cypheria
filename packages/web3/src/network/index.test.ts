import { describe, expect, it } from "vitest"
import {
  bundledNetworkCatalog,
  chainIdentitySchema,
  chainKeySchema,
  evmChainIdentityFromHex,
  evmChainIdentityFromNumber,
  evmChainIdentityToHex,
  networkDefinitionSchema,
  normalizeRpcUrl,
  projectRpcEndpoint,
  redactRpcUrl,
  rpcEndpointSchema,
  solanaChainIdentityFromWalletStandard,
  toChainKey,
} from "./index.js"

describe("chain identity", () => {
  it("canonicalizes EIP-1193 chain IDs", () => {
    expect(evmChainIdentityFromHex("0x1")).toEqual({ namespace: "eip155", reference: "1" })
    expect(evmChainIdentityToHex(evmChainIdentityFromNumber(11_155_111))).toBe("0xaa36a7")
    expect(() => evmChainIdentityFromHex("0x01")).toThrow()
    expect(() => evmChainIdentityFromNumber(Number.MAX_SAFE_INTEGER + 1)).toThrow()
  })

  it("round-trips canonical chain keys", () => {
    const identity = solanaChainIdentityFromWalletStandard("solana:devnet")
    expect(toChainKey(identity)).toBe("solana:devnet")
    expect(chainKeySchema.parse("eip155:1")).toBe("eip155:1")
    expect(() => chainIdentitySchema.parse({ namespace: "eip155", reference: "01" })).toThrow()
  })
})

describe("network schemas", () => {
  const timestamp = "2026-09-04T00:00:00.000Z"

  it("enforces catalog ownership and immutable identity shape", () => {
    const network = networkDefinitionSchema.parse({
      id: "network_ethereum",
      chain: { namespace: "eip155", reference: "1" },
      name: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      explorers: [{ name: "Etherscan", url: "https://etherscan.io" }],
      verification: { kind: "evm-chain-id" },
      testnet: false,
      source: "builtin",
      catalogKey: "ethereum-mainnet",
      enabled: true,
      deprecated: false,
      position: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    expect(toChainKey(network.chain)).toBe("eip155:1")
    expect(() => networkDefinitionSchema.parse({ ...network, catalogKey: undefined })).toThrow()
  })

  it("projects protected endpoints without credential references", () => {
    const endpoint = rpcEndpointSchema.parse({
      id: "rpc_primary",
      networkId: "network_ethereum",
      label: "Primary",
      transport: "http",
      connection: {
        kind: "protected",
        displayUrl: "https://rpc.example/redacted",
        credentialRef: "network_credential_primary",
      },
      source: "custom",
      localDevelopment: false,
      enabled: true,
      deprecated: false,
      position: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    expect(projectRpcEndpoint(endpoint)).not.toHaveProperty("connection.credentialRef")
    expect(projectRpcEndpoint(endpoint).connection.displayUrl).toBe("https://rpc.example/redacted")
  })

  it("ships a strict unique minimal catalog", () => {
    expect(bundledNetworkCatalog.length).toBeGreaterThanOrEqual(4)
    expect(new Set(bundledNetworkCatalog.map(({ catalogKey }) => catalogKey)).size).toBe(
      bundledNetworkCatalog.length
    )
    expect(new Set(bundledNetworkCatalog.map(({ chain }) => toChainKey(chain))).size).toBe(
      bundledNetworkCatalog.length
    )
  })
})

describe("RPC URL normalization", () => {
  it("requires secure remote URLs and explicit loopback development", () => {
    expect(normalizeRpcUrl("https://rpc.example", { transport: "http" })).toBe(
      "https://rpc.example/"
    )
    expect(() => normalizeRpcUrl("http://rpc.example", { transport: "http" })).toThrow()
    expect(
      normalizeRpcUrl("http://127.0.0.1:8545", {
        allowLoopbackDevelopment: true,
        transport: "http",
      })
    ).toBe("http://127.0.0.1:8545/")
    expect(() =>
      normalizeRpcUrl("https://user:secret@rpc.example", { transport: "http" })
    ).toThrow()
    expect(redactRpcUrl("https://user:secret@rpc.example/project/key?token=value#debug")).toBe(
      "https://rpc.example/redacted?redacted"
    )
  })
})
