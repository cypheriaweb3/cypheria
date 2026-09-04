# Wallet Management

## Scope And Boundaries

Cypheria V1 supports `hd`, `private-key`, `private-key-group`, `watch`, and `watch-group`.

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

Wallet kind determines its storage and signing capabilities. `hd`, `private-key`, and `private-key-group` wallets have a local vault, while `watch` and `watch-group` wallets are read-only and have no vault.

Domain identifiers use explicit prefixes (`wallet_`, `account_`, `chain_account_`, and `vault_`). Strict Zod schemas validate every runtime boundary. Renderer projections use a nested `{ wallet, accounts }` shape and re-parse the complete value with strict schemas so accidental secret properties are rejected instead of serialized.

HD schemes are stored per chain namespace. V1 implements EVM `eip155` accounts with secp256k1 and `m/44'/60'/0'/0/{index}`. The schema may represent future namespaces, but unsupported schemes must fail validation.

## Public Persistence

SQLite is the source of truth for wallet metadata, lifecycle state, accounts, addresses, derivation paths, and active context. The public-state repository persists these tables:

```txt
wallets
wallet_accounts
chain_accounts
wallet_hd_schemes
active_wallet_context
```

Normal columns and JSON must never contain mnemonic phrases or entropy, BIP-39 passphrases, private keys, vault encryption keys, decrypted keystores, or serialized local signers. Lifecycle states `initializing`, `ready`, `error`, and `deleting` support recovery across the SQLite/filesystem boundary.

`@cypheria/db` validates complete wallet graphs with the strict wallet-core schemas before using an atomic libSQL batch. Foreign keys cascade wallet deletion, while unique and check constraints enforce fingerprints, names, account indexes, wallet/vault combinations, and the supported EVM derivation scheme. Recovery code can query wallets by lifecycle status without loading any vault secret.

Wallet display order is public state stored as a numeric position on the wallet record. The runtime accepts only a complete, duplicate-free ordering of all persisted wallet IDs, updates positions in one database batch, and appends newly created wallets after the current order. The desktop management screen combines `@tanstack/react-virtual` with the React-19-compatible `@hello-pangea/dnd` continuation of the drag-and-drop API used by Archmage.

Group wallets use a second virtualized list for their wallet accounts. HD, private-key-group, and watch-group rows can expand without flattening account identity into the top-level wallet order. Account rows are independently draggable, and persistence rewrites only their display indexes; HD derivation paths remain stable. The desktop can derive another HD account through typed IPC. Runtime selects the next unused path in the persisted scheme, duplicates the encrypted HD source into an account-bound vault entry, persists only its public account graph, and audits the mutation.

## Fingerprints

Fingerprints deliberately support duplicate detection and are not authentication secrets.

- HD wallets hash a versioned canonical identity containing kind, curve, and the normalized address at the fixed EVM probe path `m/44'/60'/0'/0/0`. Their derived accounts use a separate HD-account fingerprint domain.
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

Imported wallets may already control funds, so HD and private-key imports persist the vault before creating their public state or reporting success. If the public-state write fails, the newly created vault is removed as compensation. Watch imports have no vault phase. All secret imports may accept an expected address; the runtime derives with viem and rejects a mismatch before persistence.

`@cypheria/runtime` exposes a wallet manager for generating and importing HD wallets, importing single and grouped private keys, adding single and grouped watch wallets, listing renderer-safe views, renaming, deletion, and active-context selection. Duplicate detection compares wallet and account fingerprints across persisted wallets and within a new group. Configured EVM chain IDs share the same EVM address while retaining distinct chain-account records.

The active context stores one selected wallet, wallet account, chain account, and mode. Persistence verifies that all three identifiers belong to the same wallet graph. Only `ready` wallets can be selected, and watch wallets are restricted to `read-only`; deletion clears a selected context through foreign-key cascading. Mutations append redacted audit events without secret material.

Recovery reconciles lifecycle state and vault files; a missing vault marks an existing wallet as an error instead of erasing its record. Deleting a local wallet first records `deleting`, atomically removes its vault, and only then removes public state; a vault failure leaves an `error` record for recovery.

## Signing

`@cypheria/runtime` issues an opaque capability bound to one persisted wallet/account/chain reference. Its methods accept complete, strictly validated signing intents rather than arbitrary signing payloads. Every execution re-resolves ready local-wallet state, checks the bound address and chain, requires an unlocked vault, calls the required policy/approval authorizer, and atomically claims an approved intent ID before signing. The signing service has no bypass path and does not accept `send-transaction`; signing and broadcasting remain distinct permissions.

Production replay protection uses `signing_intent_claims` in libSQL. Authorization occurs before the claim so an intent awaiting human approval is not consumed and can be retried after its decision. Once approved, the intent ID is claimed with its canonical SHA-256 payload hash before secret access, so concurrent or later reuse is rejected across process restarts. A locked vault is also detected before the claim, allowing the same intent to be retried after an explicit unlock. A process-local replay guard exists only as an explicit test or isolated-runtime adapter.

After approval, the vault resolves a secret by wallet account ID only inside its scoped callback. Runtime reconstructs a viem account, verifies its address against public persistence, signs a message, EIP-712 typed data, or a transaction, and verifies the produced signature or recovered transaction sender. The capability returns only a signature or serialized signed transaction.

Policy decisions, rejection, successful signatures, and failures are audited using the intent correlation ID and payload hash. Audit summaries contain identifiers and result types, never private keys, mnemonic material, messages, typed data, or transaction calldata. Public errors use stable redacted codes.
