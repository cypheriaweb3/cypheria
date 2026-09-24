export type GitHubPrAssociation = Readonly<{
  number: number
  title: string
  url: string
}>

type Associations = Readonly<Record<string, readonly GitHubPrAssociation[]>>
const key = "cypheria.git.github-pr-associations.v1"
const listeners = new Set<() => void>()
let current: Associations | null = null

const valid = (value: unknown): value is GitHubPrAssociation => {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<GitHubPrAssociation>
  if (
    !Number.isSafeInteger(entry.number) ||
    (entry.number ?? 0) < 1 ||
    typeof entry.title !== "string" ||
    entry.title.length > 1000 ||
    typeof entry.url !== "string"
  )
    return false
  try {
    const url = new URL(entry.url)
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      new RegExp(`^/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+/pull/${entry.number}/?$`, "u").test(url.pathname)
    )
  } catch {
    return false
  }
}

const load = (): Associations => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .slice(0, 1000)
        .map(([threadId, entries]) => [
          threadId,
          typeof threadId === "string" && threadId.length < 200 && Array.isArray(entries)
            ? entries.filter(valid).slice(0, 20)
            : [],
        ])
    )
  } catch {
    return {}
  }
}

const publish = (next: Associations) => {
  current = next
  try {
    window.localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Keep the in-memory association if storage is unavailable.
  }
  for (const listener of listeners) listener()
}

export const githubPrAssociations = {
  getSnapshot: (): Associations => (current ??= load()),
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  add: (threadId: string, association: GitHubPrAssociation) => {
    if (!threadId || threadId.length >= 200 || !valid(association))
      throw new Error("Invalid GitHub PR association")
    const existing = githubPrAssociations.getSnapshot()[threadId] ?? []
    publish({
      ...githubPrAssociations.getSnapshot(),
      [threadId]: [association, ...existing.filter((entry) => entry.url !== association.url)].slice(
        0,
        20
      ),
    })
  },
  remove: (threadId: string, url: string) => {
    const snapshot = githubPrAssociations.getSnapshot()
    publish({
      ...snapshot,
      [threadId]: (snapshot[threadId] ?? []).filter((entry) => entry.url !== url),
    })
  },
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return
    current = load()
    for (const listener of listeners) listener()
  })
}
