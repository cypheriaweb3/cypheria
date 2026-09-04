import { z } from "zod"
import { chainIdentitySchema } from "./chain.js"
import {
  nativeCurrencySchema,
  networkExplorerSchema,
  networkVerificationSchema,
} from "./network.js"

export const catalogRpcEndpointSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
    label: z.string().trim().min(1).max(80),
    transport: z.enum(["http", "websocket"]),
    url: z.url(),
  })
  .strict()

export const networkCatalogEntrySchema = z
  .object({
    catalogKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
    chain: chainIdentitySchema,
    name: z.string().trim().min(1).max(80),
    nativeCurrency: nativeCurrencySchema,
    explorers: z.array(networkExplorerSchema).max(8),
    verification: networkVerificationSchema,
    testnet: z.boolean(),
    endpoints: z.array(catalogRpcEndpointSchema).min(1),
  })
  .strict()

export type CatalogRpcEndpoint = z.infer<typeof catalogRpcEndpointSchema>
export type NetworkCatalogEntry = z.infer<typeof networkCatalogEntrySchema>

export const NETWORK_CATALOG_VERSION = 1

export const bundledNetworkCatalog = networkCatalogEntrySchema.array().parse([
  {
    catalogKey: "ethereum-mainnet",
    chain: { namespace: "eip155", reference: "1" },
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorers: [{ name: "Etherscan", url: "https://etherscan.io/" }],
    verification: { kind: "evm-chain-id" },
    testnet: false,
    endpoints: [
      {
        key: "cloudflare",
        label: "Cloudflare",
        transport: "http",
        url: "https://cloudflare-eth.com/",
      },
    ],
  },
  {
    catalogKey: "ethereum-sepolia",
    chain: { namespace: "eip155", reference: "11155111" },
    name: "Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    explorers: [{ name: "Etherscan", url: "https://sepolia.etherscan.io/" }],
    verification: { kind: "evm-chain-id" },
    testnet: true,
    endpoints: [
      {
        key: "publicnode",
        label: "PublicNode",
        transport: "http",
        url: "https://ethereum-sepolia-rpc.publicnode.com/",
      },
    ],
  },
  {
    catalogKey: "solana-mainnet",
    chain: { namespace: "solana", reference: "mainnet" },
    name: "Solana",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
    explorers: [{ name: "Solana Explorer", url: "https://explorer.solana.com/" }],
    verification: {
      kind: "solana-genesis-hash",
      genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    },
    testnet: false,
    endpoints: [
      {
        key: "solana",
        label: "Solana Foundation",
        transport: "http",
        url: "https://api.mainnet-beta.solana.com/",
      },
    ],
  },
  {
    catalogKey: "solana-devnet",
    chain: { namespace: "solana", reference: "devnet" },
    name: "Solana Devnet",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
    explorers: [{ name: "Solana Explorer", url: "https://explorer.solana.com/" }],
    verification: {
      kind: "solana-genesis-hash",
      genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    },
    testnet: true,
    endpoints: [
      {
        key: "solana",
        label: "Solana Foundation",
        transport: "http",
        url: "https://api.devnet.solana.com/",
      },
    ],
  },
])
