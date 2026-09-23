import type { GitReviewLineCount } from "@cypheria/protocol"

export const parseGitNumstat = (output: string): GitReviewLineCount[] => {
  const fields = output.split("\0")
  const counts: GitReviewLineCount[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (!field) continue
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/su.exec(field)
    if (!match) throw new Error("Git returned invalid line counts")
    let path = match[3] ?? ""
    if (!path) {
      if (!fields[index + 1] || !fields[index + 2])
        throw new Error("Git returned invalid renamed path counts")
      path = fields[index + 2] ?? ""
      index += 2
    }
    counts.push({
      path,
      additions: match[1] === "-" ? null : Number(match[1]),
      deletions: match[2] === "-" ? null : Number(match[2]),
    })
  }
  return counts
}

export const combineGitNumstats = (
  groups: readonly (readonly GitReviewLineCount[])[]
): GitReviewLineCount[] => {
  const totals = new Map<string, GitReviewLineCount>()
  for (const group of groups) {
    for (const entry of group) {
      const previous = totals.get(entry.path)
      totals.set(
        entry.path,
        previous
          ? {
              path: entry.path,
              additions:
                previous.additions === null || entry.additions === null
                  ? null
                  : previous.additions + entry.additions,
              deletions:
                previous.deletions === null || entry.deletions === null
                  ? null
                  : previous.deletions + entry.deletions,
            }
          : entry
      )
    }
  }
  return [...totals.values()]
}
