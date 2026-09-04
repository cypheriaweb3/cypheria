# Network Management

## Purpose

Cypheria needs a network mechanism that is independent from wallets, safe for dApp-originated requests, usable by automation and agent tools, and capable of selecting among multiple RPC endpoints without exposing credentials.

The design separates four concepts that are often incorrectly collapsed:

- **Chain identity** says which ledger is being addressed.
- **Network definition** contains user-facing metadata for that chain.
- **RPC endpoint** describes one way to reach the chain.
- **Network context** selects a configured network for a particular workspace or isolated dApp origin.

A wallet account may retain a chain identity even when its network is disabled or removed. A network is connectivity configuration, not ownership of wallet accounts or transaction history.

V1 implements EVM and Solana identities. The model may grow additional namespace-specific variants, but it does not use an untyped multi-chain metadata bag.

## Archmage-X Assessment

Archmage-X provides useful product precedents:

- Networks are persisted independently from wallets.
- `(kind, chainId)` is unique and presets are installed per chain family.
- Chain-specific builders normalize presets into a shared record.
- Settings support listing, searching, adding, editing, deleting, and ordering networks.
- EVM RPC input is probed for reachability and chain ID.
- dApp requests to add or switch a network require consent.

Cypheria should retain those behaviors, but not copy the underlying model. The Archmage-X design has several liabilities:

- `info: any` and repeated casts make protocol invariants unenforceable.
- `number | string` chain IDs lack one canonical cross-protocol identity.
- Identity is duplicated between the top-level record and protocol-specific `info`.
- A persisted derived search string can become stale.
- Presets are seeded only when a family is empty, so catalog updates are difficult to reconcile.
- RPC routing generally takes the first URL and has no explicit health, failover, stickiness, or retry policy.
- A global active network does not provide origin isolation for dApps.
- Deleting a network cascades into chain accounts and transaction data, conflating connectivity with durable history.
- Mutable nested metadata and editable chain identity make referential integrity fragile.

## Package Boundaries

### `@cypheria/network-core`

A new Electron-independent domain package owns:

- chain identity and canonical chain-key schemas;
- strict EVM and Solana network-definition schemas;
- RPC endpoint, explorer, source, and public projection schemas;
- bundled catalog entry types and reconciliation inputs;
- protocol boundary conversion helpers;
- URL normalization and non-I/O validation.

It does not own databases, network requests, Electron, credentials, wallet state, or dApp approvals.

### Other packages

- `@cypheria/wallet-core` imports chain identity primitives from `@cypheria/network-core`. `ChainAccount` records identity, address, and derivation information; it does not own RPC configuration. The existing `ChainDefinition` and `RpcEndpoint` types move out of wallet-core.
- `@cypheria/db` persists networks, endpoints, ordering, revisions, and active contexts. It never stores protected connection material in ordinary columns.
- `@cypheria/runtime` owns `NetworkManager`, endpoint probing, RPC routing, health state, credential resolution, audit, and coordination with wallets and dApps.
- `@cypheria/wallet-provider` remains a protocol surface. It converts EIP-1193 hexadecimal chain IDs and Solana Wallet Standard identifiers at its boundary, but does not choose endpoints.
- Desktop main owns protected endpoint credentials and exposes only typed, redacted IPC projections to renderer.
- CLI and SDK use the same runtime services directly and do not depend on desktop internals.

## Domain Model

### Chain identity

Chain identity is immutable and protocol-specific:

```ts
type ChainIdentity =
  | {
      namespace: "eip155"
      reference: `${number}`
    }
  | {
      namespace: "solana"
      reference: string
    }

type ChainKey = `${ChainIdentity["namespace"]}:${string}`
```

For EVM, `reference` is the canonical decimal form of a positive safe-integer chain ID, with no leading zero. Protocol adapters convert it to or from the EIP-1193 hexadecimal quantity. For Solana, adapters convert it to or from the Wallet Standard `solana:<reference>` identifier.

