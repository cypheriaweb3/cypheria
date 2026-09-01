# `@cypheria/wallet-provider`

Shared, Electron-independent wallet-provider boundaries for Cypheria dApp sessions.

The package implements:

- origin normalization, persistent partition naming, and session-scope validation;
- an [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) Ethereum provider with `request`, `on`, `removeListener`, standard events, and structured errors;
- [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) immutable provider details and announce/request discovery;
- Ethereum permission and bounded JSON-RPC IPC envelopes, including common permissionless read-only RPC methods;
- a Solana [Wallet Standard](https://github.com/anza-xyz/wallet-standard/blob/master/WALLET.md) wallet using the official base, feature, chain, and registration packages;
- canonical, size-bounded base64 IPC envelopes for Solana messages, transactions, public keys, 64-byte signatures, and signed transactions;
- protocol-specific persisted permission records and scoped main-to-preload provider events.

`createEthereumProvider()` returns a controller whose `provider` is the dApp-facing EIP-1193 object and whose `emit()` method delivers wallet state changes. `createEip6963ProviderDetail()` and `announceEip6963Provider()` implement multi-provider discovery; Electron preload uses the main-world installer because context-isolated JavaScript objects must cross `contextBridge` safely.

`createSolanaWallet()` exposes `standard:connect`, `standard:disconnect`, `standard:events`, `solana:signMessage`, `solana:signTransaction`, and `solana:signAndSendTransaction`. It validates account address/public-key agreement, chain and feature scope, transaction versions, request scope, response IDs, and batched output cardinality before returning results to a dApp.

`createEthereumProviderRuntimeService()` forwards public read-only RPC methods without wallet permission and gates account, wallet, and signing methods. `createSolanaProviderRuntimeService()` implements silent and interactive connection, persisted origin permissions, connection state, policy-backed Solana signing intents, injected execution, and redacted audit events. A runtime can provide an RPC dispatcher and chain-specific EVM or Ed25519 executor without coupling the protocol package to private keys.

EIP-6963 and Wallet Standard icons are restricted to raster data URIs. JSON-RPC depth, node count, and string length are bounded; Solana messages, transactions, signatures, batches, account identifiers, and response cardinality are validated before crossing a privileged boundary.

The package never handles private keys or signs directly. Its transports forward validated requests to trusted runtime services, which own permissions, policy evaluation, signing intents, execution, and audit records.
