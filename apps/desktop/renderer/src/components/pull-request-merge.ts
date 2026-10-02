import type { GitHubPrMetadata, GitHubPullRequestChecks } from "@cypheria/protocol"

/** Why a pull request cannot be merged now, in the order the official desktop checks them. */
export type MergeBlocker =
  | "closed"
  | "draft"
  | "conflicts"
  | "failingChecks"
  | "pendingChecks"
  | "blocked"
  | "unknown"

export const mergeBlocker = (input: {
  state: string
  isDraft: boolean
  metadata: Pick<GitHubPrMetadata, "mergeable" | "mergeStateStatus"> | null
  checks: readonly Pick<GitHubPullRequestChecks[number], "bucket">[] | null
}): MergeBlocker | null => {
  if (input.state !== "OPEN") return "closed"
  if (input.isDraft || input.metadata?.mergeStateStatus === "DRAFT") return "draft"
  if (!input.metadata) return "unknown"
  if (input.metadata.mergeable === "CONFLICTING" || input.metadata.mergeStateStatus === "DIRTY")
    return "conflicts"
  if (input.checks?.some((check) => check.bucket === "fail")) return "failingChecks"
  if (input.checks?.some((check) => check.bucket === "pending")) return "pendingChecks"
  if (input.metadata.mergeStateStatus === "BLOCKED") return "blocked"
  if (input.metadata.mergeable === "UNKNOWN" || input.metadata.mergeStateStatus === "UNKNOWN")
    return "unknown"
  return null
}

/** The saved method when the repository allows it, otherwise the first allowed one. */
export const defaultMergeMethod = (
  saved: "merge" | "squash",
  allowed: readonly ("merge" | "squash")[]
): "merge" | "squash" | null => (allowed.includes(saved) ? saved : (allowed[0] ?? null))
