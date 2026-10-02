import {
  CODE_REVIEW_APP_REQUESTS,
  type CodeReviewChatIntent,
  type CodeReviewSettings,
  type CodeReviewSidebarState,
} from "@cypheria/protocol"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { atom, useSetAtom } from "jotai"
import { useMemo } from "react"
import type { z } from "zod"

import { browserTabsStore } from "../../browser/store.js"
import { clientStateStore, codeReviewPinsAtom } from "../../client-state.js"
import { ensureCypheriaClient } from "../../cypheria-client.js"
import type { McpAppExtensionHandler, McpAppNotifier } from "../mcp-app-frame.js"
import { readPullRequestWatch, setPullRequestWatch } from "./watch.js"

export const CODE_REVIEW_SERVER = "code-review"
export const CODE_REVIEW_APP_URI = "ui://pull-requests/app"

/** The sections the Code Review App hands the host, which the Code Review sidebar draws. */
export const codeReviewSidebarAtom = atom<CodeReviewSidebarState | null>(null)
/** Sends notifications to the App on the Code Review page, while it is open. */
export const codeReviewNotifierAtom = atom<{ notify: McpAppNotifier } | null>(null)

/** The Thread Attachment identity of a pull request or merge request URL. */
export const pullRequestIdentityKey = (value: string): string | null => {
  try {
    const url = new URL(value)
    const parts = url.pathname.split("/").filter(Boolean)
    const host = url.hostname.toLowerCase()
    const marker = parts.lastIndexOf("-")
    if (marker >= 2 && parts[marker + 1] === "merge_requests") {
      const project = parts.slice(0, marker)
      const repository = project.at(-1) ?? ""
      const owner = project.slice(0, -1).join("/")
      return `gitlab:${host}:${owner.toLowerCase()}/${repository.toLowerCase()}#${Number(parts[marker + 2])}`
    }
    if (parts.length >= 4 && parts[2] === "pull") {
      return `github:${host}:${(parts[0] ?? "").toLowerCase()}/${(parts[1] ?? "").toLowerCase()}#${Number(parts[3])}`
    }
    return null
  } catch {
    return null
  }
}

