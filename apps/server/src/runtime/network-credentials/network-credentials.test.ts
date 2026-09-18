import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createSafeStorageNetworkCredentialStore, NetworkCredentialStoreError } from "./index.js"

const createProtector = (available = true) => ({
  decryptString: (encrypted: Uint8Array) =>
    Buffer.from(Buffer.from(encrypted).toString("utf8"), "base64").toString("utf8"),
  encryptString: (plainText: string) =>
    Buffer.from(Buffer.from(plainText, "utf8").toString("base64"), "utf8"),
  isEncryptionAvailable: () => available,
})

describe("network credential store", () => {
  it("stores only protected connection material in owner-only files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-network-credentials-"))
    const store = createSafeStorageNetworkCredentialStore({
      directory,
      protector: createProtector(),
    })
    await store.put(
      "network_credential_primary",
      { url: "https://rpc.example/project-key", headers: { Authorization: "Bearer secret" } },
      "http"
    )
    await expect(store.get("network_credential_primary")).resolves.toEqual({
      url: "https://rpc.example/project-key",
      headers: { Authorization: "Bearer secret" },
    })

    const file = join(directory, "network_credential_primary.bin")
    expect((await readFile(file, "utf8")).includes("Bearer secret")).toBe(false)
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600)

    await store.delete("network_credential_primary")
    await expect(store.get("network_credential_primary")).resolves.toBeUndefined()
  })

  it("fails closed without OS-backed encryption", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-network-credentials-"))
    const store = createSafeStorageNetworkCredentialStore({
      directory,
      protector: createProtector(false),
    })
    await expect(store.get("network_credential_primary")).rejects.toBeInstanceOf(
      NetworkCredentialStoreError
    )
  })
})
