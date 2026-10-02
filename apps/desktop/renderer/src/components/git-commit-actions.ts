import type { CypheriaApi } from "@cypheria/client"

type Git = CypheriaApi["git"]

export type CommitRequest = {
  readonly coAuthors?: readonly string[]
  readonly includeUnstaged: boolean
  /** Blank asks the Server to write the message from the diff. */
  readonly message: string
  readonly push: boolean
}

/** Status codes of changes a commit would take: staged ones, plus unstaged and untracked when asked. */
export const hasCommittableChanges = (
  entries: readonly { readonly code: string }[],
  includeUnstaged: boolean
): boolean =>
  entries.some(({ code }) => (includeUnstaged ? code !== "  " : code[0] !== " " && code[0] !== "?"))

/** Semicolon-separated `Name <email>` entries, as typed in the commit form. */
export const parseCoAuthors = (value: string): string[] =>
  value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)

/**
 * Commits, and pushes when asked. A push that fails after a successful commit says so, because the
 * commit stays and only the push needs another try.
 */
export const commitChanges = async (git: Git, cwd: string, request: CommitRequest) => {
  const message = request.message.trim() || (await git.generateText(cwd, "commit")).title
  await git.commit(cwd, {
    coAuthors: [...(request.coAuthors ?? [])],
    includeUnstaged: request.includeUnstaged,
    message,
  })
  if (!request.push) return
  try {
    await git.push(cwd)
  } catch (error) {
    throw new Error(
      `Commit succeeded; push failed. You can retry Push: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
