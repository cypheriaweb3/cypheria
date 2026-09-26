import { describe, expect, it } from "vitest"

import {
  appConfigOpenContract,
  appGitFileActionContract,
  browserSessionOpenContract,
  clientSettingDefinitions,
  composerDraftKey,
  dappProviderRequestContract,
  ipcContracts,
  panelLayoutKey,
  storageAttachmentCopyFileContract,
  storageAttachmentWriteContract,
  storageKeyValueSetContract,
  storageReplicaApplyContract,
} from "./index.js"

describe("desktop IPC contracts", () => {
  it("only exposes Electron-owned routes", () => {
    expect(Object.keys(ipcContracts).sort()).toEqual([
      "appConfigOpen",
      "appDirectoryPick",
      "appExternalOpen",
      "appGitFileAction",
      "appHealthCheck",
      "appMetadataRead",
      "appProjectOpen",
      "appProjectReveal",
      "appSoundPick",
      "browserSessionOpen",
      "dappProviderRequest",
      "settingsAppearanceFontsList",
      "settingsNotificationSoundPreview",
      "settingsNotificationSoundsList",
      "settingsOpenTargetsList",
      "storageAttachmentCopyFile",
      "storageAttachmentDelete",
      "storageAttachmentList",
      "storageAttachmentListPage",
      "storageAttachmentRead",
      "storageAttachmentStat",
      "storageAttachmentWrite",
      "storageKeyValueGet",
      "storageKeyValueListPage",
      "storageKeyValueRemove",
      "storageKeyValueSet",
      "storageReplicaApply",
      "storageReplicaClear",
      "storageReplicaDeleteScope",
      "storageReplicaListPage",
      "storageReplicaOpen",
      "storageReplicaRead",
      "storageReplicaReadAll",
      "storageReplicaRenameScope",
    ])
  })

  it("validates bounded key/value and replica writes", () => {
    expect(
      storageKeyValueSetContract.request.parse({
        key: "appearance",
        value: JSON.stringify({ theme: "dark" }),
      })
    ).toMatchObject({ key: "appearance" })
    expect(() => storageKeyValueSetContract.request.parse({ key: "", value: "dark" })).toThrow()

    expect(
      storageReplicaApplyContract.request.parse({
        deletes: [{ scopeId: "workspace-a", entityType: "thread", entityId: "old" }],
        upserts: [
          {
            scopeId: "workspace-a",
            entityType: "thread",
            entityId: "new",
            payload: JSON.stringify({ title: "New" }),
          },
        ],
      })
    ).toMatchObject({ upserts: [{ entityId: "new" }] })
    expect(() =>
      storageReplicaApplyContract.request.parse({
        deletes: [],
        upserts: [{ scopeId: "", entityType: "thread", entityId: "new", payload: "{}" }],
      })
    ).toThrow()
  })

  it("accepts bounded attachment bytes and rejects unsafe storage keys", () => {
    expect(
      storageAttachmentWriteContract.request.parse({
        storageKey: "att_01ABC_xyz",
        bytes: new Uint8Array([1, 2, 3]),
      })
    ).toMatchObject({ storageKey: "att_01ABC_xyz" })
    expect(() =>
      storageAttachmentWriteContract.request.parse({
        storageKey: "../escape",
        bytes: new Uint8Array([1]),
      })
    ).toThrow()
    expect(() =>
      storageAttachmentWriteContract.request.parse({
        storageKey: "att_empty",
        bytes: new Uint8Array(),
      })
    ).toThrow()
  })

  it("accepts file URI copy requests without carrying attachment bytes", () => {
    expect(
      storageAttachmentCopyFileContract.request.parse({
        storageKey: "att_file",
        uri: "file:///tmp/report.pdf",
      })
    ).toEqual({ storageKey: "att_file", uri: "file:///tmp/report.pdf" })
    expect(() =>
      storageAttachmentCopyFileContract.request.parse({ storageKey: "../escape", uri: "/tmp/a" })
    ).toThrow()
  })

  it("validates desktop path actions", () => {
    expect(appConfigOpenContract.request.parse({})).toEqual({})
    expect(
      appGitFileActionContract.request.parse({
        action: "open",
        cwd: "/workspace",
        path: "src/index.ts",
      })
    ).toEqual({ action: "open", cwd: "/workspace", path: "src/index.ts" })
    expect(() =>
      appGitFileActionContract.request.parse({
        action: "delete",
        cwd: "/workspace",
        path: "src/index.ts",
      })
    ).toThrow()
  })

  it("defines every client setting as a valid version 1 value", () => {
    for (const [name, definition] of Object.entries(clientSettingDefinitions)) {
      expect(definition.version, name).toBe(1)
      expect(definition.key, name).not.toMatch(/^(cypheria|client|desktop)[.:]/u)
      expect(definition.schema.safeParse(definition.defaultValue), name).toMatchObject({
        success: true,
      })
    }
  })

  it("uses scoped semantic keys for drafts and panel checkpoints", () => {
    expect(composerDraftKey("thread-1")).toBe("composerDraft:thread-1")
    expect(panelLayoutKey("thread-1")).toBe("panelLayout:thread-1")
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
