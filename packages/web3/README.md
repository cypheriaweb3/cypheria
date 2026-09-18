# `@cypheria/web3`

Pure, Electron-independent Web3 domain capabilities shared by the Cypheria server and its privileged desktop boundaries. The package is split into four explicit entry points:

- `@cypheria/web3/network` owns canonical chain identities, network/RPC schemas, catalog records, and conversion helpers.
- `@cypheria/web3/policy` owns signing-policy schemas and deterministic evaluation.
- `@cypheria/web3/wallet` owns wallet, account, chain-account, capability, and signing-intent models.
- `@cypheria/web3/provider` owns dApp session, provider bridge, permission, and bounded transport models.

These modules contain domain logic and testable protocol implementations only. Database and filesystem access, secret custody, signing execution, endpoint lifecycle, and audit persistence belong to `apps/server` (or a temporary Electron privileged boundary until that service is moved).

## Provider boundary

The provider module implements:

- origin normalization, persistent partition naming, and session-scope validation;
- an [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) Ethereum provider with `request`, `on`, `removeListener`, standard events, and structured errors;
- [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) immutable provider details and announce/request discovery;
- Ethereum permission and bounded JSON-RPC IPC envelopes, including common permissionless read-only RPC methods;
- a Solana [Wallet Standard](https://github.com/anza-xyz/wallet-standard/blob/master/WALLET.md) wallet using the official base, feature, chain, and registration packages;
- canonical, size-bounded base64 IPC envelopes for Solana messages, transactions, public keys, 64-byte signatures, and signed transactions;
- protocol-specific persisted permission records and scoped main-to-preload provider events.

`createEthereumProvider()` returns a controller whose `provider` is the dApp-facing EIP-1193 object and whose `emit()` method delivers wallet state changes. `createEip6963ProviderDetail()` and `announceEip6963Provider()` implement multi-provider discovery; Electron preload uses the main-world installer because context-isolated JavaScript objects must cross `contextBridge` safely.

`createSolanaWallet()` exposes `standard:connect`, `standard:disconnect`, `standard:events`, `solana:signMessage`, `solana:signTransaction`, and `solana:signAndSendTransaction`. It validates account address/public-key agreement, chain and feature scope, transaction versions, request scope, response IDs, and batched output cardinality before returning results to a dApp.

Privileged services can forward public read-only RPC methods without wallet permission and gate account, wallet, and signing methods. They can also implement silent or interactive connections, persisted origin permissions, connection state, policy-backed signing intents, injected execution, and redacted audit events without coupling this package to private keys.

EIP-6963 and Wallet Standard icons are restricted to raster data URIs. JSON-RPC depth, node count, and string length are bounded; Solana messages, transactions, signatures, batches, account identifiers, and response cardinality are validated before crossing a privileged boundary.

The package never handles private keys or signs directly. Its transports forward validated requests to trusted server services, which own permissions, policy evaluation, signing execution, and audit records.
