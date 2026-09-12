import { describe, expect, it } from "vitest"
import {
  type ConnectionOfferV2,
  ConnectionOfferV2Schema,
  createConnectionOfferUrl,
  decodeConnectionOffer,
  encodeConnectionOffer,
  parseConnectionOffer,
} from "./relay.ts"

const offer: ConnectionOfferV2 = {
  relay: { endpoint: "relay.example.test/ws", useTls: true },
  serverId: "srv_test",
  serverPublicKeyB64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  v: 2,
}

describe("relay connection offers", () => {
  it("round-trips an encoded offer and pairing URL", () => {
    const encoded = encodeConnectionOffer(offer)
    expect(decodeConnectionOffer(encoded)).toEqual(offer)
    expect(parseConnectionOffer(createConnectionOfferUrl(offer))).toEqual(offer)
    expect(parseConnectionOffer(encoded)).toEqual(offer)
  })

  it("strips unknown fields and rejects unsupported versions", () => {
    expect(ConnectionOfferV2Schema.parse({ ...offer, extra: true })).toEqual(offer)
    expect(() => ConnectionOfferV2Schema.parse({ ...offer, v: 1 })).toThrow()
  })

  it("rejects non-Cypheria URLs", () => {
    expect(() => parseConnectionOffer("https://example.test/#offer=x")).toThrow(
      "must use cypheria://pair"
    )
  })
})
