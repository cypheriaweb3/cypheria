import { describe, expect, it } from "vitest"

import {
  appConfigOpenContract,
  browserSessionOpenContract,
  ConnectionProxySettingsSchema,
  dappProviderRequestContract,
  ipcContracts,
} from "./index.js"

describe("desktop IPC contracts", () => {
  it("only exposes Electron-owned routes", () => {
    expect(Object.keys(ipcContracts).sort()).toEqual([
      "appConfigOpen",
      "appDirectoryPick",
      "appExternalOpen",
      "appHealthCheck",
      "appMetadataRead",
      "appProjectReveal",
      "browserSessionOpen",
      "dappProviderRequest",
      "settingsAppearanceFontsList",
      "settingsAppearanceRead",
      "settingsAppearanceWrite",
      "settingsConnectionProxyRead",
      "settingsConnectionProxyTest",
      "settingsConnectionProxyWrite",
      "settingsLanguageRead",
      "settingsLanguageWrite",
      "settingsWorkspaceLayoutRead",
      "settingsWorkspaceLayoutWrite",
    ])
  })

  it("validates desktop path and proxy settings", () => {
    expect(appConfigOpenContract.request.parse({})).toEqual({})
    expect(
      ConnectionProxySettingsSchema.parse({
        bypass: "localhost, example.test",
        host: "127.0.0.1",
        mode: "manual",
        password: "secret",
        port: 7890,
        protocol: "socks5",
        username: "proxy-user",
      })
    ).toMatchObject({ mode: "manual", port: 7890, protocol: "socks5" })
  })

  it("keeps dApp WebContents traffic origin-scoped", () => {
    expect(browserSessionOpenContract.request.parse({ url: "https://app.example/path" })).toEqual({
      url: "https://app.example/path",
    })
    expect(() =>
      browserSessionOpenContract.request.parse({ url: "http://app.example/path" })
    ).toThrow()
    expect(
      dappProviderRequestContract.request.parse({
        id: "provider_1",
        method: "personal_sign",
        origin: "https://app.example",
        params: ["hello", "0x0000000000000000000000000000000000000001"],
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toMatchObject({ method: "personal_sign", origin: "https://app.example" })
    expect(() =>
      dappProviderRequestContract.request.parse({
        id: "provider_2",
        method: "personal_sign",
        origin: "https://app.example",
        params: [1n],
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toThrow()
  })
})
