import { Button } from "@cypheria/ui/components/button"
import {
  ChatReviewDiffHost,
  type ChatReviewFileDescriptor,
  ChatReviewFileList,
  ChatReviewPanel,
  ChatReviewToolbar,
} from "@cypheria/ui/components/chat"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"

type ReviewSource = "unstaged" | "staged"

const statusKind = (code: string): ChatReviewFileDescriptor["status"] => {
  if (code.includes("?")) return "added"
  if (code.includes("D")) return "deleted"
  if (code.includes("R")) return "renamed"
  if (code.includes("A")) return "added"
  return "modified"
}

export function GitReviewPanel({ cwd, fallback }: Readonly<{ cwd: string; fallback: ReactNode }>) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [source, setSource] = useState<ReviewSource>("unstaged")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ["git", cwd, "status"],
    queryFn: async () => (await ensureCypheriaClient()).git.status(cwd),
    refetchInterval: 3_000,
    retry: false,
  })
  const entries =
    status.data?.entries.filter(({ code }) =>
      source === "staged" ? code[0] !== " " && code[0] !== "?" : code[1] !== " "
    ) ?? []
  const activePath = entries.some((entry) => entry.path === selectedPath)
    ? selectedPath
    : entries[0]?.path
  const diff = useQuery({
    enabled: Boolean(status.data && activePath),
    queryKey: ["git", cwd, "diff", source, activePath, status.data?.head, status.data?.entries],
    queryFn: async () =>
      (await ensureCypheriaClient()).git.diff(cwd, {
        staged: source === "staged",
        paths: activePath ? [activePath] : undefined,
      }),
    refetchInterval: 3_000,
    retry: false,
  })
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ["git", cwd] })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const files: ChatReviewFileDescriptor[] = entries.map((entry) => ({
    id: entry.path,
    path: entry.path,
    selected: entry.path === activePath,
    status: statusKind(entry.code),
  }))

  if (status.isError && fallback) return fallback

  return (
    <ChatReviewPanel>
      <ChatReviewToolbar>
        <Button
          onClick={() => setSource("unstaged")}
          size="sm"
          type="button"
          variant={source === "unstaged" ? "secondary" : "ghost"}
        >
          <Trans id="git.review.unstaged">Unstaged</Trans>
        </Button>
        <Button
          onClick={() => setSource("staged")}
          size="sm"
          type="button"
          variant={source === "staged" ? "secondary" : "ghost"}
        >
          <Trans id="git.review.staged">Staged</Trans>
        </Button>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {status.data?.branch ?? "HEAD"}
        </span>
      </ChatReviewToolbar>
      {status.isError ? (
        <p className="p-3 text-sm text-destructive">{status.error.message}</p>
      ) : null}
      {status.isPending ? (
        <p className="p-3 text-sm text-muted-foreground">
          <Trans id="git.review.loading">Loading repository changes…</Trans>
        </p>
      ) : null}
      {status.data && files.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">
          <Trans id="git.review.empty">No changes in this source</Trans>
        </p>
      ) : null}
      {files.length > 0 ? (
        <ChatReviewFileList files={files} onSelectFile={setSelectedPath} />
      ) : null}
      {activePath ? (
        <ChatReviewDiffHost>
          <pre className="overflow-x-auto p-3 text-xs whitespace-pre-wrap">
            {diff.data ||
              (diff.isPending
                ? i18n._(msg({ id: "git.review.diffLoading", message: "Loading diff…" }))
                : i18n._(msg({ id: "git.review.noTextDiff", message: "No text diff available" })))}
          </pre>
        </ChatReviewDiffHost>
      ) : null}
      {activePath ? (
        <div className="flex gap-2 border-t p-2">
          {source === "unstaged" ? (
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(async () => (await ensureCypheriaClient()).git.stage(cwd, [activePath]))
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.stage">Stage file</Trans>
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(async () =>
                  (await ensureCypheriaClient()).git.unstage(cwd, [activePath])
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.unstage">Unstage file</Trans>
            </Button>
          )}
        </div>
      ) : null}
      {status.data ? (
        <div className="space-y-2 border-t p-2">
          <input
            aria-label={i18n._(msg({ id: "git.review.commitMessage", message: "Commit message" }))}
            className="h-8 w-full rounded border bg-background px-2 text-sm"
            onChange={(event) => setMessage(event.target.value)}
            placeholder={i18n._(msg({ id: "git.review.commitMessage", message: "Commit message" }))}
            value={message}
          />
          <div className="flex gap-2">
            <Button
              disabled={
                busy ||
                !message.trim() ||
                !status.data.entries.some(({ code }) => code[0] !== " " && code[0] !== "?")
              }
              onClick={() =>
                void mutate(async () => {
                  await (await ensureCypheriaClient()).git.commit(cwd, message)
                  setMessage("")
                })
              }
              size="sm"
              type="button"
            >
              <Trans id="git.review.commit">Commit staged</Trans>
            </Button>
            <Button
              disabled={busy || !status.data.head}
              onClick={() => void mutate(async () => (await ensureCypheriaClient()).git.push(cwd))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trans id="git.review.push">Push</Trans>
            </Button>
          </div>
        </div>
      ) : null}
      {actionError ? <p className="p-2 text-sm text-destructive">{actionError}</p> : null}
    </ChatReviewPanel>
  )
}
