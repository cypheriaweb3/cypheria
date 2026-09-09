import { defaultUrlTransform, type UrlTransform } from "streamdown"

const GENERATED_IMAGES_MARKER = "/generated_images/"
const GENERATED_IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu

const decodedPath = (url: string): string | null => {
  try {
    const path = url.startsWith("file:") ? new URL(url).pathname : url
    return decodeURIComponent(path).replaceAll("\\", "/")
  } catch {
    return null
  }
}

export const generatedImageResourceUrl = (url: string): string | null => {
  const path = decodedPath(url)
  if (!path) return null
  const markerIndex = path.lastIndexOf(GENERATED_IMAGES_MARKER)
  if (markerIndex < 0) return null

  const segments = path.slice(markerIndex + GENERATED_IMAGES_MARKER.length).split("/")
  if (
    !segments.length ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    !GENERATED_IMAGE_EXTENSION.test(segments.at(-1) ?? "")
  ) {
    return null
  }
  return `cypheria://media/generated-images/${segments.map(encodeURIComponent).join("/")}`
}

export const codexMarkdownUrlTransform: UrlTransform = (url, key, node) => {
  if (key === "src" && node.tagName === "img") {
    const generatedImageUrl = generatedImageResourceUrl(url)
    if (generatedImageUrl) return generatedImageUrl
  }
  return defaultUrlTransform(url, key, node)
}
