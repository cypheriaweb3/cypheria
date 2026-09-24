export type GitHubPrAssociation = Readonly<{
  number: number
  title: string
  url: string
}>

type Associations = Readonly<Record<string, readonly GitHubPrAssociation[]>>
const key = "cypheria.git.github-pr-associations.v1"
const attachmentKey = "cypheria.git.github-pr-attachments.v1"
type AttachmentRecord = Readonly<{
  threadId: string
  url: string
  attached: boolean
  updatedAt: string
}>
const listeners = new Set<() => void>()
const serverSnapshot: Associations = {}
let current: Associations | null = null
let attachmentRecords: AttachmentRecord[] | null = null

const loadAttachmentRecords = (): AttachmentRecord[] => {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(attachmentKey) ?? "[]")
    if (!Array.isArray(value)) return []
    return value
      .filter((entry): entry is AttachmentRecord =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            typeof entry.threadId === "string" &&
            typeof entry.url === "string" &&
            typeof entry.attached === "boolean" &&
            typeof entry.updatedAt === "string"
        )
      )
      .slice(0, 5000)
  } catch {
    return []
  }
}

const updateAttachment = (threadId: string, url: string, attached: boolean) => {
  if (!attachmentRecords) attachmentRecords = loadAttachmentRecords()
  const records = attachmentRecords
  attachmentRecords = [
    { threadId, url, attached, updatedAt: new Date().toISOString() },
    ...records.filter((entry) => entry.threadId !== threadId || entry.url !== url),
  ].slice(0, 5000)
  try {
    window.localStorage.setItem(attachmentKey, JSON.stringify(attachmentRecords))
  } catch {
    // Keep the in-memory record if storage is unavailable.
  }
}

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
  getServerSnapshot: (): Associations => serverSnapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  forPullRequest: (url: string): Array<{ threadId: string; association: GitHubPrAssociation }> =>
    Object.entries(githubPrAssociations.getSnapshot()).flatMap(([threadId, entries]) =>
      entries
        .filter((association) => association.url === url)
        .map((association) => ({ threadId, association }))
    ),
  attachmentHistory: (url: string): AttachmentRecord[] => {
    if (!attachmentRecords) attachmentRecords = loadAttachmentRecords()
    return attachmentRecords.filter((entry) => entry.url === url)
  },
  add: (threadId: string, association: GitHubPrAssociation) => {
    if (!threadId || threadId.length >= 200 || !valid(association))
      throw new Error("Invalid GitHub PR association")
    const existing = githubPrAssociations.getSnapshot()[threadId] ?? []
    updateAttachment(threadId, association.url, true)
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
    updateAttachment(threadId, url, false)
    publish({
      ...snapshot,
      [threadId]: (snapshot[threadId] ?? []).filter((entry) => entry.url !== url),
    })
  },
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== attachmentKey) return
    if (event.key === key) current = load()
    else attachmentRecords = loadAttachmentRecords()
    for (const listener of listeners) listener()
  })
}
