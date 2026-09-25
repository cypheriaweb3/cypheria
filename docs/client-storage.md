---
title: Client Storage
---

# Client Storage

`@cypheria/storage` defines local, cross-platform persistence for Cypheria clients. It is for UI state, rebuildable client replicas, and attachment bytes. It is not a second authoritative product database and does not replace the Server or `@cypheria/db`.

## Ownership and scope

Client domains depend on the smallest semantic port they need:

- `KeyValueStorage` stores small string values used by validated Jotai atoms and other local preferences.
- `ReplicaStore` stores rows identified by scope, entity type, and entity ID. Domain owners serialize and validate each payload; the port owns transactions, lookup, scope rename or deletion, and schema reset.
- `AttachmentStore` stores binary bytes separately from attachment metadata. Metadata contains an opaque storage key and storage type, never an unrestricted path.

Only rebuildable or device-local data belongs here. Threads, Timeline history, schedules, wallet policy, audit records, integrations, and shared settings remain Server-owned and flow through `@cypheria/client`. Private keys, mnemonics, tokens, signers, and other secrets must not use these stores.

## Runtime composition

| Runtime | Key/value | Replica | Attachment bytes |
| --- | --- | --- | --- |
| Desktop (TanStack Start renderer + Electron) | browser `localStorage` | IndexedDB | Electron-owned files under `userData/client-attachments`, accessed through validated preload IPC |
| Expo Web | browser `localStorage` | IndexedDB | IndexedDB |
| Expo iOS and Android | AsyncStorage | `expo-sqlite` | app document files through `expo-file-system` |

Desktop and Expo compose the ports at their application boundary. A caller opens the replica before use and closes it when its runtime is disposed. Web adapters avoid browser globals at module evaluation so server rendering can import the composition safely; actual storage access still requires a browser runtime.

## Key-value state

Raw key/value storage only persists strings. `@cypheria/storage/jotai` adds `atomWithValidatedStorage` and `createValidatedJotaiStorage`: values are wrapped with an explicit version, validated with Zod on reads and writes, optionally migrated, and removed if corrupt. Application state uses Jotai; the storage package does not introduce Zustand.

Keys must be stable, namespaced, and owned by one domain. Larger collections and queryable records belong in the replica rather than a single JSON value.

## Replica store

The replica is a semantic row store, not a portable SQL API. Each row has `scopeId`, `entityType`, `entityId`, and a serialized payload. The owning domain defines payload schemas and converts records at the boundary.

The application supplies a positive semantic schema version. When that version changes, an adapter clears the rebuildable replica instead of trying to expose platform-specific migrations. IndexedDB and SQLite implementations provide atomic batches for upserts and deletes. Replica contents must be recoverable from the Server or another durable source.

## Attachment bytes

Attachment metadata and bytes have separate lifecycles. A domain persists metadata in its normal record, while `AttachmentStore` saves and reads bytes by an opaque generated key. Garbage collection receives the set of referenced keys and deletes unreferenced blobs.

The Web adapter keeps blobs in a dedicated IndexedDB database. Native Expo stores them in its document directory. Desktop sends bounded `Uint8Array` values over the isolated preload bridge; Electron main validates the key, enforces a 32 MiB limit, and writes only inside its owned directory. Renderer code never receives a filesystem path or Node.js access.

## Validation and security

Storage adapters validate identifiers and storage types, but domain owners must validate deserialized replica payloads and attachment metadata. Client replicas and browser storage are ordinary local application data: they are not encrypted secret storage and must not be trusted as authority after reconnecting to the Server.

Electron keeps context isolation and sandboxing enabled. Its attachment IPC accepts only the four declared operations—write, read, delete, and list—and never accepts arbitrary paths. Protocol-visible or shared state still crosses the normal Zod-validated client/server boundary.
