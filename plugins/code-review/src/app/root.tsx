import { Button } from "@cypheria/ui/components/button"
import { Spinner } from "@cypheria/ui/components/spinner"
import { Trans } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { GitPullRequestIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { onHostNotification, ReadFailure } from "./bridge.js"
import { type DetailRequest, type Provider, useHostContext, useReviewAccount } from "./data.js"
import { PullRequestDetail } from "./detail/pull-request-detail.js"
import { host } from "./host.js"
import { useSidebarInbox } from "./inbox.js"
import type { InitialView, PullRequestIdentity } from "./schemas.js"
import { SettingsView } from "./settings-view.js"

/** Chooses the view the App opened with and keeps it in step with the host. */
export function Root({ initialView }: Readonly<{ initialView: InitialView }>) {
  const client = useQueryClient()
  const { settings, setup } = useHostContext()

  useEffect(
    () =>
      onHostNotification("cypheria/codeReview/settings", (params) => {
        client.setQueryData(["settings"], params.settings)
        void client.invalidateQueries({ queryKey: ["setup"] })
      }),
    [client]
  )

  if (initialView.type === "settings") return <SettingsView />
  if (setup.isLoading || settings.isLoading) return <Loading />
  if (setup.error || settings.error || !setup.data || !settings.data) {
    return <ConnectionError onRetry={() => void setup.refetch()} />
  }
  const provider: Provider = settings.data.gitHostingProvider
  if (!setup.data.chatgpt.signedIn) {
    return (
      <Onboarding
        action={
          <Button onClick={() => void host.connect("chatgpt")}>
            <Trans id="codeReview.onboarding.signIn">Sign in with ChatGPT</Trans>
          </Button>
        }
        description={
          <Trans id="codeReview.onboarding.signInDescription">
            Code Review reads pull requests through your ChatGPT account. Sign in to Codex with
            ChatGPT, then connect GitHub or GitLab.
          </Trans>
        }
      />
    )
  }
  const status = provider === "github" ? setup.data.github.status : setup.data.gitlab.status
  if (status !== "ready") {
    return (
      <Onboarding
        action={
          <div className="flex flex-col items-center gap-2">
            <Button onClick={() => void host.connect(provider).then(() => setup.refetch())}>
              {provider === "github" ? (
                <Trans id="codeReview.onboarding.setupProvider">Set up GitHub</Trans>
              ) : (
                <Trans id="codeReview.onboarding.setupGitlabBeta">Set up GitLab (beta)</Trans>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void setup.refetch()}>
              <Trans id="codex.pullRequests.inbox.checkAgain">Check again</Trans>
            </Button>
          </div>
        }
        description={
          <Trans id="codeReview.onboarding.description">
            Review code, catch issues, and make fixes with Codex
          </Trans>
        }
      />
    )
  }
  return (
    <Connected
      initialView={initialView}
      provider={provider}
      settings={settings.data}
      setup={setup.data}
    />
  )
}

function Connected({
  initialView,
  provider,
  settings,
  setup,
}: Readonly<{
  initialView: Exclude<InitialView, { type: "settings" }>
  provider: Provider
  settings: NonNullable<ReturnType<typeof useHostContext>["settings"]["data"]>
  setup: NonNullable<ReturnType<typeof useHostContext>["setup"]["data"]>
}>) {
  const review = useReviewAccount(setup, settings)
  const [selected, setSelected] = useState<PullRequestIdentity | null>(
    initialView.type === "pull_request" ? initialView.pullRequest : null
  )
  const global = initialView.type === "inbox"
  useSidebarInbox(provider, global ? review.account : null, settings, setSelected)

  useEffect(() => {
    if (global) {
      void host
        .selection()
        .then(({ pullRequest }) => {
          if (pullRequest) setSelected(pullRequest)
        })
        .catch(() => undefined)
    }
    return onHostNotification("cypheria/codeReview/select", (params) => {
      setSelected((params.pullRequest as PullRequestIdentity | null) ?? null)
    })
  }, [global])

  if (review.isLoading) return <Loading />
  if (!review.account) {
    const limited = review.error instanceof ReadFailure && review.error.kind === "rate-limit"
    return (
      <Onboarding
        action={
          <div className="flex gap-2">
            <Button onClick={() => void host.connect(provider)}>
              <Trans id="codex.pullRequests.inbox.connectGitHub">Connect GitHub</Trans>
            </Button>
          </div>
        }
        description={
          limited ? (
            <Trans id="codex.pullRequests.inbox.rateLimited">GitHub rate limit reached</Trans>
          ) : (
            <Trans id="codex.pullRequests.inbox.connectDescription">
              Connect your GitHub account, then check again.
            </Trans>
          )
        }
        title={
          <Trans id="codex.pullRequests.inbox.connectionFailed">Couldn’t connect to GitHub</Trans>
        }
      />
    )
  }
  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="font-medium text-foreground text-sm">
          <Trans id="codeReview.emptyState.title">Select a pull request</Trans>
        </p>
        <p className="text-muted-foreground text-sm">
          <Trans id="codeReview.emptyState.description">
            Choose one from the sidebar to review its changes
          </Trans>
        </p>
      </div>
    )
  }
  const request: DetailRequest = { account: review.account, provider, pullRequest: selected }
  return (
    <PullRequestDetail
      key={`${selected.hostname}/${selected.owner}/${selected.repository}/${selected.number}`}
      request={request}
      surface={global ? "global" : "thread"}
      viewerAvatarUrl={review.avatarUrl}
    />
  )
}

export function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Spinner />
    </div>
  )
}

function ConnectionError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-medium text-sm">
        <Trans id="codeReview.connectionError.title">Couldn’t load Code Review</Trans>
      </p>
      <p className="text-muted-foreground text-sm">
        <Trans id="codeReview.connectionUnavailable">
          Code Review is temporarily unavailable. Please try again shortly.
        </Trans>
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <Trans id="codeReview.connectionError.retry">Try again</Trans>
      </Button>
    </div>
  )
}

function Onboarding({
  action,
  description,
  title,
}: Readonly<{ action: React.ReactNode; description: React.ReactNode; title?: React.ReactNode }>) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <GitPullRequestIcon className="size-6" />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h1 className="font-semibold text-lg">
          {title ?? <Trans id="codeReview.onboarding.title">Code review</Trans>}
        </h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action}
    </div>
  )
}
