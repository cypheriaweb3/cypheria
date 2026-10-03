import type {
  CodeReviewSettings,
  CodeReviewSidebarItem,
  CodeReviewSidebarState,
} from "@cypheria/protocol/code-review-app"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"

import { callTool, onHostNotification } from "./bridge.js"
import { accountKey, type Provider } from "./data.js"
import { host } from "./host.js"
import {
  type PullRequestIdentity,
  parsePullRequestUrl,
  pullRequestKey,
  pullRequestUrl,
  type ReviewAccount,
  type SearchItem,
  SearchPageSchema,
} from "./schemas.js"

type SectionId = CodeReviewSidebarState["sections"][number]["id"]

type Filters = {
  relationship: "all" | "authored" | "review_requested" | "reviewed" | "user_review_requested"
  lifecycle: "all" | "closed" | "merged" | "open"
  rawQuery?: string
  text?: string
}

const PAGE_SIZE = 20

/** The search behind each sidebar section, as the official sidebar defines them. */
const sectionFilters = (provider: Provider, id: SectionId): Filters | null => {
  switch (id) {
    case "waiting_for_review":
    case "approved":
    case "drafts":
      return provider === "github"
        ? { lifecycle: "open", rawQuery: "is:open author:@me", relationship: "all" }
        : { lifecycle: "open", relationship: "authored" }
    case "needs_my_review":
      return { lifecycle: "open", relationship: "user_review_requested" }
    case "needs_my_teams_review":
      return provider === "github"
        ? {
            lifecycle: "open",
            rawQuery: "is:open review-requested:@me -user-review-requested:@me",
            relationship: "all",
          }
        : null
    case "merged":
      return { lifecycle: "merged", relationship: "authored" }
  }
}

const GitLabSearchSchema = z
  .object({
    items: z.array(
      z
        .object({
          pullRequest: z.object({
            hostname: z.string(),
            owner: z.string(),
            repository: z.string(),
            number: z.number(),
          }),
          title: z.string(),
          updatedAt: z.string(),
          state: z.enum(["open", "closed", "merged"]),
          isDraft: z.boolean(),
          url: z.string().optional(),
          author: z
            .object({ login: z.string().nullable(), avatarUrl: z.string().nullable().optional() })
            .nullable(),
        })
        .passthrough()
    ),
    nextCursor: z.string().nullable().optional(),
  })
  .passthrough()

type Page = { items: SearchItem[]; cursor: string | null }

const searchPage = async (
  provider: Provider,
  account: ReviewAccount,
  filters: Filters,
  cursor: string | null
): Promise<Page> => {
  if (provider === "gitlab") {
    const value = GitLabSearchSchema.parse(
      await host.gitlab("search-pull-requests", {
        account,
        search: {
          cursor,
          lifecycle: filters.lifecycle,
          relationship: filters.relationship,
          repository: null,
          sort: "desc",
          text: filters.text ?? "",
        },
        source: "pull_requests_page",
      })
    )
    return {
      cursor: value.nextCursor ?? null,
      items: value.items.map((item) => ({
        authorAvatarUrl: item.author?.avatarUrl ?? undefined,
        authorLogin: item.author?.login ?? null,
        isDraft: item.isDraft,
        pullRequest: item.pullRequest,
        state: item.state,
        title: item.title,
        updatedAt: item.updatedAt,
        url: item.url ?? pullRequestUrl(item.pullRequest, "gitlab"),
      })),
    }
  }
  const page = SearchPageSchema.parse(
    await callTool("pull_requests.search", {
      account,
      cursor,
      hostname: account.hostname,
      lifecycle: filters.lifecycle,
      pageSize: PAGE_SIZE,
      relationship: filters.relationship,
      ...(filters.rawQuery ? { rawQuery: filters.rawQuery } : {}),
      text: filters.text ?? "",
    })
  )
  return { cursor: page.hasNextPage ? (page.endCursor ?? null) : null, items: page.items }
}

const useSearch = (
  provider: Provider,
  account: ReviewAccount | null,
  filters: Filters | null,
  key: string
) =>
  useInfiniteQuery({
    enabled: account != null && filters != null,
    getNextPageParam: (page: Page) => page.cursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      searchPage(provider, account as ReviewAccount, filters as Filters, pageParam),
    queryKey: ["search", provider, account ? accountKey(account) : null, key, filters],
    refetchInterval: filters?.lifecycle === "open" ? 300_000 : false,
    retry: false,
    staleTime: 60_000,
  })

const InboxDetailsSchema = z.object({
  items: z.array(
    z
      .object({
        pullRequest: z.object({
          hostname: z.string(),
          owner: z.string(),
          repository: z.string(),
          number: z.number(),
        }),
        reviewStatus: z.enum(["approved", "changes_requested", "review_required"]).nullable(),
      })
      .passthrough()
  ),
})

/** Review status of GitHub inbox items, read in one batch. */
const useReviewStatus = (
  provider: Provider,
  account: ReviewAccount | null,
  items: SearchItem[]
) => {
  const pullRequests = useMemo(
    () =>
      items
        .filter((item) => item.state === "open" && !item.isDraft)
        .map((item) => item.pullRequest)
        .slice(0, 200),
    [items]
  )
  return useQuery({
    enabled: provider === "github" && account != null && pullRequests.length > 0,
    queryFn: async () => {
      const value = InboxDetailsSchema.parse(
        await callTool("pull_requests.inboxDetails", { account, pullRequests })
      )
      return new Map(
        value.items.map((item) => [pullRequestKey(item.pullRequest), item.reviewStatus])
      )
    },
    queryKey: [
      "inbox-details",
      account ? accountKey(account) : null,
      pullRequests.map(pullRequestKey),
    ],
    retry: false,
    staleTime: 30_000,
  })
}

