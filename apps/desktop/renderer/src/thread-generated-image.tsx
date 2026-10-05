import { ChatGeneratedImage, useChatMarkdownHost } from "@cypheria/ui/components/chat"
import { useEffect, useState } from "react"

/** Sources the renderer can show as they are; anything else is a path on the Server host. */
const DIRECT_SOURCE = /^(?:data:image\/|blob:|https?:)/iu

/**
 * An image an Agent generated. A saved image is a path on the Server host, which the renderer
 * reads through the Server's file API like any other path in a reply; it never reads its own
 * file system, so this works with a remote Server too.
 */
export function ThreadGeneratedImage({ alt, uri }: { readonly alt: string; readonly uri: string }) {
  const host = useChatMarkdownHost()
  const direct = DIRECT_SOURCE.test(uri)
  const [loaded, setLoaded] = useState<{ uri: string; url: string } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    if (direct || !host) return
    const abort = new AbortController()
    let release: (() => void) | undefined
    void host
      .resolvePath(uri, abort.signal)
      .then((resolved) => (resolved.kind === "file" ? host.loadFile(resolved, abort.signal) : null))
      .then((file) => {
        if (abort.signal.aborted) {
          file?.release()
          return
        }
        if (!file) {
          setFailed(true)
          return
        }
        release = file.release
        setLoaded({ uri, url: file.url })
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true)
      })
    return () => {
      abort.abort()
      release?.()
    }
  }, [direct, host, uri])

  const src = direct ? uri : loaded?.uri === uri ? loaded.url : undefined
  return (
    <ChatGeneratedImage
      alt={alt}
      pending={!src && !failed}
      src={src}
      title={failed ? host?.labels.mediaUnavailable : undefined}
    />
  )
}
