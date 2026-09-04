import { join } from "node:path"
import {
  createSafeStorageNetworkCredentialStore,
  type NetworkCredentialStore,
} from "@cypheria/runtime"
import { safeStorage } from "electron"

/** Creates the main-process-only store used to resolve protected RPC connections. */
export const createDesktopNetworkCredentialStore = (configDir: string): NetworkCredentialStore =>
  createSafeStorageNetworkCredentialStore({
    directory: join(configDir, "network-credentials"),
    protector: {
      decryptString: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted)),
      encryptString: (plainText) => safeStorage.encryptString(plainText),
      isEncryptionAvailable: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    },
  })