const sidebarItem = (
  item: SearchItem,
  status: Map<string, "approved" | "changes_requested" | "review_required" | null> | undefined
): CodeReviewSidebarItem => ({
  authorAvatarUrl: item.authorAvatarUrl ?? null,
  authorLogin: item.authorLogin ?? null,
  status:
    item.state === "merged"
      ? "merged"
      : item.state === "closed"
        ? "closed"
        : item.isDraft
          ? "draft"
          : (status?.get(pullRequestKey(item.pullRequest)) ?? null),
  title: item.title.trim() || `#${item.pullRequest.number}`,
  updatedAt: item.updatedAt,
  url: item.url,
})

/**
 * Reads the sidebar's sections and search for the selected account and hands them to the host,
 * which draws the Code Review sidebar. Section buttons in the sidebar load more or retry here.
 */
export const useSidebarInbox = (
  provider: Provider,
  account: ReviewAccount | null,
  settings: CodeReviewSettings | undefined,
  onOpen: (pullRequest: PullRequestIdentity) => void
) => {
  const visible = useMemo(
    () =>
      (settings?.sidebarSections ?? []).flatMap((id): SectionId[] =>
        id === "recents" ||
        sectionFilters(provider, id) == null ||
        (id === "merged" && provider !== "github")
          ? []
          : [id]
      ),
    [provider, settings?.sidebarSections]
  )
  const [query, setQuery] = useState("")
  const waiting = useSearch(
    provider,
    account,
    visible.includes("waiting_for_review") ? sectionFilters(provider, "waiting_for_review") : null,
    "waiting_for_review"
  )
  const mine = useSearch(
    provider,
    account,
    visible.includes("needs_my_review") ? sectionFilters(provider, "needs_my_review") : null,
    "needs_my_review"
  )
  const team = useSearch(
    provider,
    account,
    visible.includes("needs_my_teams_review")
      ? sectionFilters(provider, "needs_my_teams_review")
      : null,
    "needs_my_teams_review"
  )
  const merged = useSearch(
    provider,
    account,
    visible.includes("merged") ? sectionFilters(provider, "merged") : null,
    "merged"
  )
  const pasted = query ? parsePullRequestUrl(query, provider) : null
  const search = useSearch(
    provider,
    account,
    query && !pasted ? { lifecycle: "all", relationship: "all", text: query } : null,
    "search"
  )
  const sections = {
    merged,
    needs_my_review: mine,
    needs_my_teams_review: team,
    waiting_for_review: waiting,
  } as const
  const allItems = useMemo(
    () =>
      [waiting.data, mine.data, team.data, search.data].flatMap(
        (data) => data?.pages.flatMap((page) => page.items) ?? []
      ),
    [waiting.data, mine.data, team.data, search.data]
  )
  const reviewStatus = useReviewStatus(provider, account, allItems)

  const openRef = useRef(onOpen)
  openRef.current = onOpen
  const pastedKey = pasted ? JSON.stringify(pasted) : null
  useEffect(() => {
    if (pastedKey) openRef.current(JSON.parse(pastedKey) as PullRequestIdentity)
  }, [pastedKey])

  const targets = useRef({ ...sections, search })
  targets.current = { ...sections, search }
  useEffect(() => {
    const offAction = onHostNotification("cypheria/codeReview/sidebarAction", (params) => {
      const target = targets.current[params.sectionId as keyof typeof targets.current]
      if (!target) return
      if (params.action === "retry") void target.refetch()
      else void target.fetchNextPage()
    })
    const offSearch = onHostNotification("cypheria/codeReview/search", (params) => {
      setQuery(typeof params.query === "string" ? params.query.trim() : "")
    })
    return () => {
      offAction()
      offSearch()
    }
  }, [])

  const state: CodeReviewSidebarState | null = account
    ? {
        accountKey: accountKey(account),
        provider,
        sections: visible.map((id) => {
          const result = sections[id as keyof typeof sections]
          return {
            failed: result?.isError ?? false,
            hasMore: result?.hasNextPage ?? false,
            id,
            items: (result?.data?.pages.flatMap((page) => page.items) ?? []).map((item) =>
              sidebarItem(item, reviewStatus.data)
            ),
            loading: result?.isLoading || result?.isFetchingNextPage || false,
          }
        }),
        ...(query && !pasted
          ? {
              search: {
                failed: search.isError,
                hasMore: search.hasNextPage,
                items: (search.data?.pages.flatMap((page) => page.items) ?? []).map((item) =>
                  sidebarItem(item, reviewStatus.data)
                ),
                loading: search.isLoading || search.isFetchingNextPage,
                query,
              },
            }
          : {}),
      }
    : null
  const stateKey = state ? JSON.stringify(state) : null
  useEffect(() => {
    if (stateKey)
      void host.sidebar(JSON.parse(stateKey) as CodeReviewSidebarState).catch(() => undefined)
  }, [stateKey])
}
