export type NormalizeRpcUrlOptions = {
  readonly allowLoopbackDevelopment?: boolean
  readonly transport: "http" | "websocket"
}

const loopbackNames = new Set(["localhost", "127.0.0.1", "[::1]"])

export const isLoopbackHostname = (hostname: string): boolean =>
  loopbackNames.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith(".localhost")

export const normalizeRpcUrl = (input: string, options: NormalizeRpcUrlOptions): string => {
  const url = new URL(input)
  if (url.username || url.password || url.hash) {
    throw new Error("RPC URLs must not contain user info or fragments.")
  }

  const secureProtocol = options.transport === "http" ? "https:" : "wss:"
  const developmentProtocol = options.transport === "http" ? "http:" : "ws:"
  const developmentAllowed =
    options.allowLoopbackDevelopment === true &&
    url.protocol === developmentProtocol &&
    isLoopbackHostname(url.hostname)

  if (url.protocol !== secureProtocol && !developmentAllowed) {
    throw new Error(`RPC URLs require ${secureProtocol} except explicit loopback development.`)
  }

  return url.toString()
}

export const redactRpcUrl = (input: string): string => {
  const url = new URL(input)
  url.username = ""
  url.password = ""
  url.hash = ""
  if (url.search) url.search = "?redacted"
  if (url.pathname !== "/") url.pathname = "/redacted"
  return url.toString()
}
