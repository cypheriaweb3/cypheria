import { isUtf8 } from "node:buffer"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants, type FSWatcher, watch } from "node:fs"
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { AuditLogService } from "@cypheria/db"
import type {
  GitBlameLine,
  GitBranchComparison,
  GitBranchContext,
  GitBranchReview,
  GitBranchSearchResult,
  GitClientMessage,
  GitCloneState,
  GitCommitSummary,
  GitHubAppAvailability,
  GitHubAppPrChecks,
  GitHubAppPrMedia,
  GitHubAppPullRequest,
  GitHubAppPullRequestSummary,
  GitHubAvailability,
  GitHubPrAttributesFile,
  GitHubPrMetadata,
  GitHubPrReviewStatus,
  GitHubPrRevisionFile,
  GitHubPrRevisionSnapshot,
  GitHubPrStackEntry,
  GitHubPullRequest,
  GitHubPullRequestActivity,
  GitHubPullRequestChecks,
  GitHubPullRequestThreads,
  GitHubUserCandidate,
  GitIndexEntry,
  GitLabMergeRequest,
  GitLabMergeRequestChecks,
  GitLabMergeRequestDiscussion,
  GitLabMergeRequestNote,
  GitLabMrAvailability,
  GitLabReviewer,
  GitLabReviewerCandidate,
  GitOrigin,
  GitRepositoryChangedNotification,
  GitReviewFile,
  GitReviewLineCount,
  GitServerMessage,
  GitSettings,
  GitSyncedBranchState,
  GitTextBlob,
  GitWorktree,
  GitWorktreeJob,
} from "@cypheria/protocol"
import { DEFAULT_GIT_SETTINGS } from "@cypheria/protocol"
import type { AgentManager } from "../agent/agent-manager.js"
import { CodexAppToolClient } from "../codex-app-tool-client.js"
import type { ThreadManager } from "../thread/thread-manager.js"
import { GitCommandError, GitExecutor } from "./git-executor.js"
import { combineGitNumstats, parseGitNumstat } from "./git-numstat.js"
import { GitReviewUndoStore } from "./git-review-undo-store.js"
import { GitTurnDiffService } from "./git-turn-diff-service.js"
import { GitWorktreeService } from "./git-worktree-service.js"
import { GitHubAppPrService } from "./github-app-pr-service.js"
import { GitHubPrService } from "./github-pr-service.js"
import { GitLabMrService, gitLabBrowserFormUrl } from "./gitlab-mr-service.js"

export type GitRepository = {
  readonly commonGitDir: string
  readonly root: string
}

export type GitStatus = {
  readonly branch: string | null
  readonly entries: readonly { readonly code: string; readonly path: string }[]
  readonly head: string | null
  readonly repository: GitRepository
}

const trimmed = (value: string): string => value.trimEnd()
const WORKTREE_ENV_KEYS = [
  "PATH",
  "VIRTUAL_ENV",
  "CONDA_PREFIX",
  "PYENV_VERSION",
  "NPM_CONFIG_PREFIX",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "GOPATH",
] as const
const auditedOperations = new Set<GitClientMessage["type"]>([
  "git.set-config-value.request",
  "git.init.request",
  "git.branch-create.request",
  "git.checkout.request",
  "git.apply-review-section.request",
  "git.apply-review-sections.request",
  "git.apply-patch.request",
  "git.apply-changes.request",
  "git.undo-review-revert.request",
  "git.stage.request",
  "git.unstage.request",
  "git.commit.request",
  "git.push.request",
  "git.worktree-create.request",
  "git.worktree-job-start.request",
  "git.worktree-job-cancel.request",
  "git.worktree-job-retry.request",
  "git.worktree-delete.request",
  "git.worktree-restore.request",
  "git.worktree-move-thread.request",
  "git.synced-branch-sync.request",
  "git.synced-branch-undo.request",
  "git.github-app-pr-create.request",
  "git.github-pr-toggle-auto-merge.request",
  "git.github-pr-thread-action.request",
  "git.github-pr-comment.request",
  "git.github-pr-comment-action.request",
  "git.github-pr-review.request",
  "git.github-pr-set-state.request",
  "git.github-pr-create.request",
  "git.github-pr-update.request",
  "git.github-pr-reviewer.request",
  "git.github-pr-merge.request",
  "git.gitlab-mr-reviewer-action.request",
  "git.gitlab-mr-update-title.request",
  "git.gitlab-mr-post-comment.request",
  "git.gitlab-mr-create.request",
])
class GitStaleSnapshotError extends Error {}
class GitAuditUnavailableError extends Error {}
const reviewHunks = (diff: string): Array<{ header: string; patch: string }> => {
  if ((diff.match(/^diff --git /gmu)?.length ?? 0) !== 1) return []
  if (
    /^(?:new file mode|deleted file mode|rename from|rename to|copy from|copy to|Binary files|GIT binary patch)/gmu.test(
      diff
    )
  )
    return []
  const matches = [...diff.matchAll(/^@@ .+? @@.*$/gmu)]
  const first = matches[0]?.index
  if (first === undefined) return []
  const prefix = diff.slice(0, first)
  return matches.map((match, index) => {
    const start = match.index ?? first
    const end = matches[index + 1]?.index ?? diff.length
    return { header: match[0], patch: prefix + diff.slice(start, end) }
  })
}
const validateOperand = (value: string, name: string): string => {
  if (!value || value.startsWith("-") || value.includes("\0") || value.includes("\n")) {
    throw new Error(`Invalid Git ${name}`)
  }
  return value
}
const parseIndexEntries = (output: string): GitIndexEntry[] =>
  output
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^([0-7]{6}) ([a-f0-9]{40,64}) ([0-3])\t(.+)$/su.exec(record)
      if (!match) throw new Error("Git returned invalid index entries")
      return {
        mode: match[1] ?? "",
        objectId: match[2] ?? "",
        stage: Number(match[3]),
        path: match[4] ?? "",
      }
    })

export class GitService {
  readonly #executor: GitExecutor
  readonly #worktrees: GitWorktreeService
  readonly #reviewUndo: GitReviewUndoStore
  readonly #turnDiff: GitTurnDiffService
  readonly #github = new GitHubPrService()
  readonly #githubApp: GitHubAppPrService | null
  readonly #gitlab: GitLabMrService | null
  readonly #threads: ThreadManager | null
  readonly #audit: Pick<AuditLogService, "append"> | null
  readonly #agents: AgentManager | null
  readonly #codexHome: string
  readonly #getSettings: () => GitSettings
  readonly #publishChanged: ((message: GitRepositoryChangedNotification) => void) | null
  readonly #discoveryCache = new Map<string, { repository: GitRepository; expiresAt: number }>()
  readonly #watchers = new Map<
    string,
    { handles: FSWatcher[]; generation: number; timer: NodeJS.Timeout | null }
  >()
  readonly #worktreeJobs = new Map<
    string,
    {
      state: GitWorktreeJob
      cwd: string
      startPoint?: string
      includeChanges: boolean
      environmentConfigPath: string | null
      controller: AbortController
    }
  >()