Persistence uses separate `namespace` and `reference` columns with a unique constraint. `toChainKey()` produces the only string key used by policy, automation, permissions, and event envelopes. This replaces the current mixture of EVM numbers and protocol-prefixed strings.

### Network definition

```ts
type NetworkDefinition = {
  id: NetworkId
  chain: ChainIdentity
  name: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  explorers: readonly NetworkExplorer[]
  verification:
    | { kind: "evm-chain-id" }
    | { kind: "solana-genesis-hash"; genesisHash: string }
  testnet: boolean
  source: "builtin" | "custom"
  catalogKey?: string
  enabled: boolean
  deprecated: boolean
  position: number
  revision: number
  createdAt: string
  updatedAt: string
}
```

`id` is an opaque stable identifier. `(namespace, reference)` is unique and cannot be edited after creation. Changing chain identity means adding another network, which prevents silently retargeting existing permissions or active contexts.

Built-in metadata is catalog-owned. Users may enable, disable, and reorder built-ins, and may add custom endpoints, but do not mutate catalog identity. Custom networks may edit display metadata with compare-and-swap revision checks.

Explorer definitions contain only HTTPS base URLs and namespace-specific path templates. Runtime helpers generate account, transaction, and token URLs; callers never concatenate untrusted identifiers directly into a URL.

### RPC endpoints

RPC endpoints are first-class ordered records rather than strings embedded in network metadata:

```ts
type RpcEndpoint = {
  id: RpcEndpointId
  networkId: NetworkId
  label: string
  transport: "http" | "websocket"
  connection:
    | { kind: "public"; url: string }
    | { kind: "protected"; displayUrl: string; credentialRef: string }
  source: "builtin" | "custom"
  localDevelopment: boolean
  enabled: boolean
  deprecated: boolean
  position: number
  revision: number
  createdAt: string
  updatedAt: string
}
```

Connection material containing API keys, authorization headers, user info, sensitive query parameters, or secret path components is encrypted under `$CYPHERIA_HOME/config/network-credentials/` through an OS-backed protector. SQLite stores only `credentialRef` and a redacted `displayUrl`. Renderer, dApp pages, Codex, automation definitions, logs, and audit payloads never receive the resolved secret.

Runtime-only health data is not authoritative configuration:

```ts
type RpcEndpointHealth = {
  state: "unknown" | "healthy" | "degraded" | "cooldown"
  observedChainKey?: ChainKey
  latencyMs?: number
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
}
```

Health may be cached under `$CYPHERIA_HOME/cache` but can always be discarded.

## Bundled Catalog

Cypheria ships a small reviewed catalog compatible with viem chain metadata plus reviewed Solana definitions. V1 does not fetch and trust a remote chain registry at startup.

Each built-in entry has a stable `catalogKey` and catalog version. Startup reconciliation:

1. Inserts missing built-in definitions and endpoints.
2. Updates catalog-owned metadata and public endpoints.
3. Preserves user enabled state, ordering, endpoint preferences, and custom endpoints.
4. Marks removed catalog entries deprecated and disabled instead of deleting durable references.

Search text is computed from current normalized fields at query time; it is not persisted as another source of truth.

## Persistence

The database adds:

```txt
networks
network_rpc_endpoints
dapp_network_contexts
```

`networks` enforces unique `(namespace, reference)`, non-negative position, positive revision, source/catalog consistency, and valid native-currency metadata. `network_rpc_endpoints` belongs to a network and may cascade only when a custom network is permanently removed. Endpoint position is unique within its network.

`dapp_network_contexts` stores the selected network independently for each `(origin, protocol)` pair. Ethereum and Solana providers in the same page therefore do not overwrite each other's selection.

`active_wallet_context` gains `network_id`. Persistence verifies that the selected network chain identity matches the selected `ChainAccount`. Disabling a network makes the context unavailable for RPC without deleting the wallet selection.

