import { randomUUID } from "node:crypto"
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises"
import { resolve } from "node:path"

import {
  exportPublicKey,
  exportSecretKey,
  generateKeyPair,
  importPublicKey,
  importSecretKey,
  type KeyPair,
  keyPairFromSecretKey,
} from "@cypheria/relay"
import { z } from "zod"

const RELAY_KEY_FILENAME = "relay-key.json"
const RelayKeyFileSchema = z.strictObject({
  publicKeyB64: z.string(),
  secretKeyB64: z.string(),
  v: z.literal(1),
})

export async function loadOrCreateRelayKeyPair(configDir: string): Promise<KeyPair> {
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  await chmod(configDir, 0o700)
  const path = resolve(configDir, RELAY_KEY_FILENAME)
  try {
    return await readStoredKeyPair(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const keyPair = generateKeyPair()
  const encoded = `${JSON.stringify({
    publicKeyB64: exportPublicKey(keyPair.publicKey),
    secretKeyB64: exportSecretKey(keyPair.secretKey),
    v: 1,
  })}\n`
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const file = await open(temporaryPath, "wx", 0o600)
    try {
      await file.writeFile(encoded)
      await file.sync()
    } finally {
      await file.close()
    }
    await link(temporaryPath, path)
    return keyPair
  } catch (error) {
    keyPair.secretKey.fill(0)
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    return readStoredKeyPair(path)
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
  }
}

async function readStoredKeyPair(path: string): Promise<KeyPair> {
  await chmod(path, 0o600)
  return decodeStoredKeyPair(JSON.parse(await readFile(path, "utf8")))
}

function decodeStoredKeyPair(input: unknown): KeyPair {
  const value = RelayKeyFileSchema.parse(input)
  const storedPublicKey = importPublicKey(value.publicKeyB64)
  const keyPair = keyPairFromSecretKey(importSecretKey(value.secretKeyB64))
  if (!storedPublicKey.every((byte, index) => byte === keyPair.publicKey[index])) {
    keyPair.secretKey.fill(0)
    throw new Error("Relay key file contains mismatched public and private keys")
  }
  return keyPair
}
