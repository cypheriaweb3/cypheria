import type { GitBranch, GitRepository, GitServerMessage, GitStatus } from "@cypheria/protocol"
import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

const unwrap = <T>(message: GitServerMessage): T => {
  if (message.payload.ok) return message.payload.value as T
  const error = new Error(message.payload.error.message)
  error.name = message.payload.error.code
  throw error
}

export interface GitActions {
  discover(cwd: string, options?: RequestOptions): Promise<GitRepository>
  status(cwd: string, options?: RequestOptions): Promise<GitStatus>
  branches(cwd: string, options?: RequestOptions): Promise<GitBranch[]>
  init(cwd: string, options?: RequestOptions): Promise<GitRepository>
  createBranch(
    cwd: string,
    name: string,
    startPoint?: string,
    options?: RequestOptions
  ): Promise<string>
  checkout(
    cwd: string,
    target: string,
    stashChanges?: boolean,
    options?: RequestOptions
  ): Promise<GitStatus>
  diff(
    cwd: string,
    input?: { staged?: boolean; base?: string; paths?: string[] },
    options?: RequestOptions
  ): Promise<string>
  stage(cwd: string, paths: string[], options?: RequestOptions): Promise<void>
  unstage(cwd: string, paths: string[], options?: RequestOptions): Promise<void>
  commit(cwd: string, message: string, options?: RequestOptions): Promise<string>
  push(
    cwd: string,
    input?: { remote?: string; branch?: string; setUpstream?: boolean; forceWithLease?: boolean },
    options?: RequestOptions
  ): Promise<string>
}

export const createGitActions = (client: ServerClient): GitActions => ({
  discover: async (cwd, options) =>
    unwrap(await client.requestGit("git.discover.request", { cwd }, options)),
  status: async (cwd, options) =>
    unwrap(await client.requestGit("git.status.request", { cwd }, options)),
  branches: async (cwd, options) =>
    unwrap(await client.requestGit("git.branches.request", { cwd }, options)),
  init: async (cwd, options) =>
    unwrap(await client.requestGit("git.init.request", { cwd }, options)),
  createBranch: async (cwd, name, startPoint, options) =>
    unwrap<{ name: string }>(
      await client.requestGit("git.branch-create.request", { cwd, name, startPoint }, options)
    ).name,
  checkout: async (cwd, target, stashChanges, options) =>
    unwrap(await client.requestGit("git.checkout.request", { cwd, target, stashChanges }, options)),
  diff: async (cwd, input = {}, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit("git.diff.request", { cwd, ...input }, options)
    ).diff,
  stage: async (cwd, paths, options) => {
    unwrap(await client.requestGit("git.stage.request", { cwd, paths }, options))
  },
  unstage: async (cwd, paths, options) => {
    unwrap(await client.requestGit("git.unstage.request", { cwd, paths }, options))
  },
  commit: async (cwd, message, options) =>
    unwrap<{ commit: string }>(
      await client.requestGit("git.commit.request", { cwd, message }, options)
    ).commit,
  push: async (cwd, input = {}, options) =>
    unwrap<{ output: string }>(
      await client.requestGit("git.push.request", { cwd, ...input }, options)
    ).output,
})
