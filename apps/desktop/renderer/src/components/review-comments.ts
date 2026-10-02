import type { ReviewComment } from "../client-state.js"

/** `@@ -12,4 +15,6 @@` to the first new line, or the first old line when nothing was added. */
export const hunkAnchor = (
  header: string
): { lineNumber: number; side: "additions" | "deletions" } | null => {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(header)
  if (!match) return null
  const newCount = match[4] === undefined ? 1 : Number(match[4])
  if (newCount > 0) return { lineNumber: Math.max(1, Number(match[3])), side: "additions" }
  return { lineNumber: Math.max(1, Number(match[1])), side: "deletions" }
}

/**
 * The message that hands Review comments to the Agent: each comment names its file by absolute
 * path and line, so the Agent can open the exact spot in the working tree.
 */
export const formatReviewComments = (root: string, comments: readonly ReviewComment[]): string => {
  const base = root.replace(/\/+$/u, "")
  const lines = comments.map((comment, index) => {
    const side = comment.side === "deletions" ? " (removed line)" : ""
    const lines =
      comment.startLineNumber !== undefined && comment.startLineNumber < comment.lineNumber
        ? `${comment.startLineNumber}-${comment.lineNumber}`
        : `${comment.lineNumber}`
    return `${index + 1}. ${base}/${comment.path}:${lines}${side}\n   ${comment.body.trim().replace(/\n/gu, "\n   ")}`
  })
  return [`Please address these review comments on the changes in ${base}:`, "", ...lines].join(
    "\n"
  )
}
