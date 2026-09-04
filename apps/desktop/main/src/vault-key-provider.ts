import { join } from "node:path"

import {
  createSafeStorageVaultMasterKeyProvider,
  type VaultMasterKeyProvider,
} from "@cypheria/runtime"
import { safeStorage } from "electron"

export const createDesktopVaultMasterKeyProvider = (configDir: string): VaultMasterKeyProvider =>
  createSafeStorageVaultMasterKeyProvider({
    keyFile: join(configDir, "wallet-master-key.bin"),
    protector: {
      decryptString: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted)),
      encryptString: (plainText) => safeStorage.encryptString(plainText),
      isEncryptionAvailable: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    },
  })
