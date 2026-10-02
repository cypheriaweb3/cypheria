/** What a code review covers: the working tree, or a branch since it left its base. */
export type CodeReviewScope =
  | { readonly mode: "uncommitted" }
  | {
      readonly mode: "branch"
      readonly baseBranch: string
      readonly sourceBranch: string
      readonly mergeBase: string
    }

const guidance = [
  "You are reviewing code changes. Do not modify any files; report findings only.",
  "Look for defects a careful reviewer would block on: incorrect behavior, broken edge cases, security problems, data loss, races, and regressions against existing behavior or tests. Mention style only when it hides a defect.",
  "Report each finding once, at the changed location it is about, with a concrete scenario in which it fails. Skip anything you cannot support from the code.",
  "Follow the review guidance in the repository's instruction files when it applies, and say which instruction a finding relies on.",
  "Attach every finding to its lines with a ::code-comment{...} directive on its own line, using the file's absolute path, the start and end lines in the new version, a short title that starts with a priority label such as [P1] or [P2], and a body that explains the problem. Use priority 0 for blockers through 3 for minor issues.",
  "End with a short overall verdict. If you find no actionable issue, say so briefly.",
]

/** The message that asks the Agent to review a scope of changes. */
export const codeReviewPrompt = (scope: CodeReviewScope): string => {
  if (scope.mode === "uncommitted") {
    return [
      "Please review my uncommitted changes.",
      "",
      ...guidance,
      "Scope: the staged and unstaged changes in the working tree, including new untracked files. Use `git status` and `git diff HEAD` to see them.",
    ].join("\n")
  }
  return [
    `Please review changes on ${scope.sourceBranch} against ${scope.baseBranch}.`,
    "",
    ...guidance,
    `Scope: the changes on the current branch since it diverged from ${scope.baseBranch} at merge base ${scope.mergeBase}. Use \`git diff ${scope.mergeBase}\` to see them, including uncommitted work.`,
  ].join("\n")
}
