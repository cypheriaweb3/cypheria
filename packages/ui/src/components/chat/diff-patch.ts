/** One file's part of a unified diff: the path after the change and the text of its section. */
export type ChatDiffSection = { path: string; text: string }

const headerPath = (line: string): string | null => {
  const match = /^diff --git (?:"?a\/(.+?)"? )"?b\/(.+?)"?$/u.exec(line)
  return match?.[2] ?? null
}

/** Splits a multi-file unified diff into its `diff --git` sections, in order. */
export const chatDiffFileSections = (patch: string): ChatDiffSection[] => {
  const sections: ChatDiffSection[] = []
  let current: { path: string; lines: string[] } | null = null
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) sections.push({ path: current.path, text: `${current.lines.join("\n")}\n` })
      current = { path: headerPath(line) ?? "", lines: [line] }
      continue
    }
    current?.lines.push(line)
  }
  if (current) {
    const text = current.lines.join("\n")
    sections.push({ path: current.path, text: text.endsWith("\n") ? text : `${text}\n` })
  }
  return sections
}

const importLine =
  /^\s*(?:import\b|from\s+\S+\s+import\b|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s|(?:const|let|var)\s+[\w{}\s,]+=\s*require\(|use\s+[\w:{}*,\s]+;|#include\s|#import\s|using\s+[\w.]+;|require\s*\(|package\s+[\w.]+;?\s*$)/u

/** Whether a changed line only adds, removes, or edits an import, or is blank. */
export const isChatImportLine = (text: string): boolean => !text.trim() || importLine.test(text)

/**
 * The patch without hunks whose added and removed lines are all imports or blank, and without
 * files left with no hunk. Context lines do not count, and other headers are kept unchanged.
 */
export const chatHideImportOnlyHunks = (patch: string): string =>
  chatDiffFileSections(patch)
    .map(({ text }) => {
      const lines = text.replace(/\n$/u, "").split("\n")
      const firstHunk = lines.findIndex((line) => line.startsWith("@@"))
      if (firstHunk < 0) return text
      const header = lines.slice(0, firstHunk)
      const hunks: string[][] = []
      for (const line of lines.slice(firstHunk)) {
        if (line.startsWith("@@")) hunks.push([line])
        else hunks.at(-1)?.push(line)
      }
      const kept = hunks.filter((hunk) =>
        hunk
          .slice(1)
          .some(
            (line) =>
              (line.startsWith("+") || line.startsWith("-")) && !isChatImportLine(line.slice(1))
          )
      )
      if (kept.length === 0) return ""
      return `${[...header, ...kept.flat()].join("\n")}\n`
    })
    .join("")

const generatedNames = new Set([
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "Pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
])

/**
 * Whether a path is commonly generated rather than written: dependency lock files, minified
 * bundles, source maps, and snapshot files. Repository attributes can mark more files.
 */
export const isLikelyGeneratedPath = (path: string): boolean => {
  const name = path.split("/").at(-1) ?? path
  return (
    generatedNames.has(name) ||
    /\.min\.(?:js|css|mjs)$/u.test(name) ||
    /\.(?:js|css|mjs)\.map$/u.test(name) ||
    /\.snap$/u.test(name) ||
    /(?:^|\/)__snapshots__\//u.test(path)
  )
}
