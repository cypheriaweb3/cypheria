import type { GitHubAppAvailability, GitHubAvailability } from "@cypheria/protocol"

export type GitHubPrOperation =
  | "list"
  | "read"
  | "diff"
  | "activity"
  | "checks"
  | "threads"
  | "create"
  | "write"

const appCapability: Record<Exclude<GitHubPrOperation, "write">, keyof GitHubAppAvailability> = {
  list: "canList",
  read: "canRead",
  diff: "canDiff",
  activity: "canActivity",
  checks: "canChecks",
  threads: "canThreads",
  create: "available",
}

export const githubPrProvider = (
  operation: GitHubPrOperation,
  cli: GitHubAvailability | undefined,
  app: GitHubAppAvailability | undefined,
  hasThread: boolean,
  connectorEnabled = true
): "cli" | "app" | null => {
  if (cli?.installed && cli.authenticated && cli.repository) return "cli"
  if (operation === "write" || !connectorEnabled || !hasThread || !app?.repository) return null
  return app[appCapability[operation]] ? "app" : null
}