/** A pull request URL as the App names it: host, owner, repository, and number. */
export const parsePullRequestUrl = (value: string) => {
  const key = pullRequestIdentityKey(value)
  if (!key) return null
  const match = /^(github|gitlab):([^:]+):(.+)\/([^/#]+)#(\d+)$/u.exec(key)
  if (!match) return null
  const url = new URL(value)
  const parts = url.pathname.split("/").filter(Boolean)
  const marker = parts.lastIndexOf("-")
  const owner = match[1] === "gitlab" ? parts.slice(0, marker - 1).join("/") : (parts[0] ?? "")
  const repository = match[1] === "gitlab" ? (parts[marker - 1] ?? "") : (parts[1] ?? "")
  return {
    provider: match[1] as "github" | "gitlab",
    pullRequest: { hostname: match[2] as string, number: Number(match[5]), owner, repository },
  }
}

type ChatInput = {
  provider: "github" | "gitlab"
  url: string
  title: string
  intent: CodeReviewChatIntent
  context?: string
}

/** The prompt a chat opened from Code Review starts with, as the official desktop words them. */
const usePrompts = () => {
  const { i18n } = useLingui()
  return (input: ChatInput, settings: CodeReviewSettings | null) => {
    const { url } = input
    const context = input.context ? `\n\n${input.context}` : ""
    switch (input.intent) {
      case "review": {
        const prompt = i18n._(
          msg({
            id: "codeReviewPlugin.manualReview.prompt",
            message: `Please run a private review of ${url}. Look for actionable bugs and assess the overall impact. Use a fresh reviewer subagent without prior chat context. Don’t change code or send or post anything on my behalf.`,
          })
        )
        const instructions = settings?.localReviewInstructions.trim()
        return instructions
          ? `${prompt}\n\n**${i18n._(msg({ id: "codeReviewPlugin.manualReview.personalInstructionsHeading", message: "My custom review instructions:" }))}**\n${instructions}`
          : prompt
      }
      case "fix-checks":
        return `${i18n._(
          msg({
            id: "codeReviewPlugin.fixChecks.prompt",
            message: `Fix the failing checks for ${url}. Verify that the repository and checked-out branch match this pull request before editing. Read the check output, make the smallest safe change, run the relevant checks, then commit and push the fix.`,
          })
        )}${context}`
      case "fix-comments":
        return `${i18n._(
          msg({
            id: "codeReviewPlugin.fixComments.prompt",
            message: `Address the attached review comments for ${url}. Verify that the repository and checked-out branch match this pull request before editing. Make the smallest safe changes for actionable feedback, and explain anything that needs clarification or is already addressed.`,
          })
        )}${context}`
      case "fix-conflicts":
        return `${i18n._(
          msg({
            id: "codeReviewPlugin.fixConflicts.prompt",
            message: `Resolve the merge conflicts for ${url}. Verify that the repository and checked-out branch match this pull request; never modify an unrelated checkout. Fetch the latest target branch, merge or rebase as appropriate for this repository, resolve the conflicts, and run the relevant checks. Then commit and push the resolution.`,
          })
        )}${context}`
      case "chat":
        return `${url}${context}`
    }
  }
}

const readSettings = async (): Promise<CodeReviewSettings> =>
  (await (await ensureCypheriaClient()).settings.get()).config.codeReview

/**
 * The Cypheria host side of the Code Review App: what the official desktop's bridge serves, built
 * on Server requests, Desktop navigation, and Desktop-local pins.
 */
export const useCodeReviewExtensions = (options: {
  surface: "global" | "thread" | "settings"
  threadId?: string
  /** The pull request URL shown when the App starts. */
  selectedUrl?: string | null
  /** Shows a pull request in Code Review; false when this surface cannot. */
  onSelect?: (url: string) => boolean
}): Record<string, McpAppExtensionHandler> => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const prompt = usePrompts()
  const setSidebar = useSetAtom(codeReviewSidebarAtom)
  const { onSelect, selectedUrl, surface, threadId } = options
  return useMemo(() => {
    const parse = <M extends keyof typeof CODE_REVIEW_APP_REQUESTS>(
      method: M,
      params: unknown
    ): z.infer<(typeof CODE_REVIEW_APP_REQUESTS)[M]> =>
      (CODE_REVIEW_APP_REQUESTS[method] as z.ZodType).parse(params) as z.infer<
        (typeof CODE_REVIEW_APP_REQUESTS)[M]
      >
    const handlers: Record<keyof typeof CODE_REVIEW_APP_REQUESTS, McpAppExtensionHandler> = {
      "cypheria/codeReview/connect": async (params) => {
        const { provider } = parse("cypheria/codeReview/connect", params)
        if (provider === "chatgpt") {
          await navigate({
            params: { agentId: "codex", sectionId: "authentication" },
            to: "/settings/agent-harnesses/$agentId/$sectionId",
          })
        } else {
          await navigate({ search: { search: provider }, to: "/plugins" } as never)
        }
        return {}
      },
      "cypheria/codeReview/openChat": async (params) => {
        const input = parse("cypheria/codeReview/openChat", params)
        const text = prompt(input, await readSettings().catch(() => null))
        await navigate({ search: { prompt: text }, to: "/" })
        return { threadId: null }
      },
      "cypheria/codeReview/openLink": async (params) => {
        const { url } = parse("cypheria/codeReview/openLink", params)
        const settings = await readSettings().catch(() => null)
        const target = settings?.githubLinkTarget ?? "code-review-tab"
        if (target === "code-review-tab" && parsePullRequestUrl(url) && onSelect?.(url)) return {}
        if (target === "in-app-browser" && threadId) {
          browserTabsStore.create({ kind: "web", threadId, url })
          return {}
        }
        await window.cypheria?.app.openExternal(url)
        return {}
      },
      "cypheria/codeReview/openThread": async (params) => {
        const { threadId: target } = parse("cypheria/codeReview/openThread", params)
        await navigate({ search: { thread: target }, to: "/" })
        return {}
      },
      "cypheria/codeReview/watch/get": async (params) => {
        const target = parse("cypheria/codeReview/watch/get", params)
        return readPullRequestWatch(surface === "thread" ? threadId : undefined, target)
      },
      "cypheria/codeReview/watch/set": async (params) => {
        const { enabled, ...target } = parse("cypheria/codeReview/watch/set", params)
        const watch = await setPullRequestWatch(
          surface === "thread" ? threadId : undefined,
          target,
          enabled
        )
        await queryClient.invalidateQueries({ queryKey: ["cypheria", "schedules"] })
        return watch
      },
      "cypheria/codeReview/pin": async (params) => {
        const { accountKey, item, pinned } = parse("cypheria/codeReview/pin", params)
        await clientStateStore.set(codeReviewPinsAtom, (pins) => {
          const others = pins.filter(
            (pin) =>
              !(pin.accountKey === accountKey && pin.url.toLowerCase() === item.url.toLowerCase())
          )
          return pinned ? [{ ...item, accountKey }, ...others].slice(0, 1200) : others
        })
        return { pinned }
      },
      "cypheria/codeReview/provider": async (params) => {
        const request = parse("cypheria/codeReview/provider", params)
        return (await ensureCypheriaClient()).codeReview.provider(request)
      },
      "cypheria/codeReview/settings/get": async () => readSettings(),
      "cypheria/codeReview/settings/update": async (params) => {
        const { patch } = parse("cypheria/codeReview/settings/update", params)
        const snapshot = await (await ensureCypheriaClient()).settings.update({ codeReview: patch })
        queryClient.setQueryData(["settings", "server-config"], snapshot)
        return snapshot.config.codeReview
      },
      "cypheria/codeReview/selection": async () => ({
        pullRequest: selectedUrl ? (parsePullRequestUrl(selectedUrl)?.pullRequest ?? null) : null,
      }),
      "cypheria/codeReview/setup": async () => (await ensureCypheriaClient()).codeReview.getSetup(),
      "cypheria/codeReview/sidebar": async (params) => {
        if (surface !== "global") return {}
        setSidebar(parse("cypheria/codeReview/sidebar", params))
        return {}
      },
      "cypheria/codeReview/threads": async (params) => {
        const { url } = parse("cypheria/codeReview/threads", params)
        const key = pullRequestIdentityKey(url)
        if (!key) return { threads: [] }
        const client = await ensureCypheriaClient()
        const owners = await client.threads.attachments.listOwners("pull_request", key, {
          limit: 20,
        })
        const threads = await Promise.all(
          owners.data.map(async (owner) => {
            const thread = await client.threads.get(owner.threadId).catch(() => null)
            return thread
              ? { id: thread.id, title: thread.title, updatedAt: thread.updatedAt }
              : null
          })
        )
        return { threads: threads.filter((thread) => thread != null) }
      },
    }
    return handlers
  }, [navigate, onSelect, prompt, queryClient, selectedUrl, setSidebar, surface, threadId])
}
