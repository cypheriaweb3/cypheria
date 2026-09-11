# Client Package Guide

This package is the reusable TypeScript client for the versioned Cypheria server protocol.

## Boundaries

- Depend on `@cypheria/protocol`, never on runtime, server, Codex bridge, Electron, desktop, or SDK
  internals.
- Treat `ClientMessage` and `ServerMessage` as the capability source of truth.
- Represent each request/response pair as its own public async method. Keep generic correlation and
  method lookup inside `ServerClient` rather than exposing string-based RPC calls when the protocol
  already defines a concrete pair.
- Do not infer high-level wallet, policy, automation, browser, or other product APIs from generic
  runtime method strings. Add an action only after its request and response contract exists in the
  protocol package.
- Keep generated Codex types and validators owned by `@cypheria/protocol`.

## Layers

- `ServerClient` is the low-level protocol driver. It owns transport creation and cleanup, hello
  negotiation, connection state, reconnect policy, request correlation, timeouts, validation, and
  message subscriptions.
- `CypheriaApi` is a capability-only facade over an existing `ServerClient`. It must not expose
  `connect`, `ensureConnected`, `close`, or connection-state methods.
- `CypheriaClient` combines `CypheriaApi` with lifecycle control for callers that want an owned
  connection.
- `createCypheriaApi()` borrows its supplied `ServerClient`; it never disposes that connection.

## Transport And Reliability

- Keep `ServerClient` transport-neutral through `ServerTransport` and `ServerTransportFactory`.
- The WebSocket adapter must support browser event targets, Node event emitters, and injectable
  implementations.
- Validate every outbound and inbound wire message with `@cypheria/protocol`.
- Deliver incoming notifications and reverse requests through the typed
  `on(messageType, handler)` interface; retain the raw `on(handler)` and `subscribe(handler)` forms
  for consumers that need the complete server message stream.
- Reject in-flight requests on disconnect, isolate consumer listener failures, and prevent stale
  transport events from mutating the current connection.
- Reconnects must be bounded and cancellable by `close()`.

## Verification

Run at least:

```sh
pnpm --filter @cypheria/client test
pnpm --filter @cypheria/client typecheck
pnpm --filter @cypheria/client build
```

For package-boundary or public API changes, also run `pnpm run ci` and `pnpm build`, and update the
paired English and Chinese architecture/package documentation.
