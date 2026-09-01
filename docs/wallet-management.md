# Wallet Management

## Scope And Boundaries

Cypheria V1 supports `hd`, `private-key`, `private-key-group`, `watch`, and `watch-group`. The model must permit future hardware, external, embedded, multisig, and account-abstraction providers without changing the local-wallet storage contract.

- `@cypheria/wallet-core` owns domain types, validation, derivation rules, fingerprints, renderer-safe projections, and signer capabilities. It does not own files, databases, Electron, or OS credentials.
- `@cypheria/db` stores non-secret wallet state through Drizzle and libSQL.
- `@cypheria/runtime` owns wallet orchestration, the encrypted vault, unlocked memory, signer construction, policy routing, and audit coordination.
- Renderer, dApp pages, Codex, SDK callers, and automation workers never receive mnemonic phrases, private keys, vault keys, decrypted keystores, or signer objects that expose secrets.

## Domain Model

```txt
Wallet
  WalletAccount
    ChainAccount
```

A `Wallet` is a user-visible container. A `WalletAccount` is a logical derived or imported account. A `ChainAccount` is its public identity for a namespace and chain. Indexes start at zero for every wallet kind; there is no pseudo index.

Wallet kind and provider are independent. V1 secret wallets use provider `local-vault`; watch wallets use `read-only`. A future hardware HD wallet can reuse kind `hd` with provider `hardware`.

Domain identifiers use explicit prefixes (`wallet_`, `account_`, `chain_account_`, and `vault_`). Strict Zod schemas validate every runtime boundary. Renderer projections use a nested `{ wallet, accounts }` shape and re-parse the complete value with strict schemas so accidental secret properties are rejected instead of serialized.

HD schemes are stored per chain namespace. V1 implements EVM `eip155` accounts with secp256k1 and `m/44'/60'/0'/0/{index}`. The schema may represent future namespaces, but unsupported schemes must fail validation.

## Public Persistence

SQLite is the source of truth for wallet metadata, lifecycle state, accounts, addresses, derivation paths, and active context. The current public-state repository persists the first four tables; active-context persistence is added with local wallet management:

```txt
wallets
wallet_accounts
chain_accounts
wallet_hd_schemes
active_wallet_context
```

Normal columns and JSON must never contain mnemonic phrases or entropy, BIP-39 passphrases, private keys, vault encryption keys, decrypted keystores, or serialized local signers. Lifecycle states `initializing`, `ready`, `error`, and `deleting` support recovery across the SQLite/filesystem boundary.

`@cypheria/db` validates complete wallet graphs with the strict wallet-core schemas before using an atomic libSQL batch. Foreign keys cascade wallet deletion, while unique and check constraints enforce fingerprints, names, account indexes, wallet/provider combinations, and the supported EVM derivation scheme. Recovery code can query wallets by lifecycle status without loading any vault secret.

## Fingerprints

Fingerprints deliberately support duplicate detection and are not authentication secrets.

- HD wallets hash a versioned canonical identity containing kind, curve, and the normalized address at the fixed EVM probe path `m/44'/60'/0'/0/0`.
- Single private-key and watch wallets hash kind, namespace, and normalized address.
- Group containers use random stable identities because membership changes. Each member has an account fingerprint for duplicate detection.
- Kind is part of the fingerprint, allowing an HD-derived private key to be imported as a standalone wallet.

## Encrypted Vault

Each secret-bearing wallet has an independent versioned file under `$CYPHERIA_HOME/vault`. Private-key groups use one encrypted entry per account so membership changes do not rewrite unrelated secrets.

The runtime obtains one random 256-bit master key from an OS-backed key provider. Desktop protects its serialized key with Electron `safeStorage` under `$CYPHERIA_HOME/config/wallet-master-key.bin`; an unavailable protector or Linux `basic_text` fallback fails closed. Concurrent first access is single-flight. Per-entry 256-bit keys are derived with HKDF-SHA256 using the vault and entry identifiers.

A narrow ethers adapter encodes and decodes private keys and HD mnemonic entropy as Web3 Secret Storage JSON. Since that standard cannot retain a non-empty BIP-39 passphrase, Cypheria stores the passphrase as an authenticated AES-256-GCM extension encrypted by a distinct subkey of the same entry key. Account derivation, signing, RPC, transaction serialization, and address handling use viem.

Vault files and the protected master-key blob use owner-only permissions. They are written to sibling temporary files, synced, and atomically renamed; deletion uses an atomic tombstone rename. Startup recovery reports referenced but missing vaults and quarantines unreferenced, corrupt, and stale temporary files for explicit recovery. It never silently deletes a ready wallet whose vault is missing.

## Unlocked Memory

The long-lived runtime may cache decrypted secrets in memory. It never copies them to SQLite, browser storage, renderer state, logs, audit payloads, errors, Codex context, or workers. Locking drops cached references. JavaScript cannot promise physical secure zeroization, so the implementation must not claim it.

Unlock returns identifiers and entry kinds only. Decrypted values remain in an internal controller and are available solely to a scoped callback used by trusted runtime wallet orchestration. Public vault errors contain stable codes and redacted messages.

Callers receive opaque signing capabilities such as `signMessage`, `signTypedData`, and `signTransaction`. No public interface exposes `privateKey`, `mnemonic`, or `getKeystore`.

## Creation, Import, And Recovery

A newly generated HD wallet may appear as `initializing` while expensive encryption completes. It becomes usable only after the vault is atomically persisted and SQLite reaches `ready`.

Imported wallets may already control funds, so HD and private-key imports must persist the vault before reporting success. Watch imports have no vault phase. Recovery reconciles lifecycle state and vault files; a missing vault marks an existing wallet as an error instead of erasing its record.

## Signing

Signing resolves an account, validates chain and address, routes an intent through policy and approval, constructs a viem account inside runtime, verifies its address against persisted state, signs, verifies the result where possible, and appends an audit event. Sending and signing a transaction remain distinct permissions. Secrets and sensitive signing inputs are redacted at every runtime boundary.
