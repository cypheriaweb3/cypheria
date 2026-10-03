import type {
  CodeReviewPullRequest,
  CodeReviewPullRequestList,
  CodeReviewSidebarItem,
} from "@cypheria/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { cypheriaClient, ensureCypheriaClient } from "../../cypheria-client.js"

const queryKey = (list: CodeReviewPullRequestList, accountKey: string | null) =>
  ["code-review", "pull-request-lists", list, accountKey] as const

/**
 * A provider account's pinned or recently opened pull requests. The Server keeps them, so every
 * client shows the same lists and refreshes when another client changes one.
 */
export const usePullRequestList = (list: CodeReviewPullRequestList, accountKey: string | null) => {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      cypheriaClient.codeReview.pullRequests.subscribe((change) => {
        void queryClient.invalidateQueries({ queryKey: queryKey(change.list, change.accountKey) })
      }),
    [queryClient]
  )
  return useQuery({
    enabled: accountKey !== null,
    queryFn: async (): Promise<CodeReviewPullRequest[]> =>
      (await ensureCypheriaClient()).codeReview.pullRequests.list(list, accountKey as string),
    queryKey: queryKey(list, accountKey),
    staleTime: 60_000,
  })
}

/** Pins or unpins a pull request for an account; returns whether it is now pinned. */
export const setPullRequestPinned = async (
  accountKey: string,
  item: CodeReviewSidebarItem,
  pinned: boolean
): Promise<boolean> => {
  const { pullRequests } = (await ensureCypheriaClient()).codeReview
  if (pinned) await pullRequests.save("pinned", accountKey, item)
  else await pullRequests.remove("pinned", accountKey, item.url)
  return pinned
}

/**
 * Records that a pull request was opened, at the top of the account's recent ones, and refreshes
 * a pinned entry's stored title and author. Returns whether it is pinned.
 */
export const recordPullRequestVisit = async (
  accountKey: string,
  item: CodeReviewSidebarItem
): Promise<boolean> => {
  const { pullRequests } = (await ensureCypheriaClient()).codeReview
  const [, pinned] = await Promise.all([
    pullRequests.save("recent", accountKey, item),
    pullRequests.save("pinned", accountKey, item, { updateOnly: true }),
  ])
  return pinned !== null
}
