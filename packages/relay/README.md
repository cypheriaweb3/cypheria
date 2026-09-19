# `@cypheria/relay`

Transport-neutral pairing, end-to-end encryption, and relay URL helpers for Cypheria clients and Servers.

## Responsibility

The package performs X25519 key agreement and uses direction-separated XSalsa20-Poly1305 keys for application frames. It validates pairing offers and handshake state, bounds pre-handshake queues, and adapts encrypted channels to the shared client transport.

Pairing offer types are owned by `@cypheria/protocol`. Server Bearer tokens are never sent to a relay.

## Boundary

This package contains no deployment, coordination, database, Agent, Electron, or product-state code. The Go data plane lives in `apps/relay` and forwards opaque frames only.

See [Relay](../../docs/relay.md).
