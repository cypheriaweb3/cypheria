import { describe, expect, it, vi } from "vitest"

import {
  installThirdPartyCookieFilter,
  isThirdPartyRequest,
  siteOf,
} from "./third-party-cookies.js"

describe("dApp third-party cookie filter", () => {
  it("compares registrable domains, treating private suffixes as public", () => {
    expect(siteOf("https://app.uniswap.org/swap")).toBe("uniswap.org")
    expect(siteOf("https://a.github.io/")).toBe("a.github.io")
    expect(siteOf("wss://relay.walletconnect.com")).toBe("walletconnect.com")
    expect(siteOf("http://localhost:3000")).toBe("localhost")
    expect(siteOf("file:///etc/passwd")).toBeNull()
  })

  it("classifies requests against the top-level document", () => {
    const top = "https://app.uniswap.org/swap"
    expect(
      isThirdPartyRequest({
        resourceType: "xhr",
        topLevelUrl: top,
        url: "https://api.uniswap.org/q",
      })
    ).toBe(false)
    expect(
      isThirdPartyRequest({
        resourceType: "script",
        topLevelUrl: top,
        url: "https://tracker.test/t.js",
      })
    ).toBe(true)
    expect(
      isThirdPartyRequest({
        resourceType: "subFrame",
        topLevelUrl: "https://a.github.io/",
        url: "https://b.github.io/",
      })
    ).toBe(true)
    expect(
      isThirdPartyRequest({
        resourceType: "mainFrame",
        topLevelUrl: top,
        url: "https://other.test/",
      })
    ).toBe(false)
    expect(
      isThirdPartyRequest({ referrer: top, resourceType: "xhr", url: "https://tracker.test/p" })
    ).toBe(true)
    expect(isThirdPartyRequest({ resourceType: "xhr", url: "https://tracker.test/p" })).toBe(false)
  })

  it("strips cookies only from cross-site traffic", () => {
    let beforeSend: Parameters<
      Parameters<typeof installThirdPartyCookieFilter>[0]["webRequest"]["onBeforeSendHeaders"]
    >[0] = () => undefined
    let received: Parameters<
      Parameters<typeof installThirdPartyCookieFilter>[0]["webRequest"]["onHeadersReceived"]
    >[0] = () => undefined
    installThirdPartyCookieFilter({
      webRequest: {
        onBeforeSendHeaders: (listener) => {
          beforeSend = listener
        },
        onHeadersReceived: (listener) => {
          received = listener
        },
      },
    })
    const webContents = { getURL: () => "https://app.example/", isDestroyed: () => false }
    const sendCallback = vi.fn()
    beforeSend(
      {
        referrer: "",
        requestHeaders: { Accept: "*/*", Cookie: "id=1" },
        resourceType: "image",
        url: "https://tracker.test/pixel",
        webContents,
      } as never,
      sendCallback
    )
    expect(sendCallback).toHaveBeenCalledWith({ requestHeaders: { Accept: "*/*" } })

    const receiveCallback = vi.fn()
    received(
      {
        referrer: "",
        resourceType: "xhr",
        responseHeaders: { "set-cookie": ["id=1"], "content-type": ["text/plain"] },
        url: "https://api.app.example/data",
        webContents,
      } as never,
      receiveCallback
    )
    expect(receiveCallback).toHaveBeenCalledWith({})
    received(
      {
        referrer: "",
        resourceType: "xhr",
        responseHeaders: { "Set-Cookie": ["id=1"], "content-type": ["text/plain"] },
        url: "https://tracker.test/data",
        webContents,
      } as never,
      receiveCallback
    )
    expect(receiveCallback).toHaveBeenLastCalledWith({
      responseHeaders: { "content-type": ["text/plain"] },
    })
  })
})
