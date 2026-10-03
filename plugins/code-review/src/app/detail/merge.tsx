import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { RadioGroup, RadioGroupItem } from "@cypheria/ui/components/radio-group"
import { Trans } from "@lingui/react/macro"
import { useState } from "react"

import {
  type DetailRequest,
  githubWrite,
  gitlabWrite,
  type PullRequestModel,
  usePullRequestWrite,
} from "../data.js"

/** Confirms a merge with a method; the provider merges only if the displayed head still matches. */
export function MergeDialog({
  onOpenChange,
  open,
  pullRequest,
  request,
}: Readonly<{
  onOpenChange: (open: boolean) => void
  open: boolean
  pullRequest: PullRequestModel
  request: DetailRequest
}>) {
  const methods =
    pullRequest.allowedMergeMethods.length > 0
      ? pullRequest.allowedMergeMethods
      : ["merge" as const]
  const [method, setMethod] = useState<"merge" | "squash">(
    methods.includes("squash") ? "squash" : "merge"
  )
  const write = usePullRequestWrite(request)
  const merge = () =>
    write.mutate(
      () =>
        request.provider === "gitlab"
          ? gitlabWrite(request, "merge", {
              expectedHeadRevision: pullRequest.headRevision,
              mergeMethod: method,
            })
          : githubWrite(request, "merge", {
              expectedHeadRevision: pullRequest.headRevision,
              mergeMethod: method,
            }),
      { onSuccess: () => onOpenChange(false) }
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans id="pullRequestDetail.merge.title">Merge pull request</Trans>
          </DialogTitle>
          <DialogDescription>
            {methods.length > 1 ? (
              <Trans id="pullRequestDetail.merge.description">
                Choose a merge method and confirm.
              </Trans>
            ) : (
              <Trans id="pullRequestDetail.merge.description.singleMethod">
                Confirm the selected merge method.
              </Trans>
            )}{" "}
            {request.provider === "gitlab" ? (
              <Trans id="pullRequestDetail.merge.projectDefaultSubtitle">
                GitLab will merge only if the displayed head commit still matches
              </Trans>
            ) : (
              <Trans id="pullRequestDetail.merge.subtitle">
                GitHub will merge only if the displayed head commit still matches.
              </Trans>
            )}
          </DialogDescription>
        </DialogHeader>
        {methods.length > 1 ? (
          <RadioGroup
            value={method}
            onValueChange={(value) => setMethod(value as "merge" | "squash")}
          >
            <label className="flex items-center gap-2 text-sm" htmlFor="merge-method-squash">
              <RadioGroupItem id="merge-method-squash" value="squash" />
              <Trans id="pullRequestDetail.merge.squash">Squash</Trans>
            </label>
            <label className="flex items-center gap-2 text-sm" htmlFor="merge-method-merge">
              <RadioGroupItem id="merge-method-merge" value="merge" />
              <Trans id="pullRequestDetail.merge.commit">Merge commit</Trans>
            </label>
          </RadioGroup>
        ) : null}
        {write.error ? <p className="text-destructive text-sm">{write.error.message}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans id="pullRequestDetail.merge.cancel">Cancel</Trans>
          </Button>
          <Button disabled={write.isPending || !pullRequest.headRevision} onClick={merge}>
            {write.isPending ? (
              <Trans id="pullRequestsPage.detail.actions.merging">Merging…</Trans>
            ) : method === "squash" ? (
              <Trans id="pullRequestDetail.merge.confirmSquash">Squash and merge</Trans>
            ) : (
              <Trans id="pullRequestDetail.merge.confirmMergeCommit">Create merge commit</Trans>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
