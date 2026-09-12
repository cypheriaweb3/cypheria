# @cypheria/relay

Transport-neutral relay helpers and end-to-end encryption for Cypheria clients and servers.
The relay only forwards opaque WebSocket frames. X25519 establishes shared key material;
direction-separated XSalsa20-Poly1305 keys authenticate every application frame. Pairing offers are defined by
`@cypheria/protocol`; bearer tokens are never sent to a relay.

This package intentionally contains no Cloudflare adapter or deployment code.
