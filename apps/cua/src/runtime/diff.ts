/** Above this many lines on either side, a full snapshot is cheaper than computing a diff. */
const MAX_DIFF_LINES = 4_000

/**
 * Line-level changes from `before` to `after` as `- removed` and `+ added` lines, in order.
 * Returns `null` when the inputs are too large to compare.
 */
export const diffLines = (before: string, after: string): string[] | null => {
  const a = before.split("\n")
  const b = after.split("\n")
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const middleA = a.slice(start, endA)
  const middleB = b.slice(start, endB)
  // Longest common subsequence over the changed middle only.
  const rows = middleA.length + 1
  const columns = middleB.length + 1
  const table = new Uint32Array(rows * columns)
  for (let i = middleA.length - 1; i >= 0; i--) {
    for (let j = middleB.length - 1; j >= 0; j--) {
      table[i * columns + j] =
        middleA[i] === middleB[j]
          ? (table[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * columns + j] ?? 0, table[i * columns + j + 1] ?? 0)
    }
  }
  const changes: string[] = []
  let i = 0
  let j = 0
  while (i < middleA.length || j < middleB.length) {
    if (i < middleA.length && j < middleB.length && middleA[i] === middleB[j]) {
      i++
      j++
    } else if (
      j < middleB.length &&
      (i === middleA.length ||
        (table[i * columns + j + 1] ?? 0) >= (table[(i + 1) * columns + j] ?? 0))
    ) {
      changes.push(`+ ${middleB[j++]}`)
    } else {
      changes.push(`- ${middleA[i++]}`)
    }
  }
  return changes
}

/**
 * Remembers the last snapshot of each target and renders the next one as a diff when that is
 * clearly smaller. Element refs and indices are renumbered by every snapshot, so a diff shows
 * lines whose numbers changed.
 */
export class SnapshotHistory {
  readonly #last = new Map<string, string>()

  render(key: string, label: string, snapshot: string, full = false): string {
    const previous = this.#last.get(key)
    this.#last.set(key, snapshot)
    if (full || previous === undefined) return snapshot
    if (previous === snapshot) {
      return `No changes in ${label} since the last snapshot. Its refs are unchanged.`
    }
    const changes = diffLines(previous, snapshot)
    if (!changes || changes.join("\n").length > snapshot.length / 2) return snapshot
    return [
      `Changes in ${label} since the last snapshot (pass { full: true } for the whole tree):`,
      ...changes,
    ].join("\n")
  }

  forget(key: string): void {
    this.#last.delete(key)
  }
}
