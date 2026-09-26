import type { ClientStorage, KeyValueStorage, ReplicaStore } from "@cypheria/storage"
import { createFileAttachmentStore } from "@cypheria/storage/files"

const requireStorageBridge = () => {
  const bridge = globalThis.window?.cypheria?.storage
  if (!bridge) throw new Error("Desktop client storage is unavailable outside Electron.")
  return bridge
}

const requireAttachmentBridge = () => {
  const bridge = requireStorageBridge().attachments
  if (!bridge) throw new Error("Desktop attachment storage is unavailable outside Electron.")
  return bridge
}

const keyValue: KeyValueStorage = {
  async getItem(key) {
    return (await requireStorageBridge().keyValue.getItem(key)).value
  },
  async setItem(key, value) {
    await requireStorageBridge().keyValue.setItem(key, value)
  },
  async removeItem(key) {
    await requireStorageBridge().keyValue.removeItem(key)
  },
  listPage(request = {}) {
    return requireStorageBridge().keyValue.listPage(request)
  },
  subscribe(key, listener) {
    return requireStorageBridge().keyValue.onChanged((change) => {
      if (change.key === key) listener(change.value)
    })
  },
}

const replica: ReplicaStore = {
  async open() {
    await requireStorageBridge().replica.open()
  },
  async read(scopeId, entityTypes, entityIds) {
    return (await requireStorageBridge().replica.read(scopeId, entityTypes, entityIds)).rows
  },
  async readAll() {
    return (await requireStorageBridge().replica.readAll()).scopes
  },
  listPage(request = {}) {
    return requireStorageBridge().replica.listPage(request)
  },
  async apply(changes) {
    await requireStorageBridge().replica.apply(changes)
  },
  async deleteScope(scopeId) {
    await requireStorageBridge().replica.deleteScope(scopeId)
  },
  async renameScope(oldScopeId, newScopeId) {
    await requireStorageBridge().replica.renameScope(oldScopeId, newScopeId)
  },
  async clear() {
    await requireStorageBridge().replica.clear()
  },
  async close() {
    // Electron main owns the shared database for the application lifetime.
  },
}

export const desktopClientStorage: ClientStorage = {
  keyValue,
  replica,
  attachments: createFileAttachmentStore("desktop-file", {
    async copyFileUri(storageKey, uri) {
      const result = await requireAttachmentBridge().copyFileUri(storageKey, uri)
      return result.byteSize
    },
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
    async listPage(request) {
      return requireAttachmentBridge().listPage(request ?? {})
    },
  }),
}

export const openDesktopClientStorage = async (): Promise<ClientStorage> => {
  await desktopClientStorage.replica.open()
  return desktopClientStorage
}
