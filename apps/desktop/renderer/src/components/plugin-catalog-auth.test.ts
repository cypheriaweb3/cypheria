import { describe, expect, it } from "vitest"
import { isRemotePluginCatalogAuthError } from "./plugin-catalog-auth"

describe("plugin catalog authentication errors", () => {
  it("recognizes the App Server ChatGPT requirement without hiding unrelated failures", () => {
    expect(
      isRemotePluginCatalogAuthError({
        message:
          "Codex app-server request failed (-32600): list remote plugin catalog: chatgpt authentication required for remote plugin catalog; api key auth is not supported",
        path: "catalog:app-server",
      })
    ).toBe(true)
    expect(
      isRemotePluginCatalogAuthError({
        message: "Remote plugin catalog request failed with status 401 Unauthorized",
        path: "marketplace:team",
      })
    ).toBe(false)
    expect(
      isRemotePluginCatalogAuthError({
        message: "Could not parse local marketplace manifest",
        path: "source:local",
      })
    ).toBe(false)
  })
})
