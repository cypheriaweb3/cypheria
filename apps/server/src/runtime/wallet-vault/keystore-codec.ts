import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

import {
  decryptKeystoreJson,
  encryptKeystoreJson,
  HDNodeWallet,
  isKeystoreJson,
  Mnemonic,
  Wallet,
} from "ethers"
import { z } from "zod"

const privateKeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/u)
const entropySchema = z
  .string()
  .regex(/^0x(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{48}|[a-fA-F0-9]{56}|[a-fA-F0-9]{64})$/u)

export const vaultSecretSchema = z.discriminatedUnion("kind", [
  z
    .object({
      entropy: entropySchema,
      kind: z.literal("hd"),
      passphrase: z.string().min(1).max(1024).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("private-key"),
      privateKey: privateKeySchema,
    })
    .strict(),
])

export type VaultSecret = z.infer<typeof vaultSecretSchema>

const sealedValueSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    ciphertext: z.string().regex(/^[a-f0-9]*$/u),
    iv: z.string().regex(/^[a-f0-9]{24}$/u),
    tag: z.string().regex(/^[a-f0-9]{32}$/u),
  })
  .strict()

export type SealedValue = z.infer<typeof sealedValueSchema>

export type EncodedVaultSecret = {
  readonly keystore: Readonly<Record<string, unknown>>
  readonly sealedPassphrase?: SealedValue
}

export type WalletKeystoreCodec = {
  readonly decode: (
    kind: VaultSecret["kind"],
    encoded: EncodedVaultSecret,
    entryKey: Uint8Array
  ) => Promise<VaultSecret>
  readonly encode: (secret: VaultSecret, entryKey: Uint8Array) => Promise<EncodedVaultSecret>
}

export type WalletKeystoreCodecOptions = {
  readonly scryptN?: number
}

const EVM_PROBE_PATH = "m/44'/60'/0'/0/0"
const PASSPHRASE_INFO = Buffer.from("cypheria:vault:hd-passphrase:v1")

const derivePassphraseKey = (entryKey: Uint8Array): Buffer =>
  Buffer.from(hkdfSync("sha256", entryKey, new Uint8Array(), PASSPHRASE_INFO, 32))

const sealPassphrase = (passphrase: string, entryKey: Uint8Array): SealedValue => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", derivePassphraseKey(entryKey), iv)
  const ciphertext = Buffer.concat([cipher.update(passphrase, "utf8"), cipher.final()])
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  }
}

const openPassphrase = (sealed: SealedValue, entryKey: Uint8Array): string => {
  const parsed = sealedValueSchema.parse(sealed)
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derivePassphraseKey(entryKey),
    Buffer.from(parsed.iv, "hex")
  )
  decipher.setAuthTag(Buffer.from(parsed.tag, "hex"))
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8")
}

const parseKeystore = (value: Readonly<Record<string, unknown>>): string => {
  const json = JSON.stringify(value)
  if (!isKeystoreJson(json)) {
    throw new Error("Invalid Web3 Secret Storage payload.")
  }
  return json
}

export const createWalletKeystoreCodec = (
  options: WalletKeystoreCodecOptions = {}
): WalletKeystoreCodec => ({
  decode: async (kind, encoded, entryKey) => {
    const account = await decryptKeystoreJson(parseKeystore(encoded.keystore), entryKey)
    if (kind === "private-key") {
      return vaultSecretSchema.parse({ kind, privateKey: account.privateKey })
    }

    if (!account.mnemonic) {
      throw new Error("HD keystore does not contain mnemonic entropy.")
    }
    const passphrase = encoded.sealedPassphrase
      ? openPassphrase(encoded.sealedPassphrase, entryKey)
      : undefined
    const mnemonic = Mnemonic.fromEntropy(account.mnemonic.entropy, passphrase ?? "")
    const derived = HDNodeWallet.fromMnemonic(mnemonic, account.mnemonic.path ?? EVM_PROBE_PATH)
    if (derived.privateKey.toLowerCase() !== account.privateKey.toLowerCase()) {
      throw new Error("HD keystore passphrase validation failed.")
    }

    return vaultSecretSchema.parse({
      entropy: account.mnemonic.entropy,
      kind,
      ...(passphrase === undefined ? {} : { passphrase }),
    })
  },
  encode: async (secretValue, entryKey) => {
    const secret = vaultSecretSchema.parse(secretValue)
    const account =
      secret.kind === "private-key"
        ? new Wallet(secret.privateKey)
        : HDNodeWallet.fromMnemonic(
            Mnemonic.fromEntropy(secret.entropy, secret.passphrase ?? ""),
            EVM_PROBE_PATH
          )
    const keystoreJson = await encryptKeystoreJson(
      {
        address: account.address,
        privateKey: account.privateKey,
        ...(secret.kind === "hd"
          ? {
              mnemonic: {
                entropy: secret.entropy,
                locale: "en",
                path: EVM_PROBE_PATH,
              },
            }
          : {}),
      },
      entryKey,
      options.scryptN === undefined ? undefined : { scrypt: { N: options.scryptN } }
    )

    return {
      keystore: JSON.parse(keystoreJson) as Record<string, unknown>,
      ...(secret.kind === "hd" && secret.passphrase
        ? { sealedPassphrase: sealPassphrase(secret.passphrase, entryKey) }
        : {}),
    }
  },
})
