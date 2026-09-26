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
| Desktop (TanStack Start renderer + Electron) | Electron-owned SQLite `~/.cypheria/desktop/kv.sqlite` | Electron-owned SQLite `~/.cypheria/desktop/replica.sqlite` | Electron-owned files under `~/.cypheria/desktop/attachments` |
| Expo Web | browser `localStorage` | IndexedDB | IndexedDB |
| Expo iOS and Android | AsyncStorage | `expo-sqlite` | app document files through `expo-file-system` |

Desktop and Expo compose the ports at their application boundary. Electron main is the sole owner of both Desktop SQLite databases and attachment files; the sandboxed renderer accesses all three stores through the validated preload bridge. On Desktop, Electron main keeps the shared replica open for the application lifetime, so disposing one renderer cannot close storage used by another window. Other callers open the replica before use and close it when their runtime is disposed. Web adapters avoid browser globals at module evaluation so server rendering can import the composition safely; actual storage access still requires a browser runtime.

## Key-value state

Raw key/value storage only persists strings. `@cypheria/storage/jotai` adds `atomWithValidatedStorage` and `createValidatedJotaiStorage`: values are wrapped with an explicit version, validated with a runtime schema on reads and writes, and removed if corrupt or from a different version. Application state uses Jotai; the storage package does not introduce Zustand. Desktop key/value changes are broadcast by Electron main so every renderer window in the same installation observes the same SQLite-backed value. This notification is not cross-client synchronization.

Keys must be stable, semantic camel-case names owned by one domain. Client settings do not add `cypheria`, `client`, or `desktop` prefixes. Static settings use one key per value; dynamic records use `composerDraft:<scopeId>` and `panelLayout:<threadId>`. Every definition starts at envelope version 1. Larger rebuildable collections and queryable records belong in the replica rather than a single JSON value.

Desktop settings are registered with their category, key, schema, default, and version. Renderer components use validated atoms from one explicit vanilla Jotai store. Electron main uses the same codec and definitions for startup appearance and locale, plus settings with operating-system side effects. There is no separate Desktop settings JSON file or broad settings IPC.

The inspection API uses keyset pagination and searches key names. It reads values only for the current page and returns at most a 240-character preview plus the original character count.

## Replica store

The replica is a semantic row store, not a portable SQL API. Each row has `scopeId`, `entityType`, `entityId`, and a serialized payload. The owning domain defines payload schemas and converts records at the boundary.

The application supplies a positive semantic schema version. When that version changes, an adapter clears the rebuildable replica instead of trying to expose platform-specific migrations. IndexedDB and SQLite implementations provide atomic batches for upserts and deletes. The Desktop replica database is physically separate from `kv.sqlite`, so rebuilding it cannot remove key/value state. Replica contents must be recoverable from the Server or another durable source.

Replica inspection also uses an opaque keyset cursor. Queries scan row keys and serialized payloads, but results contain only a 240-character payload preview and its full character count.

## Attachment bytes

Attachment metadata and bytes have separate lifecycles. A domain persists metadata in its normal record, while `AttachmentStore` saves and reads bytes by an opaque generated key. Garbage collection receives the set of referenced keys and deletes unreferenced blobs.

`SaveAttachmentInput` accepts a discriminated `source`: `bytes`, `blob`, base64 `data_url`, or `file_uri`. MIME type is optional and is inferred from Blob or data URL sources when possible; file names are inferred from file URIs when omitted. Expo native resolves file URIs through its file-system API. On Desktop, `file_uri` sources take a direct-copy fast path: IPC carries only the URI and storage key, and Electron main copies the source into managed storage without materializing its bytes in the renderer. Other source kinds retain the bounded byte-transfer fallback.

The Web adapter keeps attachment bytes in a dedicated IndexedDB database. Native Expo stores them in its document directory. Desktop sends bounded `Uint8Array` values over the isolated preload bridge only for in-memory sources; file URI sources are copied by Electron main. Main validates storage requests, owns `kv.sqlite`, `replica.sqlite`, and the attachment directory, enforces a 32 MiB attachment limit, and writes only inside its owned paths. Renderer code never receives Node.js access.

Composer drafts store text, ordered attachment metadata, status, and update time in KV; they never embed base64. Owned image, audio, file, pasted-text, and appshot bytes live in `AttachmentStore`. Browser tabs and MCP resources keep recoverable references and visible degraded or unavailable state, while selected text and bounded app context remain self-contained. Recovery uses `AttachmentStore.stat()` so it does not read a large file merely to validate it. Missing bytes block submission until the attachment is removed or reattached. Draft cleanup is bounded and drives attachment garbage collection.

Attachment inspection returns paginated keys, sizes, and at most the first 32 bytes. File adapters read only that prefix; the Web adapter keeps the prefix in its metadata object store so listing never materializes complete blobs.

## Validation and security

Storage adapters validate identifiers and storage types, but domain owners must validate deserialized replica payloads and attachment metadata. Client replicas and browser storage are ordinary local application data: they are not encrypted secret storage and must not be trusted as authority after reconnecting to the Server.

Electron keeps context isolation and sandboxing enabled. Its attachment IPC accepts only declared, schema-validated operations; file URI copying is limited to the attachment store's managed destination and size limit. Protocol-visible or shared state still crosses the normal Zod-validated client/server boundary.
