import type { ClientStorage } from "@cypheria/storage"
import {
  createIndexedDbAttachmentStore,
  createIndexedDbReplicaStore,
  createWebKeyValueStorage,
} from "@cypheria/storage/web"

export const clientStorage: ClientStorage = {
  keyValue: createWebKeyValueStorage(),
  replica: createIndexedDbReplicaStore({
    databaseName: "cypheria-expo-web-replica",
    schemaVersion: 1,
  }),
  attachments: createIndexedDbAttachmentStore({
    databaseName: "cypheria-expo-web-attachments",
  }),
}

export const openClientStorage = async (): Promise<ClientStorage> => {
  await clientStorage.replica.open()
  return clientStorage
}
