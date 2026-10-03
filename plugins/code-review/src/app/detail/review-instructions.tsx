import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Textarea } from "@cypheria/ui/components/textarea"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useEffect, useState } from "react"

import { useHostContext, useUpdateSettings } from "../data.js"

/** Personal instructions added to every private review the user starts. */
export function ReviewInstructionsDialog({
  onOpenChange,
  onRun,
  open,
}: Readonly<{ onOpenChange: (open: boolean) => void; onRun: () => void; open: boolean }>) {
  const { i18n } = useLingui()
  const { settings } = useHostContext()
  const update = useUpdateSettings()
  const [value, setValue] = useState("")
  useEffect(() => {
    if (open) setValue(settings.data?.localReviewInstructions ?? "")
  }, [open, settings.data?.localReviewInstructions])
  const save = async (run: boolean) => {
    await update.mutateAsync({ localReviewInstructions: value })
    onOpenChange(false)
    if (run) onRun()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans id="privateReview.instructions.title">Tell Codex how to review your code</Trans>
          </DialogTitle>
        </DialogHeader>
        <Textarea
          className="min-h-40"
          placeholder={i18n._(
            msg({
              id: "privateReview.instructions.placeholder",
              message:
                "For example: I care most about the data model. Tell me where we might be overcomplicating things.",
            })
          )}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {update.error ? (
          <p className="text-destructive text-sm">
            <Trans id="privateReview.instructions.saveError">
              Could not save your instructions
            </Trans>
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => void save(false)}>
            <Trans id="privateReview.instructions.save">Save</Trans>
          </Button>
          <Button onClick={() => void save(true)}>
            <Trans id="privateReview.instructions.run">Save and run</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
