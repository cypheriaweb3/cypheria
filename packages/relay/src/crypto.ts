import { fromByteArray, toByteArray } from "base64-js"
import nacl from "tweetnacl"

export interface KeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export type SharedKey = Uint8Array
export type DirectionalKeys = {
  clientToServer: SharedKey
  serverToClient: SharedKey
}

const NONCE_LENGTH = nacl.box.nonceLength
const ZERO_SHARED_RESULT = new Uint8Array(nacl.box.sharedKeyLength)
let prngReady = false

const ensurePrng = (): void => {
  if (prngReady) return
  try {
    nacl.randomBytes(1)
    prngReady = true
    return
  } catch {
    // Fall through to the Web Crypto adapter.
  }
  if (!globalThis.crypto?.getRandomValues) throw new Error("No secure random source is available")
  nacl.setPRNG((target, length) => {
    const random = new Uint8Array(length)
    globalThis.crypto.getRandomValues(random)
    target.set(random)
  })
  prngReady = true
}

const decodePublicKey = (value: string): Uint8Array => {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error("Invalid public key encoding")
  }
  const bytes = toByteArray(value)
  if (fromByteArray(bytes) !== value) throw new Error("Invalid public key encoding")
  return bytes
}

const copyArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const result = new Uint8Array(bytes.byteLength)
  result.set(bytes)
  return result.buffer
}

export const generateKeyPair = (): KeyPair => {
  ensurePrng()
  return nacl.box.keyPair()
}

export const exportPublicKey = (publicKey: Uint8Array): string => {
  if (publicKey.byteLength !== nacl.box.publicKeyLength) {
    throw new Error(`Invalid public key length (expected ${nacl.box.publicKeyLength})`)
  }
  return fromByteArray(publicKey)
}

export const importPublicKey = (base64: string): Uint8Array => {
  const bytes = decodePublicKey(base64)
  if (bytes.byteLength !== nacl.box.publicKeyLength) {
    throw new Error(`Invalid public key length (expected ${nacl.box.publicKeyLength})`)
  }
  return bytes
}

export const exportSecretKey = (secretKey: Uint8Array): string => {
  if (secretKey.byteLength !== nacl.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${nacl.box.secretKeyLength})`)
  }
  return fromByteArray(secretKey)
}

export const importSecretKey = (base64: string): Uint8Array => {
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)
  ) {
    throw new Error("Invalid secret key encoding")
  }
  const bytes = toByteArray(base64)
  if (fromByteArray(bytes) !== base64) throw new Error("Invalid secret key encoding")
  if (bytes.byteLength !== nacl.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${nacl.box.secretKeyLength})`)
  }
  return bytes
}

export const keyPairFromSecretKey = (secretKey: Uint8Array): KeyPair => {
  if (secretKey.byteLength !== nacl.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${nacl.box.secretKeyLength})`)
  }
  const copy = secretKey.slice()
  return nacl.box.keyPair.fromSecretKey(copy)
}

export const deriveSharedKey = (ourSecretKey: Uint8Array, peerPublicKey: Uint8Array): SharedKey => {
  if (ourSecretKey.byteLength !== nacl.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${nacl.box.secretKeyLength})`)
  }
  if (peerPublicKey.byteLength !== nacl.box.publicKeyLength) {
    throw new Error(`Invalid peer public key length (expected ${nacl.box.publicKeyLength})`)
  }
  const rawSharedResult = nacl.scalarMult(ourSecretKey, peerPublicKey)
  const invalid = nacl.verify(rawSharedResult, ZERO_SHARED_RESULT)
  rawSharedResult.fill(0)
  if (invalid) throw new Error("Invalid peer public key")
  return nacl.box.before(peerPublicKey, ourSecretKey)
}

const deriveSubkey = (sharedKey: SharedKey, label: string): SharedKey => {
  if (sharedKey.byteLength !== nacl.box.sharedKeyLength) {
    throw new Error(`Invalid shared key length (expected ${nacl.box.sharedKeyLength})`)
  }
  const domain = new TextEncoder().encode(`cypheria-relay-v2:${label}\0`)
  const input = new Uint8Array(domain.byteLength + sharedKey.byteLength)
  input.set(domain)
  input.set(sharedKey, domain.byteLength)
  const digest = nacl.hash(input)
  const key = digest.slice(0, nacl.box.sharedKeyLength)
  digest.fill(0)
  input.fill(0)
  return key
}

export const deriveDirectionalKeys = (sharedKey: SharedKey): DirectionalKeys => ({
  clientToServer: deriveSubkey(sharedKey, "client-to-server"),
  serverToClient: deriveSubkey(sharedKey, "server-to-client"),
})

export const encrypt = (sharedKey: SharedKey, data: string | ArrayBuffer): ArrayBuffer => {
  ensurePrng()
  const nonce = nacl.randomBytes(NONCE_LENGTH)
  const plaintext = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data)
  const ciphertext = nacl.box.after(plaintext, nonce, sharedKey)
  const bundle = new Uint8Array(nonce.byteLength + ciphertext.byteLength)
  bundle.set(nonce)
  bundle.set(ciphertext, nonce.byteLength)
  return copyArrayBuffer(bundle)
}

export const decrypt = (sharedKey: SharedKey, data: ArrayBuffer): ArrayBuffer => {
  const bytes = new Uint8Array(data)
  if (bytes.byteLength < NONCE_LENGTH) throw new Error("Ciphertext bundle too short")
  const plaintext = nacl.box.open.after(
    bytes.slice(NONCE_LENGTH),
    bytes.slice(0, NONCE_LENGTH),
    sharedKey
  )
  if (!plaintext) throw new Error("Decryption failed")
  return copyArrayBuffer(plaintext)
}
