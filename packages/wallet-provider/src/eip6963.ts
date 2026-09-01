import type { Eip1193Provider } from "./ethereum.js"

export const EIP6963_ANNOUNCE_PROVIDER_EVENT = "eip6963:announceProvider" as const
export const EIP6963_REQUEST_PROVIDER_EVENT = "eip6963:requestProvider" as const

export type Eip6963ProviderInfo = {
  readonly icon: `data:image/${string}`
  readonly name: string
  readonly rdns: string
  readonly uuid: string
}
export type Eip6963ProviderDetail = {
  readonly info: Eip6963ProviderInfo
  readonly provider: Eip1193Provider
}
export type Eip6963EventTarget = Pick<
  Window,
  "addEventListener" | "dispatchEvent" | "removeEventListener"
>

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RDNS = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const SAFE_IMAGE_DATA_URI = /^data:image\/(?:png|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u

export const createEip6963ProviderDetail = (
  infoValue: Eip6963ProviderInfo,
  provider: Eip1193Provider
): Eip6963ProviderDetail => {
  if (!UUID_V4.test(infoValue.uuid)) throw new TypeError("EIP-6963 provider uuid must be UUIDv4.")
  if (!infoValue.name.trim() || infoValue.name.length > 64) {
    throw new TypeError("EIP-6963 provider name must contain 1 to 64 characters.")
  }
  if (!RDNS.test(infoValue.rdns)) throw new TypeError("EIP-6963 provider rdns is invalid.")
  if (infoValue.icon.length > 350_000 || !SAFE_IMAGE_DATA_URI.test(infoValue.icon)) {
    throw new TypeError("EIP-6963 provider icon must be a base64 PNG, GIF, or WebP data URI.")
  }
  const info = Object.freeze({ ...infoValue })
  return Object.freeze({ info, provider })
}

export const announceEip6963Provider = (
  target: Eip6963EventTarget,
  detail: Eip6963ProviderDetail
): (() => void) => {
  const announce = (): void => {
    target.dispatchEvent(new CustomEvent(EIP6963_ANNOUNCE_PROVIDER_EVENT, { detail }))
  }
  target.addEventListener(EIP6963_REQUEST_PROVIDER_EVENT, announce)
  announce()
  return () => target.removeEventListener(EIP6963_REQUEST_PROVIDER_EVENT, announce)
}

/**
 * Intended for Electron's `contextBridge.executeInMainWorld`. This function is deliberately
 * self-contained because Electron serializes it without its module closure.
 */
export const installEip6963ProviderInMainWorld = (
  info: Eip6963ProviderInfo,
  providerGlobal = "ethereum"
): void => {
  const page = globalThis as typeof globalThis & Record<string, unknown>
  const provider = page[providerGlobal]
  if (!provider) throw new Error(`Missing injected provider: ${providerGlobal}`)
  const detail = Object.freeze({ info: Object.freeze({ ...info }), provider })
  const announce = (): void => {
    globalThis.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }))
  }
  globalThis.addEventListener("eip6963:requestProvider", announce)
  announce()
}
