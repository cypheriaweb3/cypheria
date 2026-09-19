# Relay

`apps/relay` is an optional Go data plane for remote Cypheria connections. It forwards opaque end-to-end encrypted WebSocket frames between a client and a user-controlled Server. `@cypheria/relay` owns pairing, channel encryption, and transport helpers used by the endpoints.

## Trust model

The relay authenticates routing roles and enforces admission, limits, and backpressure, but cannot decrypt application traffic. It does not store Projects, Threads, Timeline, credentials, or keys. Compromise of a relay must not reveal plaintext or allow ciphertext from one direction to be accepted in the other.

The authenticated Server endpoint creates `ConnectionOfferV2`, containing Server ID, X25519 public key, and public relay endpoint. The full offer is transferred out of band and acts as the pairing capability. A direct Server Bearer token is never included.

## Wire flow

The public endpoint is `/ws` with relay protocol `v=2`:

- a Server opens one control socket for its Server ID;
- a client opens a socket for that Server ID;
- the relay assigns a connection ID and notifies the control socket;
- the Server opens one data socket for that connection;
- endpoints complete `e2ee_hello` and `e2ee_ready`, then exchange encrypted Cypheria frames.

The relay validates handshake shape and frame limits without parsing plaintext. One remote client normally consumes two long-lived data-plane sockets, plus one control socket per connected Server.

## Encryption

Endpoints use X25519 key agreement and XSalsa20-Poly1305 authenticated encryption. Domain-separated client-to-Server and Server-to-client subkeys prevent reflection. Each encrypted bundle carries a 24-byte nonce, ciphertext, and 16-byte authenticator.

The channel rejects all-zero shared secrets, repeated hellos with different keys, invalid authentication, replayed nonces, plaintext application frames, and unbounded pre-handshake buffering. `e2ee_hello` and `e2ee_ready` remain small JSON text handshake frames; all encrypted Cypheria application frames are binary and carry CBOR plaintext. There is no ciphertext-format negotiation.

## Single-process mode

```sh
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single --public-addr=127.0.0.1:6770
```

Single mode runs gateway, worker hub, and in-memory coordination in one process. It uses no etcd and opens no internal listener. Deploy exactly one replica; multiple independent replicas behind one load balancer can split a Server control socket from its clients.

Use this mode for local development and small deployments where one failure domain and reconnect downtime are acceptable.

## Cluster mode

```text
public clients and Servers -> gateway replicas -> mTLS -> worker replicas
                                         \-> external etcd coordination
```

Cluster mode requires exactly one role per process:

- gateways accept public WebSockets, resolve ownership in etcd, and proxy to workers over mTLS;
- workers register leased stable node identities, own socket pairs, and forward frames.

etcd contains regional ownership metadata only. Node and owner records use leases; a worker self-fences when it cannot renew. Rendezvous hashing selects a live owner when no valid owner exists. Payloads and pairing secrets never enter etcd.

## Configuration and deployment

TOML examples are in `apps/relay/config`. Environment variables can override deployment-specific values. Kubernetes Kustomize resources in `apps/relay/deploy/kustomize/base` provide gateway and worker deployments, services, probes, topology spreading, resources, and disruption budgets.

The base intentionally does not install etcd, an OpenTelemetry Collector, certificate issuance, or public ingress. Production overlays must pin an immutable image, provide regional etcd and internal mTLS credentials, configure a TLS WebSocket ingress for gateways only, and keep workers private.

Outside Kubernetes, run the static binary or container under a process supervisor with an unprivileged account, read-only installation, adequate file descriptors, restart policy, and at least a 45-second graceful-stop window.

## Capacity and backpressure

Scale gateways by admission and new-connection rate. Scale workers by active sockets, memory, ingress and egress bytes, queue pressure, and slow-peer disconnects. CPU alone is not a safe worker autoscaling signal because scale-in drops owned sockets and relies on endpoint reconnection.

Per-connection queues and frame sizes are bounded. Slow or stalled peers are disconnected rather than allowing one connection to exhaust process memory.

## Observability

Both roles expose health and readiness and can export OpenTelemetry data over OTLP/gRPC. Required signals include admitted and rejected connections, active control/client/data sockets, handshake failures, queue depth, dropped frames, forwarded bytes, etcd lease health, ownership moves, proxy failures, and graceful-shutdown progress.

Telemetry must not include pairing offers, public keys beyond necessary fingerprints, ciphertext bodies, Server tokens, or application payloads.

## Verification

```sh
pnpm --filter @cypheria/cypheria-relay check
pnpm --filter @cypheria/cypheria-relay test
pnpm --filter @cypheria/cypheria-relay test:race
```

Protocol and encryption tests also live in `@cypheria/relay` and the Server relay integration tests.
