---
title: Web3
---

# Web3

Cypheria separates pure Web3 domain types from privileged execution. `@cypheria/web3` provides the `network`, `wallet`, `policy`, and `provider` modules. `apps/server/src/runtime` owns persistence, credentials, vault access, policy evaluation, signing, dApp sessions, and audit.

## Ownership

Clients use `client.web3`. They may create networks, manage wallet metadata, submit signing intents, answer approvals, and operate dApp sessions, but cannot access private keys, credential headers, vault files, or provider processes.

Agents and schedules use the same Server boundary. They create intents rather than signatures. Electron owns isolated dApp `WebContents`; it forwards scoped provider requests to the Server.

## Networks

A network definition includes chain identity, native currency, explorers, testnet state, verification metadata, and ordered RPC endpoints. Endpoints declare transport, display label, enablement, local-development allowance, optional headers, health, and revision.

The Server supports listing and creating networks; enabling, disabling, removing, and reordering them; and adding, probing, enabling, disabling, removing, and reordering endpoints. Revisions protect concurrent mutations. Endpoint credentials are stored separately from public endpoint views.

Remote dApp origins require HTTPS; loopback HTTP is allowed for development. URLs, redirects, chain identity, and RPC responses are validated before use.

## Wallets

Wallets can be generated, imported from an HD mnemonic or private key, or added as watch-only records. A wallet may contain ordered accounts and chain accounts. The active context selects wallet, account, network, chain account, and execution mode.

Private material is encrypted in the vault beneath `$CYPHERIA_HOME/vault`, not in normal SQLite tables. The Server exposes lock and unlock operations without returning secrets. Deletion is an explicit destructive operation and audit records must not contain mnemonic, private key, or plaintext signing payloads.

## Policies and approvals

Every signing intent records source (`agent`, `dapp`, or `schedule`), wallet mode, normalized intent, payload hash, policy decision, matched policy, expiry, revision, and approval linkage. Policy evaluation returns one of:

- allow;
- deny;
- require human approval.

Auto-signing is disabled unless an explicit enabled policy allows the exact operation. Approval decisions use optimistic revisions, record a reviewer, and expire. A changed payload produces a new hash and cannot reuse an old approval.

## Signing lifecycle

```text
caller -> signing intent -> policy evaluation -> optional approval
       -> vault-backed signer -> provider submission -> audit record
```

The Server verifies the active context and chain, resolves keys only for the signing operation, signs in the privileged runtime, and clears sensitive intermediate values. Interrupted signing or transaction submission is marked accordingly and is never replayed automatically, including after schedule or Server recovery.

## dApp provider

The provider layer supports scoped Ethereum and Solana sessions and common provider events. A dApp session binds an origin to allowed accounts, networks, methods, and expiry. Session state is isolated by origin; disconnect, account changes, chain changes, and permission updates are explicit events.

Wallet provider requests are schema-validated and routed through policy. A dApp never receives Server credentials or direct access to a wallet implementation.

## Audit

Audit records contain actor, source, event type, correlation ID, payload hash, a redacted summary, and timestamp. Audited events include network and wallet mutations, lock state, policy decisions, approval outcomes, signing attempts, schedule-originated Web3 runs, and transaction results.

Audit data is append-oriented. Redaction occurs before persistence and logging, not only in the UI.

## Security invariants

- No private keys in renderer, localStorage, IndexedDB, logs, or normal database fields.
- No signing without policy evaluation.
- No implicit auto-sign policy.
- No cross-origin dApp session sharing.
- No secret endpoint headers in public network views.
- No automatic replay of interrupted signing or sending.
- No Agent or plugin receives a raw signer.
