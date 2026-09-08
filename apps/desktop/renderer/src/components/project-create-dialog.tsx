import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Folder, FolderPlus, LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"

export function ProjectCreateDialog({
  onCreated,
  onOpenChange,
  open,
}: Readonly<{
  onCreated?: (projectId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}>) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [root, setRoot] = useState("")
  const [error, setError] = useState<string | null>(null)
  const createProject = useMutation({
    mutationFn: () => {
      const api = window.cypheria?.codex
      if (!api) throw new Error("Codex is only available in the Cypheria desktop app.")
      return api.createProject({ name: name.trim(), root })
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["codex", "projects"] })
      setName("")
      setRoot("")
      onCreated?.(project.id)
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const chooseRoot = async () => {
    const result = await window.cypheria?.codex.pickProjectRoot()
    if (!result?.path) return
    setRoot(result.path)
    if (!name.trim()) setName(result.path.split(/[\\/]/u).filter(Boolean).at(-1) ?? "Project")
  }

  const submit = async () => {
    setError(null)
    if (!name.trim() || !root) {
      setError(
        i18n._(
          msg({
            id: "task.project.validation",
            message: "Choose a folder and enter a project name.",
          })
        )
      )
      return
    }
    try {
      await createProject.mutateAsync()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl gap-6 rounded-[28px] p-7 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">
            <Trans id="task.project.create">Create project</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="flex h-12 overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/45">
            <span className="flex w-12 shrink-0 items-center justify-center border-r text-muted-foreground">
              <Folder aria-hidden="true" size={18} />
            </span>
            <Input
              aria-label={i18n._(msg({ id: "task.project.name", message: "Project name" }))}
              autoFocus
              className="h-full rounded-none border-0 shadow-none focus-visible:ring-0"
              onChange={(event) => setName(event.target.value)}
              placeholder={i18n._(
                msg({ id: "task.project.namePlaceholder", message: "Project name" })
              )}
              value={name}
            />
          </div>
          <div className="grid gap-2.5">
            <div className="text-sm font-medium">
              <Trans id="task.project.sourceFolders">Source folders</Trans>
            </div>
            <button
              className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-xl border bg-background px-5 text-center outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onClick={() => void chooseRoot()}
            >
              <FolderPlus aria-hidden="true" className="text-muted-foreground" size={22} />
              {root ? (
                <span className="max-w-full truncate text-sm font-medium">{root}</span>
              ) : (
                <span className="text-base">
                  <Trans id="task.project.addFolders">Add folders Codex can read and edit</Trans>
                </span>
              )}
            </button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button onClick={() => onOpenChange(false)} size="lg" type="button" variant="ghost">
            <Trans id="task.cancel">Cancel</Trans>
          </Button>
          <Button
            className="min-w-36 rounded-xl"
            disabled={createProject.isPending}
            onClick={() => void submit()}
            size="lg"
            type="button"
          >
            {createProject.isPending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            <Trans id="task.project.create">Create project</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