Wallet chain accounts retain chain identity columns and do not have a cascading foreign key to `networks`. Removing connectivity must never delete accounts, policies, signing intents, transaction records, or audit history. References from active contexts are cleared or rejected explicitly; historical records retain their chain key.

Built-in networks can only be disabled. Custom networks become enabled only after an explicit user action and successful identity probe, and require a separate confirmed operation for permanent removal. Permanent removal deletes their endpoints, protected credentials, and disposable health state; clears workspace and dApp selections; revokes origin grants tied to that configuration; pauses affected automations; and makes pending RPC-dependent work fail with a stable unavailable error. Policies and historical records remain keyed by chain identity but become non-executable while no enabled matching network exists. Re-adding the same chain never silently restores dApp grants or automation execution.

## Runtime Services

### Network manager

`NetworkManager` exposes strict operations to:

- reconcile the bundled catalog;
- list, inspect, add, update, disable, reorder, and remove networks;
- add, update, enable, reorder, probe, and remove RPC endpoints;
- resolve a network by `NetworkId`, `ChainIdentity`, or `ChainKey`;
- select workspace and origin-scoped network contexts;
- return redacted renderer-safe projections.

All mutations use revisions to prevent stale UI or concurrent automation from silently overwriting changes. Network and endpoint changes, dApp add/switch decisions, and credential changes produce redacted audit events. Routine health probes do not flood the audit log.

### RPC router

`RpcRouter` accepts a trusted chain identity and a purpose:

```ts
type RpcPurpose = "read" | "simulate" | "broadcast" | "subscribe"
```

Routing rules:

- Resolve only enabled networks and endpoints whose probed chain identity matches.
- Prefer user order, then current health; do not randomly spread one operation across nodes.
- Keep a request sequence sticky to one endpoint when consistency matters.
- Retry idempotent reads on transport errors, timeouts, HTTP 429, and selected 5xx responses.
- Do not fail over on deterministic JSON-RPC errors.
- Do not automatically retry or fail over a broadcast after an ambiguous response. Return an indeterminate result with the known transaction hash when available.
- Use WebSocket endpoints only for subscription purposes and fall back to polling only when the caller explicitly permits it.
- Apply bounded timeout, response-size, concurrency, and redirect policies.

No quorum reads, weighted load balancing, or complex score persistence are required in V1.

## Endpoint Validation And Security

Adding or editing an endpoint is a two-stage operation: validate locally, then probe through runtime.

For EVM, the probe calls `eth_chainId` and a lightweight read such as `eth_blockNumber`. The observed chain ID must exactly match the target chain identity. For Solana, the probe obtains version and genesis/cluster identity and verifies it against the selected Wallet Standard chain definition.

Custom RPC access is an SSRF boundary because requests originate from a privileged local process:

- Remote endpoints require `https:` or `wss:`.
- Loopback `http:` or `ws:` is allowed only for an explicit user-added development endpoint.
- dApp-originated add-network requests cannot add loopback, private, link-local, multicast, or cloud-metadata destinations.
- DNS resolution is checked at connection time to reduce rebinding risk.
- Redirects are disabled during probes and RPC requests.
- dApps cannot supply headers, credentials, TLS options, or proxy configuration.
- URLs and headers are redacted before logging or audit.

A failed probe cannot be silently overridden for a dApp request. A user-created endpoint may be saved disabled after an explicit warning, but it cannot route traffic until a successful identity probe.

## Wallet, Policy, And Automation Integration

- `ChainAccount` binds an address to `ChainIdentity`, not to an RPC endpoint.
- Workspace active context binds wallet, wallet account, chain account, network, and policy mode. The chain identities must agree.
- Signing intents and policies use `ChainKey`; network or endpoint IDs never become authorization identities.
- Simulation and fee estimation resolve through `RpcRouter` using the intent's chain key.
- Automation definitions may select an allowed chain key but cannot select protected credentials or bypass network policy.
- Disabling a network blocks new RPC-dependent work with a stable `NETWORK_DISABLED` error while preserving signing intents and audit data.

