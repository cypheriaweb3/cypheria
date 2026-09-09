import { isAbsolute, relative, resolve } from "node:path"

const GENERATED_IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu

export const resolveGeneratedImageProtocolPath = (
  requestUrl: string,
  generatedImagesDir: string
): string | null => {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== "cypheria:" || url.hostname !== "media") return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  const prefix = "/generated-images/"
  if (!pathname.startsWith(prefix)) return null
  const requestedPath = pathname.slice(prefix.length)
  if (!requestedPath || !GENERATED_IMAGE_EXTENSION.test(requestedPath)) return null

  const root = resolve(generatedImagesDir)
  const candidate = resolve(root, requestedPath)
  const relativePath = relative(root, candidate)
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null
  return candidate
}
