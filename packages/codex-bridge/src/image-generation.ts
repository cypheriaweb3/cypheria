import type { v2 } from "@cypheria/protocol/codex-types"

export type CodexGeneratedImageData = {
  readonly base64: string
  readonly mediaType: string
  readonly url: string
}

const mediaTypeFromPath = (path: string | undefined): string | undefined => {
  const extension = path?.split(".").at(-1)?.toLowerCase()
  switch (extension) {
    case "avif":
      return "image/avif"
    case "bmp":
      return "image/bmp"
    case "gif":
      return "image/gif"
    case "jpeg":
    case "jpg":
      return "image/jpeg"
    case "svg":
      return "image/svg+xml"
    case "webp":
      return "image/webp"
    case "png":
      return "image/png"
    default:
      return undefined
  }
}

const mediaTypeFromBase64 = (base64: string): string | undefined => {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png"
  if (base64.startsWith("/9j/")) return "image/jpeg"
  if (base64.startsWith("R0lGOD")) return "image/gif"
  if (base64.startsWith("UklGR")) return "image/webp"
  if (base64.startsWith("Qk")) return "image/bmp"
  if (base64.startsWith("AAAAIGZ0eXBhdmlm")) return "image/avif"
  return undefined
}

export const codexGeneratedImageData = (
  item: Extract<v2.ThreadItem, { type: "imageGeneration" }>
): CodexGeneratedImageData | undefined => {
  if (!item.result || item.failure) return undefined

  const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/isu.exec(item.result)
  const base64 = (dataUrl?.[2] ?? item.result).trim()
  if (!base64) return undefined
  const mediaType =
    dataUrl?.[1] ?? mediaTypeFromBase64(base64) ?? mediaTypeFromPath(item.savedPath) ?? "image/png"
  return {
    base64,
    mediaType,
    url: `data:${mediaType};base64,${base64}`,
  }
}
