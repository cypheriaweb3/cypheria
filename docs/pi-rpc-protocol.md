# Pi RPC Protocol

Cypheria pins `@earendil-works/pi-coding-agent@0.85.1` and envelopes the complete
[`pi --mode rpc` protocol](https://pi.dev/docs/latest/rpc) inside the existing logical WebSocket
`session` message. The server-side process adapter is intentionally not implemented yet.

## Boundary

Pi's native protocol is strict JSONL over a child process's stdin/stdout. Cypheria preserves the
native command, response, event, and extension UI payloads, but replaces its generic wire
discriminators with routable logical message types:

```text
Pi command { type: "get_state", id }
  <-> { type: "agent.pi.state.get.request", requestId }

Pi response { type: "response", command: "get_state", id, success, data/error }
  <-> { type: "agent.pi.state.get.response", payload: { requestId, result/error } }

Pi event { type: "message_update", ... }
  <-> { type: "agent.pi.message.update.notification", payload: <exact Pi event> }
```

`AGENT_PI_RPC` contains all 33 command pairs: prompting and queues; session state; model and thinking
selection; queue modes; compaction and retry; bash execution; session statistics, export, switching,
forking, cloning, entries, tree, naming, messages, and commands. Its keys are the native Pi command
names, and each definition contains the native command plus its Cypheria request/response types and
Zod schemas. A mapped `satisfies Record<RpcCommand["type"], ...>` check makes a Pi command addition or
removal fail typechecking until the registry is updated.

Pi session events retain their exact typed value in `payload`, while 23 concrete top-level
notification types expose their native event discriminator. `extension_error` has its own
notification. This preserves provider data without forcing consumers to inspect one generic event
message before routing it.

## Extension UI

Pi emits every extension UI operation as `extension_ui_request`, but only `select`, `confirm`,
`input`, and `editor` wait for input. Cypheria represents those four as server-to-client requests
paired with client-to-server responses. `notify`, `setStatus`, `setWidget`, `setTitle`, and
`set_editor_text` are server notifications. The original Pi object remains in `payload`; validation
requires its `id` to equal the Cypheria `requestId` and its method to match the concrete envelope.

The protocol exports conversion helpers for the future server adapter:

- `unwrapPiRpcCommand()` creates the exact JSONL command written to Pi stdin;
- `wrapPiRpcResponse()` creates the paired logical response from Pi stdout;
- `wrapPiServerEvent()` envelopes native events and extension UI output;
- `unwrapPiExtensionUIResponse()` restores the exact response written to Pi stdin.

## Thread Adapter

The server owns one `pi --mode rpc` process per Thread. It converts Thread prompts and cancellation
to Pi commands, maps native events to canonical timeline rows, and turns blocking extension UI into
typed Thread interactions. Pi commands remain an internal validated catalog; the public client uses
`thread.*`. Official Pi types remain available through the type-only
`@cypheria/protocol/pi-types` entry.
