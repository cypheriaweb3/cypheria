import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { RadioGroup, RadioGroupItem } from "@cypheria/ui/components/radio-group"
import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useState } from "react"

import {
  type DetailRequest,
  githubWrite,
  gitlabWrite,
  type PullRequestModel,
  usePullRequestWrite,
} from "../data.js"

type Decision = "approve" | "comment" | "request_changes"

/** Submits a review: approve, comment, or request changes, with any pending comments. */
export function SubmitReviewDialog({
  headRevision,
  onOpenChange,
  open,
  pendingCount,
  pendingReviewId,
  pullRequest,
  request,
}: Readonly<{
  headRevision: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
  pendingCount: number
  pendingReviewId: string | undefined
  pullRequest: PullRequestModel
  request: DetailRequest
}>) {
  const { i18n } = useLingui()
  const write = usePullRequestWrite(request)
  const [decision, setDecision] = useState<Decision>("comment")
  const [body, setBody] = useState("")
  const required = decision !== "approve" && pendingCount === 0
  const submit = () =>
    write.mutate(
      () =>
        request.provider === "gitlab"
          ? gitlabWrite(request, "submit-review", {
              review: {
                body: body.trim() || null,
                event: decision,
                expectedHeadRevision: headRevision,
              },
            })
          : githubWrite(request, "submitReview", {
              body: body.trim() || null,
              event: decision,
              expectedHeadRevision: headRevision,
              ...(pendingReviewId ? { pendingReviewId } : {}),
            }),
      {
        onSuccess: () => {
          setBody("")
          onOpenChange(false)
        },
      }
    )
  const decisions: { value: Decision; label: string; description: string; disabled?: boolean }[] = [
    {
      description: i18n._(
        msg({
          id: "pullRequestSubmitReview.decision.commentDescription",
          message: "Share feedback or ask questions",
        })
      ),
      label: i18n._(msg({ id: "pullRequestSubmitReview.decision.comment", message: "Comment" })),
      value: "comment",
    },
    {
      description: i18n._(
        msg({
          id: "pullRequestSubmitReview.decision.approveDescription",
          message: "Endorse merging these changes",
        })
      ),
      disabled: pullRequest.isAuthor,
      label: i18n._(msg({ id: "pullRequestSubmitReview.decision.approve", message: "Approve" })),
      value: "approve",
    },
    {
      description: i18n._(
        msg({
          id: "pullRequestSubmitReview.decision.requestChangesDescription",
          message: "Ask for revisions before merging",
        })
      ),
      disabled: pullRequest.isAuthor,
      label: i18n._(
        msg({ id: "pullRequestSubmitReview.decision.requestChanges", message: "Request changes" })
      ),
      value: "request_changes",
    },
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans id="pullRequestSubmitReview.title">Submit review</Trans>
          </DialogTitle>
        </DialogHeader>
        {pendingCount > 0 ? (
          <p className="text-muted-foreground text-sm">
            <Trans id="pullRequestSubmitReview.pendingComments.short">
              {pendingCount} pending comments. Only visible to you until you submit.
            </Trans>
          </p>
        ) : null}
        <Textarea
          aria-label={i18n._(
            msg({ id: "pullRequestSubmitReview.comment", message: "Review comment" })
          )}
          className="min-h-28"
          placeholder={
            required
              ? i18n._(
                  msg({ id: "pullRequestSubmitReview.requiredComment", message: "Add a comment…" })
                )
              : i18n._(
                  msg({
                    id: "pullRequestSubmitReview.optionalComment",
                    message: "Optional comment",
                  })
                )
          }
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <RadioGroup
          aria-label={i18n._(
            msg({ id: "pullRequestSubmitReview.decision", message: "Review decision" })
          )}
          value={decision}
          onValueChange={(value) => setDecision(value as Decision)}
        >
          {decisions.map((option) => (
            <label
              key={option.value}
              className="flex items-start gap-2 text-sm"
              htmlFor={`review-decision-${option.value}`}
            >
              <RadioGroupItem
                className="mt-0.5"
                disabled={option.disabled}
                id={`review-decision-${option.value}`}
                value={option.value}
              />
              <span className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {write.error ? (
          <p className="text-destructive text-sm">
            {/head|commit/iu.test(write.error.message) ? (
              <Trans id="pullRequestSubmitReview.headChanged">
                New commits were pushed. Review the latest changes and try again.
              </Trans>
            ) : (
              <Trans id="pullRequestSubmitReview.error">Could not submit this review</Trans>
            )}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans id="pullRequestSubmitReview.cancel">Cancel</Trans>
          </Button>
          <Button
            disabled={write.isPending || !headRevision || (required && !body.trim())}
            onClick={submit}
          >
            <Trans id="pullRequestSubmitReview.submit">Submit</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
