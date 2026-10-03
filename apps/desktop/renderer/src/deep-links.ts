import { atom } from "jotai"
import { useEffect } from "react"
import { type CypheriaDeepLink, parseCypheriaDeepLink } from "../../ipc/src/deep-link.js"

/** A request to show a pull request's diff, optionally at one line, in a Thread's Review panel. */
export type ReviewFocusRequest = {
  readonly line: number | null
  readonly nonce: number
  readonly path: string | null
  readonly pullRequest: string
  readonly side: "additions" | "deletions"
  /** The Thread whose Review panel shows it; null means the Thread on screen. */
  readonly threadId: string | null
}

/** A request to bring a Thread's Review panel forward. */
export type ReviewPanelRequest = { readonly nonce: number; readonly threadId: string | null }

export const reviewFocusAtom = atom<ReviewFocusRequest | null>(null)
export const reviewPanelRequestAtom = atom<ReviewPanelRequest | null>(null)

let nonce = 0
export const nextRequestNonce = (): number => {
  nonce += 1
  return nonce
}

/** `https://github.com/o/r/pull/12` to `12`, or null for anything else. */
export const pullRequestNumber = (url: string): number | null => {
  const match = /\/pull\/(\d+)\/?$/u.exec(new URL(url).pathname)
  const value = match ? Number(match[1]) : Number.NaN
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/** Same pull request, ignoring a trailing slash and case in the repository path. */
export const samePullRequest = (left: string, right: string): boolean => {
  try {
    const a = new URL(left)
    const b = new URL(right)
    const path = (url: URL) => url.pathname.replace(/\/+$/u, "").toLowerCase()
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && path(a) === path(b)
  } catch {
    return false
  }
}

export type DeepLinkActions = {
  readonly openPluginApp: (pluginId: string, tool: string, path: string) => void
  readonly openReview: (request: ReviewFocusRequest) => void
  readonly openThread: (threadId: string, view: "review" | null) => void
}

/** Routes a link into the app. Anything that is not a deep link is ignored. */
export const routeDeepLink = (raw: string, actions: DeepLinkActions): boolean => {
  const link: CypheriaDeepLink | null = parseCypheriaDeepLink(raw)
  if (!link) return false
  if (link.type === "thread") {
    actions.openThread(link.threadId, link.view)
    return true
  }
  if (link.type === "plugin-app") {
    actions.openPluginApp(link.pluginId, link.tool, link.path)
    return true
  }
  actions.openReview({
    line: link.line,
    nonce: nextRequestNonce(),
    path: link.path,
    pullRequest: link.pullRequest,
    side: link.side === "left" ? "deletions" : "additions",
    threadId: null,
  })
  return true
}

/** Receives links other applications opened, including those that arrived before the window. */
export const useDeepLinkListener = (actions: DeepLinkActions): void => {
  const { openPluginApp, openReview, openThread } = actions
  useEffect(() => {
    const app = window.cypheria?.app
    if (!app) return
    const route = (raw: string) => routeDeepLink(raw, { openPluginApp, openReview, openThread })
    const stop = app.onDeepLink(route)
    void app.takeDeepLinks().then(({ links }) => {
      for (const link of links) route(link)
    })
    return stop
  }, [openPluginApp, openReview, openThread])
}
