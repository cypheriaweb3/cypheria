import type { ClientStorage } from "@cypheria/storage"
import { createFileAttachmentStore } from "@cypheria/storage/files"
import { createIndexedDbReplicaStore, createWebKeyValueStorage } from "@cypheria/storage/web"

const requireAttachmentBridge = () => {
  const bridge = globalThis.window?.cypheria?.storage.attachments
  if (!bridge) throw new Error("Desktop attachment storage is unavailable outside Electron.")
  return bridge
}

export const desktopClientStorage: ClientStorage = {
  keyValue: createWebKeyValueStorage(),
  replica: createIndexedDbReplicaStore({
    databaseName: "cypheria-desktop-replica",
    schemaVersion: 1,
  }),
  attachments: createFileAttachmentStore("desktop-file", {
    async write(storageKey, bytes) {
      await requireAttachmentBridge().write(storageKey, bytes)
    },
    async read(storageKey) {
      const result = await requireAttachmentBridge().read(storageKey)
      return result.bytes
    },
    async delete(storageKey) {
      await requireAttachmentBridge().delete(storageKey)
    },
    async list() {
      const result = await requireAttachmentBridge().list()
      return result.storageKeys
    },
  }),
}

export const openDesktopClientStorage = async (): Promise<ClientStorage> => {
  await desktopClientStorage.replica.open()
  return desktopClientStorage
}
