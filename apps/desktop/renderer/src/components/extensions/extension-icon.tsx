import type { ExtensionIcon as Icon } from "@cypheria/protocol"
import { cn } from "@cypheria/ui/lib/utils"
import { Puzzle } from "lucide-react"

/**
 * A plugin icon. Monochrome SVG is drawn as a mask so `currentColor` follows the theme, as the
 * extensions specification asks; other images keep their colors. Icons for the other theme are
 * hidden.
 */
export function ExtensionIcon({
  className,
  icon,
}: Readonly<{ className?: string; icon: Icon | null }>) {
  const dark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  if (!icon || (icon.theme && icon.theme !== (dark ? "dark" : "light"))) {
    return <Puzzle aria-hidden className={cn("size-4", className)} />
  }
  const svg = icon.mimeType === "image/svg+xml" || icon.src.startsWith("data:image/svg+xml")
  if (svg) {
    const mask = `url("${icon.src.replaceAll('"', "%22")}") center / contain no-repeat`
    return (
      <span
        aria-hidden
        className={cn("inline-block size-4 shrink-0 bg-current", className)}
        style={{ mask, WebkitMask: mask }}
      />
    )
  }
  return <img alt="" className={cn("size-4 shrink-0 object-contain", className)} src={icon.src} />
}