## dApp Provider Integration

Each isolated origin has its own provider network context.

For Ethereum:

- `eth_chainId` returns the origin session's selected EVM network.
- Public read-only RPC is dispatched only through that trusted selection.
- `wallet_switchEthereumChain` parses the requested hexadecimal ID, requires an enabled configured network, obtains user consent, updates only that origin, and then emits `chainChanged` to that dApp.
- `wallet_addEthereumChain` strictly validates EIP-3085 input, probes every proposed RPC URL, requires user consent, and either creates a custom network or offers to add endpoints to an existing identity. It never overwrites existing metadata silently.

For Solana, connect and signing requests must match the origin's selected Solana network and the account's declared Wallet Standard chain. Switching one protocol does not affect the other.

The desktop workspace selection and dApp selections are separate. A user may explicitly choose “follow workspace network” for a dApp session, but this is opt-in and revocable rather than global implicit state.

## Desktop Experience

The network screen provides:

- built-in/custom and enabled/disabled badges;
- explicit ordering controls for networks and endpoints;
- add flows and enablement changes with live chain-identity probes;
- endpoint health, last success, latency, and redacted URL;
- an explicit primary endpoint with ordered fallbacks;
- disable for built-ins and guarded delete for custom networks;
- clear warnings for protected credentials, local development endpoints, and dApp-proposed networks.

Approval screens show the requesting origin, requested chain identity, current chain, metadata differences, every redacted RPC host, and probe results before add or switch approval.

The implemented desktop flow uses a native, origin-labelled approval dialog for synchronous EIP-3085/EIP-3326 requests. The network workbench exposes the same redacted definitions and health state through typed IPC; raw credential URLs and headers never cross into renderer state. Disabling a network clears matching workspace and origin selections, revokes EVM and Solana grants for its chain key, pauses scoped automations, and invalidates in-flight routed work. Custom deletion additionally removes endpoints, protected credentials, and disposable health while retaining policies, signing records, and audit history.

## Failure Semantics

Runtime exposes stable redacted errors such as:

- `NETWORK_NOT_FOUND`
- `NETWORK_DISABLED`
- `NETWORK_IDENTITY_MISMATCH`
- `RPC_ENDPOINT_UNAVAILABLE`
- `RPC_REQUEST_TIMEOUT`
- `RPC_BROADCAST_INDETERMINATE`
- `RPC_DESTINATION_BLOCKED`
- `NETWORK_REVISION_CONFLICT`

Errors never contain endpoint credentials or raw authorization headers.

## V1 Exclusions

- Remote registry auto-import or silent catalog updates.
- Cosmos, Bitcoin, Starknet, Aptos, Sui, and other namespace implementations.
- Quorum RPC, archive-node capability discovery, weighted balancing, or paid-provider billing logic.
- Cloud synchronization of network configuration or credentials.
- Deleting wallet history because a network definition was removed.
- Letting dApps choose filesystem paths, headers, credentials, or unrestricted RPC destinations.

## Implementation Sequence

1. Add `@cypheria/network-core`, strict chain/network/endpoint schemas, conversion helpers, and a minimal bundled catalog.
2. Add database tables, catalog reconciliation, repositories, protected credential storage, and migration tests.
3. Add runtime `NetworkManager`, endpoint probes, health tracking, and purpose-aware `RpcRouter`.
4. Migrate wallet-core, policy, automation, permissions, and active contexts to canonical chain identities.
5. Route Ethereum and Solana provider requests through origin-scoped network contexts and add/switch approval flows.
6. Add typed desktop IPC and the network-management UI.

Each step is independently testable and should be completed as one reviewable todo item.
