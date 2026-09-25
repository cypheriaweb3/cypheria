export * from "./attachment.js"
export * from "./key-value.js"
export * from "./replica.js"

import type { AttachmentStore } from "./attachment.js"
import type { KeyValueStorage } from "./key-value.js"
import type { ReplicaStore } from "./replica.js"

export interface ClientStorage {
  readonly keyValue: KeyValueStorage
  readonly replica: ReplicaStore
  readonly attachments: AttachmentStore
}
