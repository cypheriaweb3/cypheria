/**
 * Links into the app. `cypheria://threads/<id>[?view=review]` opens a Thread, optionally with its
 * Review panel, and `cypheria://review?pr=<url>&path=<file>&line=<n>&side=<left|right>` opens a
 * pull request's diff at a line. `cypheria://plugins/<plugin>@<marketplace>/app/<tool>?path=<path>`
 * opens a plugin's global entry point at an App-relative path, as the OpenAI MCP Extensions deep
 * links do. `cypheria://app/` is the renderer's own origin and `cypheria://media/`
 * serves generated images, so neither is a deep link.
 */

export type CypheriaDeepLink =
  | { readonly threadId: string; readonly type: "thread"; readonly view: "review" | null }
  | {
      readonly line: number | null
      readonly path: string | null
      readonly pullRequest: string
      readonly side: "left" | "right"
      readonly type: "review"
    }
  | {
      /** The App-relative URL, starting with `/`. */
      readonly path: string
      readonly pluginId: string
      readonly tool: string
      readonly type: "plugin-app"
    }

const MAX_LENGTH = 8192
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const MAX_LINE = 10_000_000

export const parseCypheriaDeepLink = (raw: string): CypheriaDeepLink | null => {
  if (raw.length > MAX_LENGTH) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "cypheria:" || url.username || url.password || url.port) return null
  if (url.hostname === "threads") {
    const match = /^\/([^/]+)\/?$/u.exec(url.pathname)
    const threadId = match?.[1] ?? ""
    if (!THREAD_ID.test(threadId)) return null
    const view = url.searchParams.get("view")
    if (view !== null && view !== "review") return null
    return { threadId: threadId.toLowerCase(), type: "thread", view }
  }
  if (url.hostname === "plugins") {
    const match = /^\/([^/]+)\/app\/([^/]+)$/u.exec(url.pathname)
    if (!match) return null
    let pluginId: string
    let tool: string
    try {
      pluginId = decodeURIComponent(match[1] ?? "")
      tool = decodeURIComponent(match[2] ?? "")
    } catch {
      return null
    }
    const path = url.searchParams.get("path") ?? "/"
    if (!pluginId || !tool || !path.startsWith("/") || path.includes("#") || path.length > 4096) {
      return null
    }
    return { path, pluginId, tool, type: "plugin-app" }
  }
  if (url.hostname === "review" && (url.pathname === "" || url.pathname === "/")) {
    const pullRequest = url.searchParams.get("pr")
    if (!pullRequest) return null
    let pr: URL
    try {
      pr = new URL(pullRequest)
    } catch {
      return null
    }
    if (pr.protocol !== "https:" || pr.username || pr.password) return null
    const path = url.searchParams.get("path")
    const lineText = url.searchParams.get("line")
    const line = lineText === null ? null : Number(lineText)
    if (line !== null && (!Number.isInteger(line) || line < 1 || line > MAX_LINE)) return null
    const side = url.searchParams.get("side") ?? "right"
    if (side !== "left" && side !== "right") return null
    return {
      line,
      path: path && path.length <= 4096 ? path : null,
      pullRequest: pr.toString(),
      side,
      type: "review",
    }
  }
  return null
}