  constructor(
    cacheDir: string,
    cypheriaHome: string,
    connectors?: {
      agents?: AgentManager
      threads?: ThreadManager
      audit?: Pick<AuditLogService, "append">
      publishChanged?: (message: GitRepositoryChangedNotification) => void
    },
    getSettings: () => GitSettings = () => DEFAULT_GIT_SETTINGS
  ) {
    this.#getSettings = getSettings
    this.#publishChanged = connectors?.publishChanged ?? null
    this.#agents = connectors?.agents ?? null
    this.#codexHome = join(cypheriaHome, "codex")
    this.#executor = new GitExecutor(cacheDir)
    this.#worktrees = new GitWorktreeService(
      this.#executor,
      cypheriaHome,
      getSettings().worktreeRoot
    )
    this.#reviewUndo = new GitReviewUndoStore(cypheriaHome)
    this.#turnDiff = new GitTurnDiffService(this.#executor, cypheriaHome)
    const apps = connectors?.agents ? new CodexAppToolClient(connectors.agents) : null
    this.#gitlab = apps ? new GitLabMrService(this.#executor, apps) : null
    this.#githubApp = apps ? new GitHubAppPrService(this.#executor, apps) : null
    this.#threads = connectors?.threads ?? null
    this.#audit = connectors?.audit ?? null
  }

  async handle(
    message: GitClientMessage,
    send: (message: GitServerMessage) => void
  ): Promise<boolean> {
    const type = message.type.replace(/\.request$/u, ".response") as GitServerMessage["type"]
    const audited = auditedOperations.has(message.type) && this.#audit !== null
    const audit = async (outcome: "started" | "succeeded" | "failed") => {
      await this.#audit?.append({
        actor: "local-client",
        correlationId: message.requestId,
        eventType: `${message.type.replace(/\.request$/u, "")}.${outcome}`,
        source: "git",
      })
    }
    try {
      if (audited)
        await audit("started").catch(() => {
          throw new GitAuditUnavailableError("Git audit is unavailable; no operation was started")
        })
      let value: unknown
      switch (message.type) {
        case "git.discover.request":
          value = await this.discover(message.payload.cwd)
          break
        case "git.availability.request":
          value = await this.availability(message.payload.cwd)
          break
        case "git.remotes.request":
          value = await this.remotes(message.payload.cwd)
          break
        case "git.branch-exists.request":
          value = {
            exists: await this.branchExists(
              message.payload.cwd,
              message.payload.name,
              message.payload.scope
            ),
          }
          break
        case "git.branch-commits.request":
          value = await this.branchCommits(
            message.payload.cwd,
            message.payload.ref,
            message.payload.limit
          )
          break
        case "git.origin.request":
          value = await this.origin(message.payload.cwd)
          break
        case "git.status.request":
          value = await this.status(message.payload.cwd)
          break
        case "git.branches.request":
          value = await this.branches(message.payload.cwd)
          break
        case "git.branch-search.request":
          value = await this.searchBranches(
            message.payload.cwd,
            message.payload.query,
            message.payload.limit
          )
          break
        case "git.branch-context.request":
          value = await this.branchContext(message.payload.cwd)
          break
        case "git.branch-comparison.request":
          value = await this.branchComparison(
            message.payload.cwd,
            message.payload.base,
            message.payload.head
          )
          break
        case "git.clone-state.request":
          value = await this.cloneState(message.payload.cwd)
          break
        case "git.worktree-starting-ref.request":
          value = await this.worktreeStartingRef(message.payload.cwd, message.payload.startPoint)
          break
        case "git.config-value.request":
          value = { value: await this.configValue(message.payload.cwd, message.payload.key) }
          break
        case "git.set-config-value.request":
          await this.setConfigValue(message.payload.cwd, message.payload.key, message.payload.value)
          value = { succeeded: true }
          break
        case "git.index-entries.request":
          value = await this.indexEntries(message.payload.cwd, message.payload.path)
          break
        case "git.submodule-paths.request":
          value = await this.submodulePaths(message.payload.cwd)
          break
        case "git.text-blob.request":
          value = await this.textBlob(
            message.payload.cwd,
            message.payload.revision,
            message.payload.path
          )
          break
        case "git.blame-file.request":
          value = await this.blameFile(message.payload.cwd, message.payload.path)
          break
        case "git.index-info.request":
          value = await this.indexInfo(message.payload.cwd)
          break
        case "git.init.request":
          value = await this.init(message.payload.cwd)
          break
        case "git.branch-create.request":
          value = {
            name: await this.createBranch(
              message.payload.cwd,
              message.payload.name,
              message.payload.startPoint
            ),
          }
          break
        case "git.checkout.request":
          value = await this.checkout(
            message.payload.cwd,
            message.payload.target,
            message.payload.stashChanges
          )
          break
        case "git.diff.request":
          value = { diff: await this.diff(message.payload.cwd, message.payload) }
          break
        case "git.branch-review.request":
          value = await this.branchReview(message.payload.cwd, message.payload.base)
          break
        case "git.branch-review-diff.request":
          value = { diff: await this.branchReviewDiff(message.payload.cwd, message.payload) }
          break
        case "git.commit-list.request":
          value = await this.commitList(message.payload.cwd, message.payload.limit)
          break
        case "git.commit-review.request":
          value = await this.commitReview(message.payload.cwd, message.payload.commit)
          break
        case "git.commit-review-diff.request":
          value = { diff: await this.commitReviewDiff(message.payload.cwd, message.payload) }
          break
        case "git.last-turn-review.request":
          value = await this.lastTurnReview(message.payload.cwd, message.payload.threadId)
          break
        case "git.last-turn-review-diff.request":
          value = { diff: await this.lastTurnReviewDiff(message.payload.cwd, message.payload) }
          break
        case "git.review-line-counts.request":
          value = await this.reviewLineCounts(message.payload.cwd, message.payload)
          break
        case "git.review-file.request":
          value = await this.reviewFile(
            message.payload.cwd,
            message.payload.source,
            message.payload.path,
            message.payload.ignoreWhitespace
          )
          break
        case "git.apply-review-section.request":
          value = { undoId: await this.applyReviewSection(message.payload.cwd, message.payload) }
          break
        case "git.apply-review-sections.request":
          value = await this.applyReviewSections(message.payload.cwd, message.payload.sections)
          break
        case "git.undo-review-revert.request":
          await this.undoReviewRevert(message.payload.cwd, message.payload.undoId)
          value = { succeeded: true }
          break
        case "git.review-undo-list.request":
          value = await this.reviewUndoList(message.payload.cwd)
          break
        case "git.apply-patch.request":
          value = await this.applyPatch(message.payload.cwd, message.payload)
          break
        case "git.apply-changes.request":
          value = await this.applyChanges(message.payload.cwd, message.payload)
          break
        case "git.stage.request":
          await this.stage(message.payload.cwd, message.payload.paths)
          value = { succeeded: true }
          break
        case "git.unstage.request":
          await this.unstage(message.payload.cwd, message.payload.paths)
          value = { succeeded: true }
          break
        case "git.commit.request":
          value = {
            commit: await this.commit(message.payload.cwd, message.payload.message, {
              includeUnstaged: message.payload.includeUnstaged,
              coAuthors: message.payload.coAuthors,
            }),
          }
          break
        case "git.generate-text.request":
          value = await this.generateText(
            message.payload.cwd,
            message.payload.kind,
            message.payload.base
          )
          break
        case "git.push.request":
          value = { output: await this.push(message.payload.cwd, message.payload) }
          break
        case "git.worktrees.request":
          value = await this.worktrees(message.payload.cwd)
          break
        case "git.worktree-create.request":
          value = await this.createWorktree(message.payload.cwd, message.payload.startPoint)
          break
        case "git.worktree-job-start.request":
          value = await this.startWorktreeJob(message.payload)
          break
        case "git.worktree-job-read.request":
          value = this.worktreeJob(message.payload.id)
          break
        case "git.worktree-job-cancel.request":
          value = this.cancelWorktreeJob(message.payload.id)
          break
        case "git.worktree-job-retry.request":
          value = this.retryWorktreeJob(message.payload.id, message.payload.skipSetup)
          break
        case "git.worktree-delete.request":
          await this.deleteWorktree(message.payload.cwd, message.payload.path)
          value = { succeeded: true }
          break
        case "git.worktree-restore.request":
          value = await this.restoreWorktree(message.payload.cwd, message.payload.path)
          break
        case "git.worktree-owner.request":
          value = await this.setWorktreeOwner(
            message.payload.cwd,
            message.payload.path,
            message.payload.threadId
          )
          break
        case "git.worktree-move-thread.request":
          await this.moveThreadToWorktree(
            message.payload.cwd,
            message.payload.path,
            message.payload.threadId,
            message.payload.copyChanges
          )
          value = { succeeded: true }
          break
        case "git.synced-branch-state.request":
          value = await this.syncedBranchState(message.payload.cwd, message.payload.path)
          break
        case "git.synced-branch-sync.request":
          value = {
            backupRef: await this.syncBranch(
              message.payload.cwd,
              message.payload.path,
              message.payload.expectedBranchHead,
              message.payload.expectedWorktreeHead
            ),
          }
          break
        case "git.synced-branch-undo.request":
          await this.undoSync(message.payload.cwd, message.payload.path)
          value = { succeeded: true }
          break
        case "git.github-availability.request":
          value = await this.githubAvailability(message.payload.cwd)
          break
        case "git.github-pr-board.request":
          value = await this.#github.board(message.payload.cwd, message.payload)
          break
        case "git.github-app-availability.request":
          value = await this.githubAppAvailability(message.payload.cwd, message.payload.threadId)
          break
        case "git.github-app-pr-create.request":
          value = await this.githubAppPrCreate(
            message.payload.cwd,
            message.payload.threadId,
            message.payload
          )
          break
        case "git.github-app-pr-list.request":
          value = await this.githubAppPrList(
            message.payload.cwd,
            message.payload.threadId,
            message.payload
          )
          break
        case "git.github-app-pr-read.request":
          value = await this.githubAppPrRead(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.number
          )
          break
        case "git.github-app-pr-diff.request":
          value = {
            diff: await this.githubAppPrDiff(
              message.payload.cwd,
              message.payload.threadId,
              message.payload.number,
              message.payload.expectedHead
            ),
          }
          break
        case "git.github-app-pr-activity.request":
          value = await this.githubAppPrActivity(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-app-pr-checks.request":
          value = await this.githubAppPrChecks(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-app-pr-threads.request":
          value = await this.githubAppPrThreads(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-app-pr-media.request":
          value = await this.githubAppPrMedia(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.url
          )
          break
        case "git.github-pr-list.request":
          value = await this.githubPrList(
            message.payload.cwd,
            message.payload.state,
            message.payload.limit,
            message.payload.query
          )
          break
        case "git.github-pr-read.request":
          value = await this.githubPrRead(message.payload.cwd, message.payload.number)
          break
        case "git.github-pr-for-branch.request":
          value = await this.githubPrForBranch(message.payload.cwd, message.payload.branch)
          break
        case "git.github-pr-diff.request":
          value = {
            diff: await this.githubPrDiff(
              message.payload.cwd,
              message.payload.number,
              message.payload.expectedHead
            ),
          }
          break
        case "git.github-pr-revision-snapshot.request":
          value = await this.githubPrRevisionSnapshot(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-pr-revision-diff.request":
          value = {
            diff: await this.githubPrRevisionDiff(
              message.payload.cwd,
              message.payload.number,
              message.payload.expectedHead,
              message.payload.baseRevision,
              message.payload.headRevision
            ),
          }
          break
        case "git.github-pr-revision-file.request":
          value = await this.githubPrRevisionFile(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.baseRevision,
            message.payload.headRevision,
            message.payload.basePath,
            message.payload.headPath
          )
          break
        case "git.github-pr-metadata.request":
          value = await this.githubPrMetadata(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-pr-review-status.request":
          value = await this.githubPrReviewStatus(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-pr-user-search.request":
          value = await this.githubPrUserSearch(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.query,
            message.payload.scope
          )
          break
        case "git.github-pr-stack.request":
          value = await this.githubPrStack(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-pr-attributes.request":
          value = await this.githubPrAttributes(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.paths
          )
          break
        case "git.github-pr-auto-merge-status.request":
          value = {
            enabled: await this.githubPrAutoMergeStatus(
              message.payload.cwd,
              message.payload.number
            ),
          }
          break
        case "git.github-pr-toggle-auto-merge.request":
          await this.githubPrToggleAutoMerge(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.enabled,
            message.payload.method
          )
          value = { succeeded: true }
          break
        case "git.github-pr-checks.request":
          value = await this.githubPrChecks(message.payload.cwd, message.payload.number)
          break
        case "git.github-pr-activity.request":
          value = await this.githubPrActivity(message.payload.cwd, message.payload.number)
          break
        case "git.github-pr-threads.request":
          value = await this.githubPrThreads(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead
          )
          break
        case "git.github-pr-thread-action.request":
          await this.githubPrThreadAction(message.payload.cwd, message.payload)
          value = { succeeded: true }
          break
        case "git.github-pr-comment.request":
          await this.githubPrComment(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.body
          )
          value = { succeeded: true }
          break
        case "git.github-pr-comment-action.request":
          await this.githubPrCommentAction(message.payload.cwd, message.payload)
          value = { succeeded: true }
          break
        case "git.github-pr-review.request":
          await this.githubPrReview(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.decision,
            message.payload.body
          )
          value = { succeeded: true }
          break
        case "git.github-pr-set-state.request":
          await this.githubPrSetState(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.action
          )
          value = { succeeded: true }
          break
        case "git.github-pr-create.request":
          value = await this.githubPrCreate(message.payload.cwd, message.payload)
          break
        case "git.github-pr-update.request":
          value = await this.githubPrUpdate(
            message.payload.cwd,
            message.payload.number,
            message.payload
          )
          break
        case "git.github-pr-reviewer.request":
          await this.githubPrReviewer(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.reviewer,
            message.payload.action
          )
          value = { succeeded: true }
          break
        case "git.github-pr-merge.request":
          value = await this.githubPrMerge(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.method
          )
          break
        case "git.gitlab-mr-read.request":
          value = await this.gitlabMrRead(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid
          )
          break
        case "git.gitlab-mr-availability.request":
          value = await this.gitlabMrAvailability(message.payload.cwd, message.payload.threadId)
          break
        case "git.gitlab-mr-for-branch.request":
          value = await this.gitlabMrForBranch(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.branch
          )
          break
        case "git.gitlab-mr-checks.request":
          value = await this.gitlabMrChecks(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid
          )
          break
        case "git.gitlab-mr-discussions.request":
          value = await this.gitlabMrDiscussions(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid
          )
          break
        case "git.gitlab-mr-reviewers.request":
          value = await this.gitlabMrReviewers(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid
          )
          break
        case "git.gitlab-mr-reviewer-search.request":
          value = await this.gitlabMrReviewerSearch(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.query
          )
          break
        case "git.gitlab-mr-reviewer-action.request":
          value = await this.gitlabMrReviewerAction(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid,
            message.payload.userId,
            message.payload.action
          )
          break
        case "git.gitlab-mr-update-title.request":
          value = await this.gitlabMrUpdateTitle(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid,
            message.payload.title
          )
          break
        case "git.gitlab-mr-post-comment.request":
          value = await this.gitlabMrPostComment(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid,
            message.payload.body
          )
          break
        case "git.gitlab-mr-create.request":
          value = await this.gitlabMrCreate(
            message.payload.cwd,
            message.payload.threadId,
            message.payload
          )
          break
        case "git.gitlab-mr-browser-form.request":
          value = { url: await this.gitlabMrBrowserForm(message.payload.cwd, message.payload) }
          break
      }
      const failedResult =
        value && typeof value === "object" && "status" in value && value.status === "error"
      if (auditedOperations.has(message.type) && !failedResult && "cwd" in message.payload) {
        const changed = await this.discover(message.payload.cwd).catch(() => null)
        if (changed) this.#markChanged(changed.root)
      }
      if (audited) await audit(failedResult ? "failed" : "succeeded").catch(() => undefined)
      send({ type, requestId: message.requestId, payload: { ok: true, value } } as GitServerMessage)
    } catch (error) {
      if (audited) await audit("failed").catch(() => undefined)
      send({
        type,
        requestId: message.requestId,
        payload: {
          ok: false,
          error: {
            code:
              error instanceof GitAuditUnavailableError
                ? "GIT_AUDIT_UNAVAILABLE"
                : error instanceof GitStaleSnapshotError
                  ? "GIT_STALE_SNAPSHOT"
                  : error instanceof GitCommandError
                    ? "GIT_COMMAND_FAILED"
                    : "GIT_INVALID_REQUEST",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      } as GitServerMessage)
    }
    return true
  }

  async discover(cwd: string): Promise<GitRepository> {
    const resolvedCwd = await realpath(cwd)
    const cached = this.#discoveryCache.get(resolvedCwd)
    if (cached && cached.expiresAt > Date.now()) return cached.repository
    const root = trimmed(
      (await this.#executor.run(resolvedCwd, ["rev-parse", "--show-toplevel"], { readOnly: true }))
        .stdout
    )
    const commonGitDir = trimmed(
      (
        await this.#executor.run(
          root,
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          {
            readOnly: true,
          }
        )
      ).stdout
    )
    const repository = { commonGitDir: await realpath(commonGitDir), root: await realpath(root) }
    this.#discoveryCache.set(resolvedCwd, { repository, expiresAt: Date.now() + 1000 })
    this.#ensureWatch(repository)
    return repository
  }

  stop(): void {
    for (const watcher of this.#watchers.values()) {
      if (watcher.timer) clearTimeout(watcher.timer)
      for (const handle of watcher.handles) handle.close()
    }
    this.#watchers.clear()
    this.#discoveryCache.clear()
  }

  #ensureWatch(repository: GitRepository): void {
    if (this.#watchers.has(repository.root)) return
    const handles: FSWatcher[] = []
    const changed = () => this.#markChanged(repository.root)
    for (const path of new Set([repository.root, repository.commonGitDir])) {
      try {
        const handle = watch(path, { recursive: true }, changed)
        handle.on("error", changed)
        handle.unref()
        handles.push(handle)
      } catch {
        try {
          const handle = watch(path, changed)
          handle.on("error", changed)
          handle.unref()
          handles.push(handle)
        } catch {
          /* Polling remains available when native watching is unsupported. */
        }
      }
    }
    this.#watchers.set(repository.root, { handles, generation: 0, timer: null })
  }

  #markChanged(root: string): void {
    for (const [cwd, entry] of this.#discoveryCache)
      if (entry.repository.root === root) this.#discoveryCache.delete(cwd)
    const watcher = this.#watchers.get(root)
    if (!watcher || !this.#publishChanged) return
    watcher.generation += 1
    if (watcher.timer) clearTimeout(watcher.timer)
    watcher.timer = setTimeout(() => {
      watcher.timer = null
      this.#publishChanged?.({
        type: "git.repository-changed.notification",
        payload: { root, generation: watcher.generation },
      })
    }, 60)
    watcher.timer.unref()
  }

  async origin(cwd: string): Promise<GitOrigin> {
    const { root } = await this.discover(cwd)
    let remote: string
    try {
      remote = (
        await this.#executor.run(root, ["remote", "get-url", "origin"], { readOnly: true })
      ).stdout.trim()
    } catch (error) {
      if (error instanceof GitCommandError) return { provider: "none" }
      throw error
    }
    const scp = /^git@([^:]+):/u.exec(remote)
    let hostname = scp?.[1] ?? null
    if (!hostname) {
      try {
        hostname = new URL(remote).hostname
      } catch {
        return { provider: "other" }
      }
    }
    const provider =
      hostname.toLowerCase() === "gitlab.com"
        ? "gitlab"
        : hostname.toLowerCase() === "github.com"
          ? "github"
          : "other"
    return { provider }
  }

  async availability(cwd: string): Promise<{ available: boolean; version: string | null }> {
    try {
      const version = (
        await this.#executor.run(cwd, ["--version"], { readOnly: true })
      ).stdout.trim()
      return { available: true, version }
    } catch {
      return { available: false, version: null }
    }
  }

  async remotes(cwd: string): Promise<Array<{ name: string; host: string; repository: string }>> {
    const repository = await this.discover(cwd)
    const stdout = (await this.#executor.run(repository.root, ["remote", "-v"], { readOnly: true }))
      .stdout
    const result: Array<{ name: string; host: string; repository: string }> = []
    for (const line of stdout.split("\n")) {
      const match = /^([^\t]+)\t(.+) \(fetch\)$/u.exec(line)
      if (!match) continue
      const [, name, remote] = match
      if (!name || !remote) continue
      let host: string
      let path: string
      const scp = /^[^@\s]+@([^:]+):(.+)$/u.exec(remote)
      if (scp) {
        host = scp[1] ?? ""
        path = scp[2] ?? ""
      } else {
        try {
          const url = new URL(remote)
          if (!["https:", "ssh:", "git:"].includes(url.protocol)) continue
          host = url.hostname
          path = url.pathname.replace(/^\//u, "")
        } catch {
          continue
        }
      }
      const identity = path.replace(/\.git$/iu, "")
      if (host && identity) result.push({ name, host: host.toLowerCase(), repository: identity })
    }
    return result
  }

  async branchExists(
    cwd: string,
    name: string,
    scope: "local" | "remote" | "any" = "any"
  ): Promise<boolean> {
    const repository = await this.discover(cwd)
    const branch = validateOperand(name, "branch")
    await this.#executor.run(repository.root, ["check-ref-format", `refs/heads/${branch}`], {
      readOnly: true,
    })
    const refs =
      scope === "local"
        ? [`refs/heads/${branch}`]
        : scope === "remote"
          ? [`refs/remotes/${branch}`]
          : [`refs/heads/${branch}`, `refs/remotes/${branch}`]
    for (const ref of refs) {
      if (
        await this.#executor
          .run(repository.root, ["show-ref", "--verify", "--quiet", ref], { readOnly: true })
          .then(
            () => true,
            () => false
          )
      )
        return true
    }
    return false
  }

  async worktrees(cwd: string): Promise<GitWorktree[]> {
    return this.#worktrees.list(await this.discover(cwd))
  }

  async managedShellEnvironment(cwd: string): Promise<Record<string, string> | null> {
    const repository = await this.discover(cwd).catch(() => null)
    if (!repository) return null
    return this.#worktrees.shellEnvironment(repository, repository.root)
  }

  async createWorktree(
    cwd: string,
    startPoint?: string,
    options: { includeChanges?: boolean; signal?: AbortSignal } = {}
  ): Promise<GitWorktree> {
    const repository = await this.discover(cwd)
    const created = await this.#worktrees.create(repository, startPoint, options)
    await this.cleanupManagedWorktrees(repository.root, [created.path]).catch(() => {
      // Worktree creation succeeded; cleanup can be retried later.
    })
    return created
  }

  async cleanupManagedWorktrees(
    cwd: string,
    extraProtected: readonly string[] = []
  ): Promise<string[]> {
    const settings = this.#getSettings()
    if (!settings.worktreeAutoCleanupEnabled || !this.#threads) return []
    const repository = await this.discover(cwd)
    const protectedPaths = [repository.root, ...extraProtected]
    const protectedOwnerThreadIds: string[] = []
    let cursor: string | null = null
    do {
      const page = await this.#threads.list({ archived: false, cursor, limit: 200 })
      for (const thread of page.data) {
        protectedOwnerThreadIds.push(thread.id)
        if (thread.cwd) protectedPaths.push(thread.cwd)
      }
      cursor = page.nextCursor
    } while (cursor)
    return this.#worktrees.cleanup(
      repository,
      settings.worktreeKeepCount,
      protectedPaths,
      protectedOwnerThreadIds
    )
  }

  async restoreArchivedWorktree(cwd: string): Promise<void> {
    await this.#worktrees.restoreIfArchived(cwd)
  }

  async startWorktreeJob(input: {
    cwd: string
    startPoint?: string
    includeChanges?: boolean
    environmentConfigPath?: string | null
  }): Promise<GitWorktreeJob> {
    await this.discover(input.cwd)
    if (this.#worktreeJobs.size >= 100) {
      for (const [id, job] of this.#worktreeJobs) {
        if (["ready", "failed", "cancelled"].includes(job.state.phase))
          this.#worktreeJobs.delete(id)
        if (this.#worktreeJobs.size < 100) break
      }
    }
    if (this.#worktreeJobs.size >= 100) throw new Error("Too many active worktree operations")
    const id = randomUUID()
    const job = {
      state: { id, phase: "queued" as const, path: null, error: null, log: "", worktree: null },
      cwd: input.cwd,
      startPoint: input.startPoint,
      includeChanges: input.includeChanges ?? false,
      environmentConfigPath: input.environmentConfigPath ?? null,
      controller: new AbortController(),
    }
    this.#worktreeJobs.set(id, job)
    void this.#runWorktreeJob(id, false)
    return { ...job.state }
  }

  worktreeJob(id: string): GitWorktreeJob {
    const job = this.#worktreeJobs.get(id)
    if (!job) throw new Error("Worktree operation not found")
    return { ...job.state }
  }

  cancelWorktreeJob(id: string): GitWorktreeJob {
    const job = this.#worktreeJobs.get(id)
    if (!job) throw new Error("Worktree operation not found")
    if (["queued", "creating", "setting-up"].includes(job.state.phase)) job.controller.abort()
    return { ...job.state }
  }

  retryWorktreeJob(id: string, skipSetup = false): GitWorktreeJob {
    const job = this.#worktreeJobs.get(id)
    if (!job) throw new Error("Worktree operation not found")
    if (!(["failed", "cancelled"] as string[]).includes(job.state.phase)) {
      throw new Error("Only failed or cancelled worktree operations can be retried")
    }
    job.controller = new AbortController()
    job.state = { ...job.state, phase: "queued", error: null }
    void this.#runWorktreeJob(id, skipSetup)
    return { ...job.state }
  }

  async #runWorktreeJob(id: string, skipSetup: boolean): Promise<void> {
    const job = this.#worktreeJobs.get(id)
    if (!job) return
    try {
      if (!job.state.worktree) {
        job.state = { ...job.state, phase: "creating" }
        await this.#refreshWorktreeUpstream(job)
        const worktree = await this.createWorktree(job.cwd, job.startPoint, {
          includeChanges: job.includeChanges,
          signal: job.controller.signal,
        })
        job.state = { ...job.state, path: worktree.path, worktree }
      }
      job.controller.signal.throwIfAborted()
      if (job.environmentConfigPath && !skipSetup) {
        job.state = { ...job.state, phase: "setting-up" }
        await this.#setupWorktreeJob(job)
      }
      job.controller.signal.throwIfAborted()
      job.state = { ...job.state, phase: "ready", error: null }
    } catch (error) {
      job.state = {
        ...job.state,
        phase: job.controller.signal.aborted ? "cancelled" : "failed",
        error: job.controller.signal.aborted
          ? null
          : error instanceof Error
            ? error.message
            : String(error),
      }
    }
  }

  async #refreshWorktreeUpstream(job: {
    state: GitWorktreeJob
    cwd: string
    startPoint?: string
    controller: AbortController
  }): Promise<void> {
    if (this.#getSettings().upstreamRefreshMode !== "best-effort") return
    const ref = job.startPoint
    if (!ref?.startsWith("refs/remotes/")) return
    const repository = await this.discover(job.cwd)
    validateOperand(ref, "start point")
    await this.#executor.run(repository.root, ["check-ref-format", ref], { readOnly: true })
    const remotes = (
      await this.#executor.run(repository.root, ["remote"], {
        readOnly: true,
        signal: job.controller.signal,
      })
    ).stdout
      .split("\n")
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
    const remainder = ref.slice("refs/remotes/".length)
    const remote = remotes.find((name) => remainder.startsWith(`${name}/`))
    if (!remote) return
    const branch = remainder.slice(remote.length + 1)
    if (!branch || branch === "HEAD") return
    try {
      await this.#executor.run(
        repository.root,
        ["fetch", "--no-tags", remote, `+refs/heads/${branch}:${ref}`],
        {
          signal: job.controller.signal,
          timeoutMs: 30_000,
        }
      )
      job.state = { ...job.state, log: `${job.state.log}Upstream refreshed\n`.slice(-65_536) }
    } catch {
      job.controller.signal.throwIfAborted()
      job.state = {
        ...job.state,
        log: `${job.state.log}Could not refresh upstream; using cached Git state\n`.slice(-65_536),
      }
    }
  }

  async #setupWorktreeJob(job: {
    state: GitWorktreeJob
    cwd: string
    environmentConfigPath: string | null
    controller: AbortController
  }): Promise<void> {
    const worktree = job.state.worktree
    const selected = job.environmentConfigPath
    if (!worktree || !selected) return
    const repository = await this.discover(job.cwd)
    const sourcePath = await realpath(resolve(repository.root, selected))
    const rel = relative(repository.root, sourcePath)
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Environment config must be inside the repository")
    }
    if ((await stat(sourcePath)).size > 64 * 1024)
      throw new Error("Environment config is too large")
    const targetPath = await this.#worktrees.copyEnvironmentConfig(
      repository,
      worktree.path,
      sourcePath
    )
    const config = JSON.parse(await readFile(targetPath, "utf8")) as {
      version?: unknown
      name?: unknown
      setup?: { script?: unknown; darwin?: { script?: unknown }; linux?: { script?: unknown } }
    }
    if (
      config.version !== 1 ||
      typeof config.name !== "string" ||
      !config.name.trim() ||
      typeof config.setup?.script !== "string"
    ) {
      throw new Error("Invalid worktree environment config")
    }
    const platformScript =
      process.platform === "darwin"
        ? config.setup.darwin?.script
        : process.platform === "linux"
          ? config.setup.linux?.script
          : undefined
    const script = typeof platformScript === "string" ? platformScript : config.setup.script
    if (!script.trim() || script.length > 100_000) throw new Error("Invalid worktree setup script")
    await this.setConfigValue(worktree.path, "codex.localEnvironmentConfigPath", targetPath)
    const captureDirectory = await mkdtemp(join(tmpdir(), "cypheria-worktree-env-"))
    const capturePath = join(captureDirectory, "environment")
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const captureScript = `${script}\nstatus=$?\nif [ "$status" -eq 0 ]; then env -0 > "$CYPHERIA_ENV_CAPTURE_PATH"; fi\nexit "$status"`
        const child = spawn("/bin/sh", ["-c", captureScript], {
          cwd: worktree.path,
          env: {
            ...process.env,
            CODEX_SOURCE_TREE_PATH: repository.root,
            CODEX_WORKTREE_PATH: worktree.path,
            CYPHERIA_ENV_CAPTURE_PATH: capturePath,
          },
          signal: job.controller.signal,
          stdio: ["ignore", "pipe", "pipe"],
        })
        let timedOut = false
        const timeout = setTimeout(() => {
          timedOut = true
          child.kill("SIGTERM")
        }, 5 * 60_000)
        timeout.unref()
        const append = (chunk: Buffer) => {
          job.state = { ...job.state, log: (job.state.log + chunk.toString("utf8")).slice(-65_536) }
        }
        child.stdout.on("data", append)
        child.stderr.on("data", append)
        child.on("error", (error) => {
          clearTimeout(timeout)
          rejectPromise(error)
        })
        child.on("close", (code) => {
          clearTimeout(timeout)
          timedOut
            ? rejectPromise(new Error("Worktree setup timed out"))
            : code === 0
              ? resolvePromise()
              : rejectPromise(new Error(`Worktree setup exited with code ${code}`))
        })
      })
      const captured = await readFile(capturePath).catch(() => null)
      const values: Record<string, string> = {}
      if (captured && captured.length <= 256 * 1024) {
        const environment = new Map(
          captured
            .toString("utf8")
            .split("\0")
            .filter(Boolean)
            .map((entry) => {
              const index = entry.indexOf("=")
              return [entry.slice(0, index), entry.slice(index + 1)] as const
            })
        )
        for (const key of WORKTREE_ENV_KEYS) {
          const value = environment.get(key)
          if (value && value.length <= 10_000 && value !== process.env[key]) values[key] = value
        }
      }
      await this.#worktrees.writeShellEnvironment(repository, worktree.path, values)
    } finally {
      await rm(captureDirectory, { recursive: true, force: true })
    }
  }

  async deleteWorktree(cwd: string, path: string): Promise<void> {
    await this.#worktrees.delete(await this.discover(cwd), path)
  }

  async restoreWorktree(cwd: string, path: string): Promise<GitWorktree> {
    return this.#worktrees.restore(await this.discover(cwd), path)
  }

  async setWorktreeOwner(cwd: string, path: string, threadId: string | null): Promise<GitWorktree> {
    const repository = await this.discover(cwd)
    const worktree = (await this.#worktrees.list(repository)).find((entry) => entry.path === path)
    if (!worktree?.managed) throw new Error("Path is not a managed Cypheria worktree")
    if (threadId !== null) {
      if (!worktree.active) throw new Error("Restore the worktree before assigning a thread")
      await this.#codexThreadRepository(cwd, threadId)
      const thread = await this.#threads?.get(threadId)
      if (!thread?.cwd || (await realpath(thread.cwd)) !== (await realpath(path))) {
        throw new Error("The thread is not in this worktree")
      }
    } else if (worktree.ownerThreadId && this.#threads) {
      const owner = await this.#threads.get(worktree.ownerThreadId).catch(() => null)
      if (
        owner?.cwd &&
        (await realpath(owner.cwd).catch(() => null)) === (await realpath(path).catch(() => null))
      ) {
        throw new Error("Move the owner thread before releasing this worktree")
      }
    }
    return this.#worktrees.setOwner(repository, path, threadId)
  }

  async moveThreadToWorktree(
    cwd: string,
    path: string,
    threadId: string,
    copyChanges = false
  ): Promise<void> {
    if (!this.#threads) throw new Error("A local Codex thread is required")
    const repository = await this.discover(cwd)
    await this.#codexThreadRepository(cwd, threadId)
    const thread = await this.#threads.get(threadId)
    if (!thread.cwd || thread.activeTurn || thread.pendingInteractions.length) {
      throw new Error("Finish the current turn before moving the thread")
    }
    const sourceRoot = (await this.discover(thread.cwd)).root
    const worktrees = await this.#worktrees.list(repository)
    const targetPath = await realpath(path).catch(() => path)
    const destination = worktrees.find((entry) => entry.path === targetPath)
    if (!destination?.active) throw new Error("The target is not an active Git worktree")
    const target = destination.managed ? destination : null
    if (target?.ownerThreadId && target.ownerThreadId !== threadId) {
      throw new Error("Another thread owns the target worktree")
    }
    const source = worktrees.find((entry) => entry.path === sourceRoot && entry.managed)
    if (source?.ownerThreadId && source.ownerThreadId !== threadId) {
      throw new Error("Another thread owns the source worktree")
    }
    const sourceCwd = await realpath(thread.cwd)
    const relativeCwd = relative(sourceRoot, sourceCwd)
    if (relativeCwd === ".." || relativeCwd.startsWith(`..${sep}`) || isAbsolute(relativeCwd)) {
      throw new Error("The thread working directory is outside its Git worktree")
    }
    const destinationCwd = await realpath(join(targetPath, relativeCwd)).catch(() => {
      throw new Error("The target worktree does not contain the thread's working directory")
    })
    const relativeDestination = relative(targetPath, destinationCwd)
    if (
      relativeDestination === ".." ||
      relativeDestination.startsWith(`..${sep}`) ||
      isAbsolute(relativeDestination) ||
      !(await stat(destinationCwd)).isDirectory()
    ) {
      throw new Error("The target working directory is outside its Git worktree")
    }
    if (sourceCwd === destinationCwd) {
      for (const stale of worktrees.filter(
        (entry) => entry.managed && entry.ownerThreadId === threadId && entry.path !== targetPath
      )) {
        await this.#worktrees.setOwner(repository, stale.path, null)
      }
      if (target && target.ownerThreadId !== threadId) {
        await this.#worktrees.setOwner(repository, targetPath, threadId)
      }
      await this.cleanupManagedWorktrees(repository.root, [targetPath]).catch(() => undefined)
      return
    }
    const previousCwd = thread.cwd
    if (copyChanges) await this.#worktrees.copyLocalChanges(sourceRoot, targetPath)
    await this.#threads.moveWorkingDirectory(threadId, destinationCwd)
    let targetAssigned = false
    let sourceReleased = false
    try {
      if (target) {
        await this.#worktrees.setOwner(repository, targetPath, threadId)
        targetAssigned = true
      }
      if (source?.ownerThreadId === threadId && sourceRoot !== targetPath) {
        await this.#worktrees.setOwner(repository, sourceRoot, null)
        sourceReleased = true
      }
    } catch (error) {
      const failures: unknown[] = []
      if (targetAssigned) {
        await this.#worktrees
          .setOwner(repository, targetPath, null)
          .catch((cause) => failures.push(cause))
      }
      if (sourceReleased) {
        await this.#worktrees
          .setOwner(repository, sourceRoot, threadId)
          .catch((cause) => failures.push(cause))
      }
      await this.#threads
        .moveWorkingDirectory(threadId, previousCwd)
        .catch((cause) => failures.push(cause))
      if (failures.length)
        throw new AggregateError([error, ...failures], "Git worktree handoff and rollback failed")
      throw error
    }
    await this.cleanupManagedWorktrees(repository.root, [targetPath]).catch(() => undefined)
  }

  async syncedBranchState(cwd: string, path: string): Promise<GitSyncedBranchState | null> {
    return this.#worktrees.syncedBranchState(await this.discover(cwd), path)
  }

  async syncBranch(
    cwd: string,
    path: string,
    expectedBranchHead: string,
    expectedWorktreeHead: string
  ): Promise<string> {
    return this.#worktrees.syncBranch(
      await this.discover(cwd),
      path,
      expectedBranchHead,
      expectedWorktreeHead
    )
  }

  async undoSync(cwd: string, path: string): Promise<void> {
    await this.#worktrees.undoSync(await this.discover(cwd), path)
  }

  async githubAvailability(cwd: string): Promise<GitHubAvailability> {
    return this.#github.availability((await this.discover(cwd)).root)
  }

  async githubAppAvailability(cwd: string, threadId: string): Promise<GitHubAppAvailability> {
    if (!this.#githubApp)
      return {
        available: false,
        canList: false,
        canRead: false,
        canSearchByAccount: false,
        canDiff: false,
        canActivity: false,
        canChecks: false,
        canThreads: false,
        canMedia: false,
        repository: null,
        error: "GitHub app is unavailable",
      }
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.availability(root, nativeThreadId)
  }

  async githubAppPrCreate(
    cwd: string,
    threadId: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean }
  ): Promise<{ number: number; url: string }> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.create(root, nativeThreadId, input)
  }

  async githubAppPrList(
    cwd: string,
    threadId: string,
    options: {
      state?: "open" | "closed" | "merged" | "all"
      scope?: "all" | "authored" | "reviewing"
      query?: string
      limit?: number
    } = {}
  ): Promise<{ items: GitHubAppPullRequestSummary[]; truncated: boolean }> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.list(root, nativeThreadId, options)
  }

  async githubAppPrRead(
    cwd: string,
    threadId: string,
    number: number
  ): Promise<GitHubAppPullRequest> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.read(root, nativeThreadId, number)
  }

  async githubAppPrDiff(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string
  ): Promise<string> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.diff(root, nativeThreadId, number, expectedHead)
  }

  async githubAppPrActivity(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPullRequestActivity> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.activity(root, nativeThreadId, number, expectedHead)
  }

  async githubAppPrChecks(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubAppPrChecks> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.checks(root, nativeThreadId, number, expectedHead)
  }

  async githubAppPrThreads(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPullRequestThreads> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.threads(root, nativeThreadId, number, expectedHead)
  }

  async githubAppPrMedia(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string,
    url: string
  ): Promise<GitHubAppPrMedia> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.media(root, nativeThreadId, number, expectedHead, url)
  }

  async githubPrList(
    cwd: string,
    state?: "open" | "closed" | "merged" | "all",
    limit?: number,
    query?: string
  ): Promise<GitHubPullRequest[]> {
    return this.#github.list((await this.discover(cwd)).root, state, limit, query)
  }

  async githubPrRead(cwd: string, number: number): Promise<GitHubPullRequest> {
    return this.#github.read((await this.discover(cwd)).root, number)
  }

  async githubPrForBranch(cwd: string, branch: string): Promise<GitHubPullRequest | null> {
    return this.#github.forBranch((await this.discover(cwd)).root, branch)
  }

  async githubPrDiff(cwd: string, number: number, expectedHead: string): Promise<string> {
    return this.#github.diff((await this.discover(cwd)).root, number, expectedHead)
  }

  async githubPrRevisionSnapshot(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPrRevisionSnapshot> {
    return this.#github.revisionSnapshot((await this.discover(cwd)).root, number, expectedHead)
  }

  async githubPrRevisionDiff(
    cwd: string,
    number: number,
    expectedHead: string,
    baseRevision: string,
    headRevision: string
  ): Promise<string> {
    return this.#github.revisionDiff(
      (await this.discover(cwd)).root,
      number,
      expectedHead,
      baseRevision,
      headRevision
    )
  }

  async githubPrRevisionFile(
    cwd: string,
    number: number,
    expectedHead: string,
    baseRevision: string,
    headRevision: string,
    basePath: string | null,
    headPath: string | null
  ): Promise<GitHubPrRevisionFile> {
    return this.#github.revisionFile(
      (await this.discover(cwd)).root,
      number,
      expectedHead,
      baseRevision,
      headRevision,
      basePath,
      headPath
    )
  }

  async githubPrMetadata(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPrMetadata> {
    return this.#github.metadata((await this.discover(cwd)).root, number, expectedHead)
  }

  async githubPrReviewStatus(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPrReviewStatus> {
    return this.#github.reviewStatus((await this.discover(cwd)).root, number, expectedHead)
  }

  async githubPrUserSearch(
    cwd: string,
    number: number,
    expectedHead: string,
    query: string,
    scope: "collaborators" | "mentions"
  ): Promise<GitHubUserCandidate[]> {
    return this.#github.userSearch(
      (await this.discover(cwd)).root,
      number,
      expectedHead,
      query,
      scope
    )
  }

  async githubPrStack(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPrStackEntry[]> {
    return this.#github.stack((await this.discover(cwd)).root, number, expectedHead)
  }

  async githubPrAttributes(
    cwd: string,
    number: number,
    expectedHead: string,
    paths: readonly string[]
  ): Promise<GitHubPrAttributesFile[]> {
    return this.#github.attributes((await this.discover(cwd)).root, number, expectedHead, paths)
  }

  async githubPrAutoMergeStatus(cwd: string, number: number): Promise<boolean> {
    return this.#github.autoMergeEnabled((await this.discover(cwd)).root, number)
  }

  async githubPrToggleAutoMerge(
    cwd: string,
    number: number,
    expectedHead: string,
    enabled: boolean,
    method: "merge" | "squash"
  ): Promise<void> {
    await this.#github.toggleAutoMerge(
      (await this.discover(cwd)).root,
      number,
      expectedHead,
      enabled,
      method
    )
  }

  async githubPrChecks(cwd: string, number: number): Promise<GitHubPullRequestChecks> {
    return this.#github.checks((await this.discover(cwd)).root, number)
  }

  async githubPrActivity(cwd: string, number: number): Promise<GitHubPullRequestActivity> {
    return this.#github.activity((await this.discover(cwd)).root, number)
  }

  async githubPrThreads(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPullRequestThreads> {
    return this.#github.threads((await this.discover(cwd)).root, number, expectedHead)
  }

  async githubPrThreadAction(
    cwd: string,
    input: {
      number: number
      expectedHead: string
      action: "reply" | "resolve" | "unresolve" | "inline"
      threadId?: string
      body?: string
      path?: string
      line?: number
      side?: "LEFT" | "RIGHT"
    }
  ): Promise<void> {
    await this.#github.threadAction((await this.discover(cwd)).root, input)
  }

  async githubPrComment(
    cwd: string,
    number: number,
    expectedHead: string,
    body: string
  ): Promise<void> {
    await this.#github.comment((await this.discover(cwd)).root, number, expectedHead, body)
  }

  async githubPrCommentAction(
    cwd: string,
    input: {
      number: number
      expectedHead: string
      nodeId: string
      commentType: "comment" | "review" | "review_comment"
      action: "update" | "delete"
      body?: string
    }
  ): Promise<void> {
    await this.#github.commentAction((await this.discover(cwd)).root, input)
  }

  async githubPrReview(
    cwd: string,
    number: number,
    expectedHead: string,
    decision: "approve" | "comment" | "request_changes",
    body: string
  ): Promise<void> {
    await this.#github.review((await this.discover(cwd)).root, number, expectedHead, decision, body)
  }

  async githubPrSetState(
    cwd: string,
    number: number,
    expectedHead: string,
    action: "close" | "reopen" | "ready" | "draft"
  ): Promise<void> {
    await this.#github.setState((await this.discover(cwd)).root, number, expectedHead, action)
  }

  async githubPrCreate(
    cwd: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean }
  ): Promise<GitHubPullRequest> {
    return this.#github.create((await this.discover(cwd)).root, input)
  }

  async githubPrUpdate(
    cwd: string,
    number: number,
    input: { expectedHead: string; title?: string; body?: string }
  ): Promise<GitHubPullRequest> {
    return this.#github.update((await this.discover(cwd)).root, number, input)
  }

  async githubPrReviewer(
    cwd: string,
    number: number,
    expectedHead: string,
    reviewer: string,
    action: "add" | "remove"
  ): Promise<void> {
    await this.#github.reviewer(
      (await this.discover(cwd)).root,
      number,
      expectedHead,
      reviewer,
      action
    )
  }

  async githubPrMerge(
    cwd: string,
    number: number,
    expectedHead: string,
    method: "merge" | "squash"
  ): Promise<GitHubPullRequest> {
    return this.#github.merge((await this.discover(cwd)).root, number, expectedHead, method)
  }

  async gitlabMrRead(cwd: string, threadId: string, iid: number): Promise<GitLabMergeRequest> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.read(root, nativeThreadId, iid)
  }

  async gitlabMrAvailability(cwd: string, threadId: string): Promise<GitLabMrAvailability> {
    if (!this.#gitlab) throw new Error("GitLab app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#gitlab.availability(root, nativeThreadId)
  }

  async gitlabMrForBranch(
    cwd: string,
    threadId: string,
    branch: string
  ): Promise<GitLabMergeRequest | null> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.forBranch(root, nativeThreadId, branch)
  }

  async gitlabMrChecks(
    cwd: string,
    threadId: string,
    iid: number
  ): Promise<GitLabMergeRequestChecks> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.checks(root, nativeThreadId, iid)
  }

  async gitlabMrDiscussions(
    cwd: string,
    threadId: string,
    iid: number
  ): Promise<GitLabMergeRequestDiscussion[]> {
    if (!this.#gitlab) throw new Error("GitLab app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#gitlab.discussions(root, nativeThreadId, iid)
  }

  async gitlabMrReviewers(cwd: string, threadId: string, iid: number): Promise<GitLabReviewer[]> {
    if (!this.#gitlab) throw new Error("GitLab app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#gitlab.reviewers(root, nativeThreadId, iid)
  }

  async gitlabMrReviewerSearch(
    cwd: string,
    threadId: string,
    query: string
  ): Promise<GitLabReviewerCandidate[]> {
    if (!this.#gitlab) throw new Error("GitLab app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#gitlab.searchReviewers(root, nativeThreadId, query)
  }

  async gitlabMrReviewerAction(
    cwd: string,
    threadId: string,
    iid: number,
    userId: number,
    action: "add" | "remove"
  ): Promise<GitLabReviewer[]> {
    if (!this.#gitlab) throw new Error("GitLab app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#gitlab.reviewerAction(root, nativeThreadId, iid, userId, action)
  }

  async gitlabMrUpdateTitle(
    cwd: string,
    threadId: string,
    iid: number,
    title: string
  ): Promise<GitLabMergeRequest> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.updateTitle(root, nativeThreadId, iid, title)
  }

  async gitlabMrPostComment(
    cwd: string,
    threadId: string,
    iid: number,
    body: string
  ): Promise<GitLabMergeRequestNote> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.postComment(root, nativeThreadId, iid, body)
  }

  async gitlabMrCreate(
    cwd: string,
    threadId: string,
    input: {
      sourceBranch: string
      targetBranch?: string
      title: string
      description: string
      draft?: boolean
    }
  ): Promise<GitLabMergeRequest> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.create(root, nativeThreadId, input)
  }

  async gitlabMrBrowserForm(
    cwd: string,
    input: { sourceBranch: string; title: string; description: string }
  ): Promise<string> {
    return gitLabBrowserFormUrl(this.#executor, (await this.discover(cwd)).root, input)
  }

  async #gitlabThread(
    cwd: string,
    threadId: string
  ): Promise<{ service: GitLabMrService; root: string; nativeThreadId: string }> {
    if (!this.#gitlab) throw new Error("GitLab connector is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return { service: this.#gitlab, root, nativeThreadId }
  }

  async #codexThreadRepository(
    cwd: string,
    threadId: string
  ): Promise<{ root: string; nativeThreadId: string }> {
    if (!this.#threads) throw new Error("A local Codex thread is required")
    const thread = await this.#threads.get(threadId)
    if (thread.agentId !== "codex" || !thread.agentSessionId || !thread.cwd) {
      throw new Error("A local Codex thread is required")
    }
    const repository = await this.discover(cwd)
    const threadRepository = await this.discover(thread.cwd)
    if (threadRepository.commonGitDir !== repository.commonGitDir) {
      throw new Error("The Codex thread belongs to another Git repository")
    }
    return { root: repository.root, nativeThreadId: thread.agentSessionId }
  }

  async init(cwd: string): Promise<GitRepository> {
    const existing = await this.discover(cwd).catch(() => null)
    if (existing) throw new Error(`Directory is already in Git repository ${existing.root}`)
    await this.#executor.run(cwd, ["init", "--initial-branch=main"])
    return this.discover(cwd)
  }

  async branchContext(cwd: string): Promise<GitBranchContext> {
    const { root } = await this.discover(cwd)
    const current =
      (
        await this.#executor.run(root, ["branch", "--show-current"], { readOnly: true })
      ).stdout.trim() || null
    const optional = async (args: string[]): Promise<string | null> => {
      try {
        return (await this.#executor.run(root, args, { readOnly: true })).stdout.trim() || null
      } catch (error) {
        if (error instanceof GitCommandError) return null
        throw error
      }
    }
    const upstream = current
      ? await optional(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
      : null
    const upstreamRemote = upstream?.split("/")[0]
    const remote = upstreamRemote || "origin"
    const remoteHead = await optional([
      "symbolic-ref",
      "--quiet",
      "--short",
      `refs/remotes/${remote}/HEAD`,
    ])
    let defaultBranch = remoteHead
    if (!defaultBranch) {
      for (const ref of [`${remote}/main`, `${remote}/master`, "main", "master"]) {
        const fullRef = ref.includes("/") ? `refs/remotes/${ref}` : `refs/heads/${ref}`
        const exists = await this.#executor
          .run(root, ["show-ref", "--verify", "--quiet", fullRef], { readOnly: true })
          .then(
            () => true,
            () => false
          )
        if (exists) {
          defaultBranch = ref
          break
        }
      }
    }
    let ahead = 0
    let behind = 0
    if (upstream) {
      const counts = (
        await this.#executor.run(
          root,
          ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
          {
            readOnly: true,
          }
        )
      ).stdout.trim()
      const [left, right] = counts.split(/\s+/u).map(Number)
      if (
        left === undefined ||
        right === undefined ||
        !Number.isSafeInteger(left) ||
        !Number.isSafeInteger(right) ||
        left < 0 ||
        right < 0
      ) {
        throw new Error("Git returned invalid ahead/behind counts")
      }
      ahead = left
      behind = right
    }
    return { current, upstream, defaultBranch, ahead, behind }
  }

  async branchComparison(cwd: string, base: string, head = "HEAD"): Promise<GitBranchComparison> {
    const { root } = await this.discover(cwd)
    const resolveCommit = async (ref: string): Promise<string> =>
      trimmed(
        (
          await this.#executor.run(
            root,
            [
              "rev-parse",
              "--verify",
              "--end-of-options",
              `${validateOperand(ref, "ref")}^{commit}`,
            ],
            { readOnly: true }
          )
        ).stdout
      )
    const baseCommit = await resolveCommit(base)
    const headCommit = await resolveCommit(head)
    const mergeBase = trimmed(
      (await this.#executor.run(root, ["merge-base", baseCommit, headCommit], { readOnly: true }))
        .stdout
    )
    const counts = (
      await this.#executor.run(
        root,
        ["rev-list", "--left-right", "--count", `${baseCommit}...${headCommit}`],
        { readOnly: true }
      )
    ).stdout.trim()
    const [behindText, aheadText] = counts.split(/\s+/u)
    const behind = Number(behindText)
    const ahead = Number(aheadText)
    if (
      !/^\d+$/u.test(behindText ?? "") ||
      !/^\d+$/u.test(aheadText ?? "") ||
      !Number.isSafeInteger(behind) ||
      !Number.isSafeInteger(ahead)
    ) {
      throw new Error("Git returned invalid branch comparison counts")
    }
    const { stdout } = await this.#executor.run(
      root,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--numstat",
        "-z",
        mergeBase,
        headCommit,
      ],
      { readOnly: true }
    )
    return {
      base: baseCommit,
      head: headCommit,
      mergeBase,
      ahead,
      behind,
      files: parseGitNumstat(stdout),
    }
  }

  async cloneState(cwd: string): Promise<GitCloneState> {
    const { root } = await this.discover(cwd)
    const shallow =
      (
        await this.#executor.run(root, ["rev-parse", "--is-shallow-repository"], { readOnly: true })
      ).stdout.trim() === "true"
    const remotes = (
      await this.#executor.run(root, ["config", "--get-regexp", "^remote\\..*\\.promisor$"], {
        readOnly: true,
        allowExitCodes: [1],
      })
    ).stdout
    const promisorRemote =
      remotes
        .split("\n")
        .map((line) => /^remote\.(.+)\.promisor\s+true$/iu.exec(line)?.[1] ?? null)
        .find((name) => name !== null) ?? null
    const partialClone = (
      await this.#executor.run(root, ["config", "--get", "extensions.partialClone"], {
        readOnly: true,
        allowExitCodes: [1],
      })
    ).stdout.trim()
    return { shallow, partial: promisorRemote !== null || partialClone.length > 0, promisorRemote }
  }

  async worktreeStartingRef(
    cwd: string,
    startPoint: string
  ): Promise<{ ref: string; commit: string }> {
    const { root } = await this.discover(cwd)
    const input = validateOperand(startPoint, "start point")
    const commit = (
      await this.#executor.run(
        root,
        ["rev-parse", "--verify", "--end-of-options", `${input}^{commit}`],
        { readOnly: true }
      )
    ).stdout.trim()
    const symbolic = (
      await this.#executor.run(
        root,
        ["rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", input],
        { readOnly: true, allowExitCodes: [1] }
      )
    ).stdout.trim()
    return { ref: symbolic || commit, commit }
  }

  async configValue(cwd: string, key: "codex.localEnvironmentConfigPath"): Promise<string | null> {
    const { root } = await this.discover(cwd)
    if (key !== "codex.localEnvironmentConfigPath") throw new Error("Unsupported Git config key")
    const enabled = (
      await this.#executor.run(root, ["config", "--local", "--get", "extensions.worktreeConfig"], {
        readOnly: true,
        allowExitCodes: [1],
      })
    ).stdout.trim()
    if (enabled !== "true") return null
    const { stdout } = await this.#executor.run(root, ["config", "--worktree", "--get", key], {
      readOnly: true,
      allowExitCodes: [1],
    })
    return stdout ? stdout.trimEnd() : null
  }

  async setConfigValue(
    cwd: string,
    key: "codex.localEnvironmentConfigPath",
    value: string | null
  ): Promise<void> {
    const { root } = await this.discover(cwd)
    if (key !== "codex.localEnvironmentConfigPath") throw new Error("Unsupported Git config key")
    if (value !== null && (value.length > 4096 || /[\0\r\n]/u.test(value)))
      throw new Error("Invalid Git config value")
    await this.#executor.run(root, ["config", "--local", "extensions.worktreeConfig", "true"])
    if (value === null) {
      await this.#executor.run(root, ["config", "--worktree", "--unset-all", key], {
        allowExitCodes: [5],
      })
    } else {
      await this.#executor.run(root, ["config", "--worktree", "--replace-all", key, value])
    }
  }

  async indexEntries(cwd: string, path: string): Promise<GitIndexEntry[]> {
    const { root } = await this.discover(cwd)
    const safePath = this.#historicalPath(root, path)
    const { stdout } = await this.#executor.run(
      root,
      ["ls-files", "--stage", "-z", "--", safePath],
      { readOnly: true }
    )
    return parseIndexEntries(stdout).filter((entry) => entry.path === safePath)
  }

  async submodulePaths(cwd: string): Promise<string[]> {
    const { root } = await this.discover(cwd)
    const { stdout } = await this.#executor.run(root, ["ls-files", "--stage", "-z"], {
      readOnly: true,
    })
    return parseIndexEntries(stdout)
      .filter((entry) => entry.mode === "160000" && entry.stage === 0)
      .map((entry) => entry.path)
  }

  async textBlob(cwd: string, revision: string, path: string): Promise<GitTextBlob> {
    if (!/^[a-f0-9]{40,64}$/iu.test(revision)) throw new Error("Invalid Git revision")
    const { root } = await this.discover(cwd)
    const safePath = this.#historicalPath(root, path)
    const object = trimmed(
      (
        await this.#executor.run(
          root,
          ["rev-parse", "--verify", "--end-of-options", `${revision}:${safePath}`],
          { readOnly: true }
        )
      ).stdout
    )
    if (!/^[a-f0-9]{40,64}$/iu.test(object)) throw new Error("Git returned an invalid object")
    const kind = trimmed(
      (await this.#executor.run(root, ["cat-file", "-t", object], { readOnly: true })).stdout
    )
    if (kind !== "blob") return { status: "unavailable" }
    const size = Number(
      trimmed(
        (await this.#executor.run(root, ["cat-file", "-s", object], { readOnly: true })).stdout
      )
    )
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Git returned invalid blob size")
    if (size > 1024 * 1024) return { status: "unavailable" }
    const bytes = await this.#executor.readBlob(root, object, 1024 * 1024)
    if (bytes.length !== size || bytes.includes(0) || !isUtf8(bytes))
      return { status: "unavailable" }
    return { status: "success", content: bytes.toString("utf8") }
  }

  async blameFile(cwd: string, path: string): Promise<GitBlameLine[]> {
    const { root } = await this.discover(cwd)
    const safePath = this.#historicalPath(root, path)
    const { stdout } = await this.#executor.run(
      root,
      ["blame", "--line-porcelain", "--", safePath],
      { readOnly: true }
    )
    const lines: GitBlameLine[] = []
    let current: GitBlameLine | null = null
    for (const line of stdout.split("\n")) {
      const header = /^(?:\^)?([a-f0-9]{40,64}) \d+ (\d+)(?: \d+)?$/u.exec(line)
      if (header) {
        current = {
          commitSha: header[1] ?? "",
          lineNumber: Number(header[2]),
          author: null,
          authorLogin: null,
          authorTime: null,
          summary: null,
        }
      } else if (current && line.startsWith("\t")) {
        lines.push(current)
        current = null
        if (lines.length > 10_000) throw new Error("Git blame exceeds the line limit")
      } else if (current) {
        if (line.startsWith("author ")) current.author = line.slice(7) || null
        else if (line.startsWith("author-mail ")) {
          const email = line.slice(12).replace(/^<|>$/gu, "")
          current.authorLogin =
            /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/iu.exec(email)?.[1] ?? null
        } else if (line.startsWith("author-time ")) {
          const time = Number(line.slice(12))
          current.authorTime = Number.isSafeInteger(time) && time >= 0 ? time : null
        } else if (line.startsWith("summary ")) current.summary = line.slice(8) || null
      }
    }
    if (current) throw new Error("Git returned incomplete blame data")
    return lines
  }

  async indexInfo(cwd: string): Promise<{ lastModified: number }> {
    const { root } = await this.discover(cwd)
    const indexPath = trimmed(
      (
        await this.#executor.run(
          root,
          ["rev-parse", "--path-format=absolute", "--git-path", "index"],
          { readOnly: true }
        )
      ).stdout
    )
    const info = await stat(indexPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    return { lastModified: info ? Math.max(0, info.mtimeMs) : 0 }
  }

  async createBranch(cwd: string, name: string, startPoint?: string): Promise<string> {
    const repository = await this.discover(cwd)
    const branch = validateOperand(name, "branch")
    await this.#executor.run(repository.root, ["check-ref-format", "--branch", branch], {
      readOnly: true,
    })
    let start: string | undefined
    if (startPoint) {
      const ref = validateOperand(startPoint, "start point")
      start = (
        await this.#executor.run(
          repository.root,
          ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
          { readOnly: true }
        )
      ).stdout.trim()
    }
    await this.#executor.run(repository.root, ["branch", "--", branch, ...(start ? [start] : [])])
    return branch
  }

  async checkout(cwd: string, target: string, stashChanges = false): Promise<GitStatus> {
    const repository = await this.discover(cwd)
    const ref = validateOperand(target, "checkout target")
    const explicitRemote = ref.startsWith("refs/remotes/")
    const shortRemote = explicitRemote ? ref.slice("refs/remotes/".length) : ref
    const previous = await this.status(repository.root)
    if (previous.entries.length > 0 && !stashChanges) {
      throw new Error("Working tree has changes; choose stashChanges to preserve them")
    }
    const stashBefore = stashChanges ? await this.#stashHead(repository.root) : null
    if (stashChanges && previous.entries.length > 0) {
      await this.#executor.run(repository.root, [
        "stash",
        "push",
        "--include-untracked",
        "-m",
        "Cypheria branch checkout",
      ])
    }
    const stashAfter = stashChanges ? await this.#stashHead(repository.root) : null
    const createdStash = stashAfter !== null && stashAfter !== stashBefore
    try {
      const local = explicitRemote
        ? false
        : await this.#executor
            .run(repository.root, ["show-ref", "--verify", "--quiet", `refs/heads/${ref}`], {
              readOnly: true,
            })
            .then(
              () => true,
              () => false
            )
      if (local) {
        await this.#executor.run(repository.root, ["switch", "--", ref])
      } else if (!explicitRemote && /^[a-f0-9]{40,64}$/iu.test(ref)) {
        await this.#executor.run(repository.root, ["switch", "--detach", ref])
      } else {
        const remote = await this.#executor
          .run(
            repository.root,
            ["show-ref", "--verify", "--quiet", `refs/remotes/${shortRemote}`],
            {
              readOnly: true,
            }
          )
          .then(
            () => true,
            () => false
          )
        if (remote) {
          await this.#executor.run(repository.root, ["switch", "--track", shortRemote])
        } else if (explicitRemote) {
          throw new Error("Remote branch does not exist")
        } else {
          await this.#executor.run(repository.root, ["switch", "--guess", "--", ref])
        }
      }
    } catch (error) {
      if (createdStash) {
        try {
          await this.#executor.run(repository.root, ["stash", "pop", "--index"])
        } catch (restoreError) {
          throw new Error(
            `Checkout failed and saved changes need recovery from stash ${stashAfter}: ${String(restoreError)}`,
            { cause: error }
          )
        }
      }
      throw error
    }
    if (createdStash) {
      try {
        await this.#executor.run(repository.root, ["stash", "pop", "--index"])
      } catch (error) {
        throw new Error(
          `Branch changed, but saved changes need recovery from stash ${stashAfter}: ${String(error)}`,
          { cause: error }
        )
      }
    }
    return this.status(repository.root)
  }

  async #stashHead(root: string): Promise<string | null> {
    return this.#executor
      .run(root, ["rev-parse", "--verify", "refs/stash"], { readOnly: true })
      .then(
        ({ stdout }) => stdout.trim(),
        () => null
      )
  }

  async status(cwd: string): Promise<GitStatus> {
    const repository = await this.discover(cwd)
    const [porcelain, head, branch] = await Promise.all([
      this.#executor.run(
        repository.root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        {
          readOnly: true,
        }
      ),
      this.#executor.run(repository.root, ["rev-parse", "HEAD"], { readOnly: true }).then(
        ({ stdout }) => stdout.trim(),
        () => null
      ),
      this.#executor
        .run(repository.root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { readOnly: true })
        .then(
          ({ stdout }) => stdout.trim(),
          () => null
        ),
    ])
    const records = porcelain.stdout.split("\0")
    const entries: { code: string; path: string }[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (!record) continue
      const code = record.slice(0, 2)
      const path = record.slice(3)
      if (!path) continue
      entries.push({ code, path })
      if (code.includes("R") || code.includes("C")) index += 1
    }
    return { branch, entries, head, repository }
  }

  async diff(
    cwd: string,
    input: {
      staged?: boolean
      base?: string
      paths?: readonly string[]
      ignoreWhitespace?: boolean
    } = {}
  ): Promise<string> {
    const repository = await this.discover(cwd)
    if (!input.staged && !input.base && input.paths?.length === 1) {
      const [path] = await this.#paths(repository.root, input.paths)
      if (!path) throw new Error("Untracked Git path is unavailable")
      if (
        (await this.status(repository.root)).entries.some(
          (entry) => entry.code === "??" && entry.path === path
        )
      ) {
        const file = await lstat(resolve(repository.root, path))
        if (!file.isFile()) throw new Error("Untracked Git diff requires a regular file")
        return (
          await this.#executor.run(
            repository.root,
            [
              "diff",
              "--no-index",
              "--no-ext-diff",
              "--no-textconv",
              "--no-color",
              ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
              "--",
              "/dev/null",
              path,
            ],
            { readOnly: true, allowExitCodes: [1] }
          )
        ).stdout
      }
    }
    const args = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    ]
    if (input.ignoreWhitespace) args.push("--ignore-all-space")
    if (input.staged) args.push("--cached")
    if (input.base) args.push(validateOperand(input.base, "base"))
    if (input.paths?.length) args.push("--", ...(await this.#paths(repository.root, input.paths)))
    return (await this.#executor.run(repository.root, args, { readOnly: true })).stdout
  }

  async reviewLineCounts(
    cwd: string,
    input: {
      source: "unstaged" | "staged" | "uncommitted" | "branch" | "commit" | "last-turn"
      base?: string
      head?: string
      ignoreWhitespace?: boolean
    }
  ): Promise<GitReviewLineCount[]> {
    const repository = await this.discover(cwd)
    const prefix = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--numstat",
      "-z",
      ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
    ]
    const run = async (refs: readonly string[]) =>
      parseGitNumstat(
        (await this.#executor.run(repository.root, [...prefix, ...refs], { readOnly: true })).stdout
      )
    if (input.source === "staged") return run(["--cached"])
    if (input.source === "unstaged") return run([])
    if (input.source === "uncommitted") {
      const head = (await this.status(repository.root)).head
      if (head) return run([head])
      return combineGitNumstats(await Promise.all([run(["--cached"]), run([])]))
    }
    if (
      !input.base ||
      !input.head ||
      !/^[a-f0-9]{40,64}$/iu.test(input.base) ||
      !/^[a-f0-9]{40,64}$/iu.test(input.head)
    )
      throw new Error("A pinned Git review snapshot is required")
    return run([input.base, input.head])
  }

  async branchReview(cwd: string, base: string): Promise<GitBranchReview> {
    const repository = await this.discover(cwd)
    const reference = validateOperand(base, "base branch")
    const head = trimmed(
      (
        await this.#executor.run(repository.root, ["rev-parse", "--verify", "HEAD"], {
          readOnly: true,
        })
      ).stdout
    )
    const baseCommit = trimmed(
      (
        await this.#executor.run(
          repository.root,
          ["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`],
          { readOnly: true }
        )
      ).stdout
    )
    const mergeBase = trimmed(
      (
        await this.#executor.run(repository.root, ["merge-base", head, baseCommit], {
          readOnly: true,
        })
      ).stdout
    )
    const { stdout } = await this.#executor.run(
      repository.root,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--name-status",
        "-z",
        mergeBase,
        head,
      ],
      { readOnly: true }
    )
    const records = stdout.split("\0")
    const entries: GitBranchReview["entries"][number][] = []
    for (let index = 0; index < records.length - 1; index += 2) {
      const code = records[index]
      const path = records[index + 1]
      if (!code || !path) continue
      if (code !== "A" && code !== "M" && code !== "D" && code !== "T" && code !== "U") {
        throw new Error(`Unexpected Git branch diff status: ${code}`)
      }
      entries.push({ code, path })
    }
    return { base: mergeBase, head, entries }
  }

  async branchReviewDiff(
    cwd: string,
    input: { base: string; expectedHead: string; path: string; ignoreWhitespace?: boolean }
  ): Promise<string> {
    const repository = await this.discover(cwd)
    if (
      !/^[a-f0-9]{40,64}$/iu.test(input.base) ||
      !/^[a-f0-9]{40,64}$/iu.test(input.expectedHead)
    ) {
      throw new Error("Invalid Git review snapshot")
    }
    const currentHead = trimmed(
      (
        await this.#executor.run(repository.root, ["rev-parse", "--verify", "HEAD"], {
          readOnly: true,
        })
      ).stdout
    )
    if (currentHead !== input.expectedHead) {
      throw new GitStaleSnapshotError("Branch changed; refresh the review")
    }
    const path = this.#historicalPath(repository.root, input.path)
    return (
      await this.#executor.run(
        repository.root,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
          input.base,
          input.expectedHead,
          "--",
          path,
        ],
        { readOnly: true }
      )
    ).stdout
  }

  async commitList(cwd: string, limit = 30): Promise<GitCommitSummary[]> {
    return this.branchCommits(cwd, "HEAD", limit)
  }

  async branchCommits(cwd: string, ref: string, limit = 30): Promise<GitCommitSummary[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid Git commit limit")
    const repository = await this.discover(cwd)
    const resolvedRef = trimmed(
      (
        await this.#executor.run(
          repository.root,
          [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${validateOperand(ref, "branch ref")}^{commit}`,
          ],
          { readOnly: true }
        )
      ).stdout
    )
    const { stdout } = await this.#executor.run(
      repository.root,
      ["log", "-z", `-${limit}`, "--format=%H%x00%s%x00%aI", resolvedRef],
      { readOnly: true }
    )
    const values = stdout.split("\0")
    const commits: GitCommitSummary[] = []
    for (let index = 0; index + 2 < values.length; index += 3) {
      const [id, subject, date] = values.slice(index, index + 3)
      if (!id || subject === undefined || !date) continue
      commits.push({ id, subject, date })
    }
    return commits
  }

  async commitReview(cwd: string, commit: string): Promise<GitBranchReview> {
    if (!/^[a-f0-9]{40,64}$/iu.test(commit)) throw new Error("Invalid Git commit")
    const repository = await this.discover(cwd)
    const head = trimmed(
      (
        await this.#executor.run(
          repository.root,
          ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`],
          { readOnly: true }
        )
      ).stdout
    )
    const lineage = trimmed(
      (
        await this.#executor.run(repository.root, ["rev-list", "--parents", "-n", "1", head], {
          readOnly: true,
        })
      ).stdout
    ).split(" ")
    const base =
      lineage[1] ??
      trimmed(
        (
          await this.#executor.run(repository.root, ["hash-object", "-t", "tree", "/dev/null"], {
            readOnly: true,
          })
        ).stdout
      )
    const { stdout } = await this.#executor.run(
      repository.root,
      ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", base, head],
      { readOnly: true }
    )
    const values = stdout.split("\0")
    const entries: GitBranchReview["entries"][number][] = []
    for (let index = 0; index + 1 < values.length; index += 2) {
      const code = values[index]
      const path = values[index + 1]
      if (!code || !path) continue
      if (code !== "A" && code !== "M" && code !== "D" && code !== "T" && code !== "U")
        throw new Error(`Unexpected Git commit diff status: ${code}`)
      entries.push({ code, path })
    }
    return { base, head, entries }
  }

  async commitReviewDiff(
    cwd: string,
    input: { base: string; commit: string; path: string; ignoreWhitespace?: boolean }
  ): Promise<string> {
    const review = await this.commitReview(cwd, input.commit)
    if (review.base !== input.base || review.head !== input.commit)
      throw new GitStaleSnapshotError("Commit review changed; refresh the review")
    const repository = await this.discover(cwd)
    const path = this.#historicalPath(repository.root, input.path)
    return (
      await this.#executor.run(
        repository.root,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
          review.base,
          review.head,
          "--",
          path,
        ],
        { readOnly: true }
      )
    ).stdout
  }

  async turnCaptureStart(threadId: string, cwd: string): Promise<string> {
    const repository = await this.discover(cwd)
    return this.#turnDiff.start(threadId, repository.root, repository.commonGitDir)
  }

  async turnCaptureComplete(captureId: string, turnId: string): Promise<void> {
    await this.#turnDiff.complete(captureId, turnId)
  }

  async turnCaptureDiscard(captureId: string): Promise<void> {
    await this.#turnDiff.discard(captureId)
  }

  async lastTurnReview(cwd: string, threadId: string): Promise<GitBranchReview | null> {
    const repository = await this.discover(cwd)
    return this.#turnDiff.review(threadId, repository.root, repository.commonGitDir)
  }

  async lastTurnReviewDiff(
    cwd: string,
    input: {
      threadId: string
      base: string
      head: string
      path: string
      ignoreWhitespace?: boolean
    }
  ): Promise<string> {
    const repository = await this.discover(cwd)
    await this.#turnDiff.assertSnapshot(
      input.threadId,
      repository.root,
      repository.commonGitDir,
      input.base,
      input.head
    )
    const path = this.#historicalPath(repository.root, input.path)
    return (
      await this.#executor.run(
        repository.root,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
          input.base,
          input.head,
          "--",
          path,
        ],
        { readOnly: true }
      )
    ).stdout
  }

  async reviewFile(
    cwd: string,
    source: "staged" | "unstaged",
    path: string,
    ignoreWhitespace = false
  ): Promise<GitReviewFile> {
    const repository = await this.discover(cwd)
    const [safePath] = await this.#paths(repository.root, [path])
    if (!safePath) throw new Error("Invalid Git review path")
    const [status, rawDiff, index] = await Promise.all([
      this.status(repository.root),
      this.diff(repository.root, { staged: source === "staged", paths: [safePath] }),
      this.#executor.run(repository.root, ["ls-files", "--stage", "-z", "--", safePath], {
        readOnly: true,
      }),
    ])
    const absolute = resolve(repository.root, safePath)
    const file = await lstat(absolute).catch(() => null)
    const content = createHash("sha256")
    if (file?.isFile()) {
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Git review file changed")
        for await (const chunk of handle.createReadStream({ autoClose: false }))
          content.update(chunk)
      } finally {
        await handle.close()
      }
    } else if (file?.isSymbolicLink()) {
      content.update(await readlink(absolute))
    } else {
      content.update("missing")
    }
    const revision = createHash("sha256")
      .update(
        `${source}\0${safePath}\0${status.head ?? ""}\0${index.stdout}\0${content.digest("hex")}\0${rawDiff}`
      )
      .digest("hex")
    const diff = ignoreWhitespace
      ? await this.diff(repository.root, {
          staged: source === "staged",
          paths: [safePath],
          ignoreWhitespace: true,
        })
      : rawDiff
    return {
      source,
      path: safePath,
      diff,
      revision,
      hunks: ignoreWhitespace
        ? []
        : reviewHunks(diff).map((hunk, index) => ({ index, header: hunk.header })),
    }
  }

  async applyReviewSection(
    cwd: string,
    input: {
      source: "staged" | "unstaged"
      path: string
      revision: string
      action: "stage" | "unstage" | "revert"
      hunkIndex?: number
    }
  ): Promise<string | null> {
    if (
      (input.action === "stage" && input.source !== "unstaged") ||
      (input.action === "unstage" && input.source !== "staged") ||
      (input.action === "revert" && input.source !== "unstaged")
    ) {
      throw new Error("Invalid Git review action for source")
    }
    const snapshot = await this.reviewFile(cwd, input.source, input.path)
    if (snapshot.revision !== input.revision) {
      throw new GitStaleSnapshotError("File changed; refresh the review")
    }
    if (!snapshot.diff) throw new Error("There are no changes in this file")
    if (input.action === "revert") {
      const repository = await this.discover(cwd)
      const absolute = resolve(repository.root, snapshot.path)
      const undoId = await this.#reviewUndo.capture(
        repository.commonGitDir,
        absolute,
        snapshot.revision
      )
      let applied = false
      try {
        if (
          (await this.reviewFile(cwd, "unstaged", snapshot.path)).revision !== snapshot.revision
        ) {
          throw new GitStaleSnapshotError("File changed; refresh the review")
        }
        if (input.hunkIndex === undefined) {
          const untracked = (await this.status(cwd)).entries.some(
            (entry) => entry.code === "??" && entry.path === snapshot.path
          )
          if (untracked) await rm(absolute)
          else
            await this.#executor.run(repository.root, [
              "restore",
              "--worktree",
              "--",
              snapshot.path,
            ])
        } else {
          const hunk = reviewHunks(snapshot.diff)[input.hunkIndex]
          if (!hunk) throw new Error("This Git review section cannot be applied")
          await this.#applyReviewPatch(repository.root, hunk.patch, false, true)
        }
        applied = true
        const after = await this.reviewFile(cwd, "unstaged", snapshot.path)
        await this.#reviewUndo.complete(undoId, after.revision)
        return undoId
      } catch (error) {
        if (!applied) await this.#reviewUndo.discard(undoId)
        else throw new Error(`Revert applied; recovery ID: ${undoId}`, { cause: error })
        throw error
      }
    }
    if (input.hunkIndex === undefined) {
      if (input.action === "stage") await this.stage(cwd, [snapshot.path])
      else await this.unstage(cwd, [snapshot.path])
      return null
    }
    const hunk = reviewHunks(snapshot.diff)[input.hunkIndex]
    if (!hunk) throw new Error("This Git review section cannot be applied")
    await this.#applyReviewPatch(
      (await this.discover(cwd)).root,
      hunk.patch,
      true,
      input.action === "unstage"
    )
    return null
  }

  async applyReviewSections(
    cwd: string,
    sections: readonly {
      source: "staged" | "unstaged"
      path: string
      revision: string
      action: "stage" | "unstage" | "revert"
      hunkIndex?: number
    }[]
  ): Promise<
    Array<{
      path: string
      status: "applied" | "stale" | "conflict" | "skipped" | "failed"
      undoId: string | null
      error: string | null
    }>
  > {
    if (sections.length < 1 || sections.length > 100)
      throw new Error("Invalid review section count")
    await this.discover(cwd)
    const results: Array<{
      path: string
      status: "applied" | "stale" | "conflict" | "skipped" | "failed"
      undoId: string | null
      error: string | null
    }> = []
    for (const section of sections) {
      try {
        const undoId = await this.applyReviewSection(cwd, section)
        results.push({ path: section.path, status: "applied", undoId, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status =
          error instanceof GitStaleSnapshotError
            ? "stale"
            : message === "There are no changes in this file"
              ? "skipped"
              : /patch does not apply|conflict/iu.test(message)
                ? "conflict"
                : "failed"
        results.push({ path: section.path, status, undoId: null, error: message })
      }
    }
    return results
  }

  async undoReviewRevert(cwd: string, undoId: string): Promise<void> {
    const repository = await this.discover(cwd)
    const record = await this.#reviewUndo.read(undoId)
    if (record.commonGitDir !== repository.commonGitDir) {
      throw new Error("Git review undo belongs to another repository")
    }
    const path = relative(repository.root, record.path)
    await this.#paths(repository.root, [path])
    const current = await this.reviewFile(repository.root, "unstaged", path)
    await this.#reviewUndo.restore(undoId, repository.commonGitDir, current.revision)
  }

  async reviewUndoList(
    cwd: string
  ): Promise<Array<{ id: string; path: string; createdAt: string }>> {
    const repository = await this.discover(cwd)
    const records = await this.#reviewUndo.list(repository.commonGitDir)
    return records
      .filter(({ path }) => {
        const relativePath = relative(repository.root, path)
        return (
          relativePath &&
          relativePath !== ".." &&
          !relativePath.startsWith(`..${sep}`) &&
          !isAbsolute(relativePath)
        )
      })
      .map(({ id, path, createdAt }) => ({ id, path: relative(repository.root, path), createdAt }))
  }

  async applyChanges(
    cwd: string,
    input: { sourceHeadRef: string; sourceTreeRef: string; destinationHeadRef: string }
  ) {
    const repository = await this.discover(cwd)
    const head = trimmed(
      (await this.#executor.run(repository.root, ["rev-parse", "HEAD"], { readOnly: true })).stdout
    )
    if (head !== input.destinationHeadRef)
      throw new GitStaleSnapshotError("Destination changed; refresh before applying changes")
    const base = trimmed(
      (
        await this.#executor.run(
          repository.root,
          ["merge-base", input.sourceHeadRef, input.destinationHeadRef],
          { readOnly: true }
        )
      ).stdout
    )
    const diff = (
      await this.#executor.run(
        repository.root,
        [
          "diff",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          "--no-textconv",
          base,
          input.sourceTreeRef,
        ],
        { readOnly: true }
      )
    ).stdout
    if (!diff)
      return {
        status: "success" as const,
        appliedPaths: [],
        skippedPaths: [],
        conflictedPaths: [],
        error: null,
      }
    return this.applyPatch(cwd, { diff, target: "unstaged", allowBinary: true })
  }

  async applyPatch(
    cwd: string,
    input: {
      diff: string
      target: "unstaged" | "staged" | "staged-and-unstaged"
      atomic?: boolean
      reverse?: boolean
      allowBinary?: boolean
    }
  ) {
    const repository = await this.discover(cwd)
    if (!input.diff || Buffer.byteLength(input.diff) > 32 * 1024 * 1024)
      throw new Error("Invalid Git patch size")
    const paths = [...input.diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)]
      .flatMap((match) => [match[1], match[2]])
      .filter((value): value is string => Boolean(value && value !== "/dev/null"))
    if (!paths.length) throw new Error("Git patch has no file changes")
    for (const path of new Set(paths)) {
      const safe = this.#historicalPath(repository.root, path)
      let parent = dirname(resolve(repository.root, safe))
      while (parent !== repository.root) {
        const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null
          throw error
        })
        if (info?.isSymbolicLink() || (info && !info.isDirectory()))
          throw new Error("Git patch path has an unsafe parent")
        parent = dirname(parent)
      }
    }
    const directory = await mkdtemp(join(tmpdir(), "cypheria-git-patch-"))
    const patchFile = join(directory, "changes.patch")
    const indexFile = join(directory, "index")
    try {
      await writeFile(patchFile, input.diff, { mode: 0o600 })
      const temporaryIndex = input.target === "unstaged" && !input.atomic
      const env = temporaryIndex ? { GIT_INDEX_FILE: indexFile } : undefined
      if (temporaryIndex) {
        await this.#executor.run(repository.root, ["read-tree", "HEAD"], { env })
        const existing = await Promise.all(
          [...new Set(paths)].map(async (path) =>
            (await stat(resolve(repository.root, path)).catch(() => null)) !== null ? path : null
          )
        )
        if (existing.some(Boolean))
          await this.#executor.run(
            repository.root,
            ["add", "--", ...existing.filter((path): path is string => path !== null)],
            { env }
          )
      }
      const args = [
        "apply",
        ...(input.reverse ? ["--reverse"] : []),
        ...(input.allowBinary ? ["--binary"] : []),
        ...(!input.atomic ? ["--3way"] : []),
        ...(input.target === "staged"
          ? ["--cached"]
          : input.target === "staged-and-unstaged"
            ? ["--index"]
            : []),
        "--",
        patchFile,
      ]
      if (input.atomic)
        await this.#executor.run(repository.root, ["apply", "--check", ...args.slice(1)], { env })
      const before = (
        await this.#executor.run(repository.root, ["status", "--porcelain=v1", "-z"], {
          readOnly: true,
        })
      ).stdout
      try {
        await this.#executor.run(repository.root, args, { env })
        return {
          status: "success" as const,
          appliedPaths: [...new Set(paths)],
          skippedPaths: [],
          conflictedPaths: [],
          error: null,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const after = (
          await this.#executor.run(repository.root, ["status", "--porcelain=v1", "-z"], {
            readOnly: true,
          })
        ).stdout
        const uniquePaths = [...new Set(paths)]
        const mentionedConflicts = uniquePaths.filter(
          (path) =>
            message.includes(`Merge conflict in ${path}`) ||
            message.includes(`${path}: patch does not apply`) ||
            message.includes(`patch failed: ${path}:`)
        )
        const conflictedPaths = mentionedConflicts.length
          ? mentionedConflicts
          : /conflict|patch does not apply/iu.test(message)
            ? uniquePaths
            : []
        const entryFor = (output: string, path: string) =>
          output.split("\0").find((entry) => entry.slice(3) === path) ?? null
        const appliedPaths =
          before !== after
            ? uniquePaths.filter(
                (path) =>
                  !conflictedPaths.includes(path) &&
                  entryFor(before, path) !== entryFor(after, path)
              )
            : []
        return {
          status:
            (appliedPaths.length || (conflictedPaths.length && before !== after)) && !input.atomic
              ? ("partial-success" as const)
              : ("error" as const),
          appliedPaths,
          skippedPaths: uniquePaths.filter(
            (path) => !appliedPaths.includes(path) && !conflictedPaths.includes(path)
          ),
          conflictedPaths,
          error: message,
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async #applyReviewPatch(
    root: string,
    patch: string,
    cached: boolean,
    reverse: boolean
  ): Promise<void> {
    const result = await this.applyPatch(root, {
      diff: patch,
      target: cached ? "staged" : "unstaged",
      reverse,
      allowBinary: true,
    })
    if (result.status !== "success") throw new Error(result.error || "Git review patch failed")
  }

  async stage(cwd: string, paths: readonly string[]): Promise<void> {
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, [
      "add",
      "--",
      ...(await this.#paths(repository.root, paths)),
    ])
  }

  async unstage(cwd: string, paths: readonly string[]): Promise<void> {
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, [
      "restore",
      "--staged",
      "--",
      ...(await this.#paths(repository.root, paths)),
    ])
  }

  async commit(
    cwd: string,
    message: string,
    options: { includeUnstaged?: boolean; coAuthors?: readonly string[] } = {}
  ): Promise<string> {
    if (!message.trim()) throw new Error("Commit message is required")
    const repository = await this.discover(cwd)
    const coAuthors = options.coAuthors ?? []
    if (
      coAuthors.length > 20 ||
      coAuthors.some((author) => !author.trim() || author.length > 200 || /[\r\n\0]/u.test(author))
    ) {
      throw new Error("Invalid commit co-author")
    }
    const commitMessage = `${message.trim()}${coAuthors.length ? `\n\n${coAuthors.map((author) => `Co-authored-by: ${author.trim()}`).join("\n")}` : ""}`
    if (options.includeUnstaged) await this.#executor.run(repository.root, ["add", "-A"])
    await this.#executor.run(repository.root, ["commit", "-m", commitMessage])
    return trimmed(
      (await this.#executor.run(repository.root, ["rev-parse", "HEAD"], { readOnly: true })).stdout
    )
  }

  async generateText(
    cwd: string,
    kind: "commit" | "pull-request",
    base?: string
  ): Promise<{ title: string; body: string }> {
    if (!this.#agents) throw new Error("Codex is unavailable for Git text generation")
    const repository = await this.discover(cwd)
    const baseName = kind === "pull-request" ? validateOperand(base ?? "HEAD", "base") : null
    const baseRef = baseName
      ? await this.#executor
          .run(
            repository.root,
            ["rev-parse", "--verify", "--end-of-options", `${baseName}^{commit}`],
            { readOnly: true }
          )
          .then(
            ({ stdout }) => stdout.trim(),
            async () =>
              (
                await this.#executor.run(
                  repository.root,
                  [
                    "rev-parse",
                    "--verify",
                    "--end-of-options",
                    `refs/remotes/origin/${baseName}^{commit}`,
                  ],
                  { readOnly: true }
                )
              ).stdout.trim()
          )
      : null
    const diff =
      kind === "commit"
        ? [
            (
              await this.#executor.run(
                repository.root,
                ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"],
                { readOnly: true }
              )
            ).stdout,
            (
              await this.#executor.run(
                repository.root,
                ["diff", "--binary", "--no-ext-diff", "--no-textconv"],
                { readOnly: true }
              )
            ).stdout,
          ].join("\n")
        : (
            await this.#executor.run(
              repository.root,
              ["diff", "--binary", "--no-ext-diff", "--no-textconv", `${baseRef}...HEAD`],
              { readOnly: true }
            )
          ).stdout
    const status = kind === "commit" ? await this.status(cwd) : null
    if (!diff && !status?.entries.length) throw new Error("There are no changes to describe")
    const directory = await mkdtemp(join(tmpdir(), "cypheria-git-generate-"))
    const outputPath = join(directory, "output.json")
    const schemaPath = join(directory, "schema.json")
    try {
      await writeFile(
        schemaPath,
        JSON.stringify({
          type: "object",
          properties: { title: { type: "string" }, body: { type: "string" } },
          required: ["title", "body"],
          additionalProperties: false,
        }),
        { mode: 0o600 }
      )
      const instructions =
        kind === "commit"
          ? this.#getSettings().commitInstructions
          : this.#getSettings().prInstructions
      const prompt = [
        kind === "commit"
          ? "Write a concise Git commit subject. Put it in title; body may be empty."
          : "Write a pull request title and body describing this branch's changes.",
        "Return only JSON matching the supplied schema. Do not modify files.",
        instructions ? `Additional instructions:\n${instructions}` : "",
        status
          ? `Git status:\n${status.entries.map((entry) => `${entry.code} ${entry.path}`).join("\n")}`
          : "",
        `Diff (truncated to 64 KiB):\n${diff.slice(0, 65_536)}`,
      ]
        .filter(Boolean)
        .join("\n\n")
      const spec = await this.#agents.authTerminalSpec(
        "codex",
        [
          "exec",
          "--ephemeral",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          "-",
        ],
        { CODEX_HOME: this.#codexHome }
      )
      await new Promise<void>((resolve, reject) => {
        const child = spawn(spec.command, spec.args, {
          cwd: repository.root,
          env: { ...spec.env, CODEX_HOME: this.#codexHome },
          stdio: ["pipe", "ignore", "pipe"],
          windowsHide: true,
        })
        let stderr = ""
        const timer = setTimeout(() => child.kill(), 120_000)
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-16_384)
        })
        child.on("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          if (code === 0) resolve()
          else reject(new Error(stderr.trim() || `Codex text generation failed (${code})`))
        })
        child.stdin.end(prompt)
      })
      const generated = JSON.parse(await readFile(outputPath, "utf8")) as {
        title?: unknown
        body?: unknown
      }
      if (
        typeof generated.title !== "string" ||
        !generated.title.trim() ||
        typeof generated.body !== "string" ||
        generated.title.length > 500 ||
        generated.body.length > 100_000
      )
        throw new Error("Codex returned invalid Git text")
      return { title: generated.title.trim(), body: generated.body.trim() }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async push(
    cwd: string,
    input: {
      remote?: string
      branch?: string
      setUpstream?: boolean
      forceWithLease?: boolean
    } = {}
  ): Promise<string> {
    const repository = await this.discover(cwd)
    const args = ["push", "--porcelain"]
    if (input.forceWithLease ?? this.#getSettings().alwaysForcePush) args.push("--force-with-lease")
    if (input.setUpstream) args.push("-u")
    if (input.remote) args.push(validateOperand(input.remote, "remote"))
    if (input.branch) args.push(validateOperand(input.branch, "branch"))
    return (await this.#executor.run(repository.root, args, { timeoutMs: 120_000 })).stdout
  }

  async branches(
    cwd: string
  ): Promise<readonly { name: string; current: boolean; commit: string }[]> {
    const repository = await this.discover(cwd)
    const { stdout } = await this.#executor.run(
      repository.root,
      ["for-each-ref", "--format=%(HEAD)%00%(refname:short)%00%(objectname)%00", "refs/heads"],
      { readOnly: true }
    )
    const branches: { name: string; current: boolean; commit: string }[] = []
    for (const line of stdout.split("\n")) {
      const [head, name, commit] = line.split("\0")
      if (!name) continue
      branches.push({ current: head?.trim() === "*", name, commit: commit ?? "" })
    }
    return branches
  }

  async searchBranches(cwd: string, query: string, limit = 20): Promise<GitBranchSearchResult[]> {
    if (query.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Invalid Git branch search")
    }
    const repository = await this.discover(cwd)
    const { stdout } = await this.#executor.run(
      repository.root,
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(HEAD)%00%(refname)%00%(objectname)%00",
        "refs/heads",
        "refs/remotes",
      ],
      { readOnly: true }
    )
    const matches: GitBranchSearchResult[] = []
    const needle = query.toLocaleLowerCase()
    for (const line of stdout.split("\n")) {
      const [head, ref, commit] = line.split("\0")
      if (!ref || !commit || ref.endsWith("/HEAD")) continue
      const scope = ref.startsWith("refs/heads/") ? "local" : "remote"
      const name = ref.slice(scope === "local" ? "refs/heads/".length : "refs/remotes/".length)
      if (!name.toLocaleLowerCase().includes(needle)) continue
      matches.push({ name, current: head?.trim() === "*", commit, scope })
      if (matches.length >= limit) break
    }
    return matches
  }

  async #paths(root: string, paths: readonly string[]): Promise<string[]> {
    if (paths.length === 0) throw new Error("At least one path is required")
    return await Promise.all(
      paths.map(async (path) => {
        if (!path || path.includes("\0")) throw new Error("Invalid Git path")
        const absolute = resolve(root, path)
        const relativePath = relative(root, absolute)
        if (
          relativePath === ".." ||
          relativePath.startsWith(`..${sep}`) ||
          isAbsolute(relativePath)
        ) {
          throw new Error("Git path is outside the repository")
        }
        const parent = dirname(absolute)
        const parentInfo = await stat(parent).catch(() => null)
        if (!parentInfo?.isDirectory()) throw new Error("Git path parent is unavailable")
        const actualParent = await realpath(parent)
        const actualRelative = relative(root, actualParent)
        if (
          actualRelative === ".." ||
          actualRelative.startsWith(`..${sep}`) ||
          isAbsolute(actualRelative)
        ) {
          throw new Error("Git path resolves outside the repository")
        }
        return relativePath || "."
      })
    )
  }

  #historicalPath(root: string, path: string): string {
    if (!path || path.includes("\0")) throw new Error("Invalid Git path")
    const relativePath = relative(root, resolve(root, path))
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath) ||
      relativePath === ""
    ) {
      throw new Error("Git path is outside the repository")
    }
    return relativePath
  }
}
