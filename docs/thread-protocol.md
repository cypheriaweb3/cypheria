# Thread Protocol

Cypheria's public agent protocol uses two product entities: an `Agent` is an installable and
startable execution backend, while a `Thread` is a durable user-visible conversation and working
context. A provider session is an internal server implementation detail. `threadId` is therefore the
only public handle for thread operations. `Thread.agentSessionId` is optional, read-only provider
metadata and is never accepted as a routing key.

Agent lifecycle uses `agent.list`, `agent.get`, `agent.start`, and `agent.stop`. Thread lifecycle and
work use the `thread.*` namespace, including create, get, list, resume, close, turns, timeline,
interactions, and deletion. Provider-specific methods are classified as server-internal,
provider-neutral thread operations, typed agent extensions, typed thread extensions, or unsupported.
Raw provider lifecycle and subscription calls are not part of the target wire API.

## Timeline continuity

Only committed canonical timeline rows carry an epoch and sequence number. Agent state, thread
state, active turns, permissions, attention, and installation progress are snapshots or transient
notifications and do not participate in timeline ordering.

Within one epoch, canonical rows receive contiguous sequence numbers. Projected pages fold message,
reasoning, and tool lifecycle rows at read time while retaining their exact source sequence ranges.
The shared protocol projector is deterministic so server and clients agree on cursor coverage.

A new epoch is created when provider history is rebuilt, replaced, or found to have an unrecoverable
gap. Normal turns, cancellation, metadata updates, and file-only changes keep the current epoch. A
replacement sends one invalidation notification instead of replaying the full transcript. Clients
then fetch a bounded tail page and use before/after cursors for history and gap recovery.

Provider history remains the durable transcript authority in V1. The server keeps canonical rows in
memory for loaded threads and hydrates them from the provider after restart or cache eviction.
