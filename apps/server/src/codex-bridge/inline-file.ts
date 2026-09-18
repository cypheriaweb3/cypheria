const bytesFromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

export const inlineTextFromBytes = (value: string | Uint8Array): string => {
  const bytes = typeof value === "string" ? bytesFromBase64(value) : value
  return new TextDecoder().decode(bytes)
}

export const inlineTextFromDataUrl = (value: string): string | null => {
  if (!value.toLowerCase().startsWith("data:")) return null
  const comma = value.indexOf(",")
  if (comma === -1) return null

  const metadata = value.slice(5, comma)
  const payload = value.slice(comma + 1)
  try {
    if (metadata.split(";").some((part) => part.toLowerCase() === "base64")) {
      return inlineTextFromBytes(payload)
    }
    return decodeURIComponent(payload)
  } catch {
    return null
  }
}
