import { Button } from "@cypheria/ui/components/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { Folder, FolderPlus, LoaderCircle, X } from "lucide-react"
import { useEffect, useState } from "react"

import type { SidebarProjectView } from "../sidebar-data.js"

const folderName = (path: string): string => path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path

export function ProjectEditDialog({
  project,
  onDelete,
  onOpenChange,
  onSave,
}: Readonly<{
  project: SidebarProjectView | null
  onDelete: (project: SidebarProjectView) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  onSave: (project: SidebarProjectView, name: string, roots: readonly string[]) => Promise<boolean>
}>) {
  const { i18n } = useLingui()
  const [name, setName] = useState("")
  const [roots, setRoots] = useState<string[]>([])
  const [pending, setPending] = useState<"delete" | "save" | null>(null)

  useEffect(() => {
    setName(project?.name ?? "")
    setRoots(project ? [...project.roots] : [])
    setPending(null)
  }, [project])

  const addRoot = async () => {
    const result = await window.cypheria?.app.pickDirectory()
    const path = result?.path
    if (!path) return
    setRoots((current) => (current.includes(path) ? current : [...current, path]))
  }

  const setPrimary = (root: string) => {
    setRoots((current) => [root, ...current.filter((candidate) => candidate !== root)])
  }

  const submit = async () => {
    if (!project || !name.trim() || roots.length === 0) return
    setPending("save")
    try {
      await onSave(project, name.trim(), roots)
    } finally {
      setPending(null)
    }
  }

  const remove = async () => {
    if (!project) return
    setPending("delete")
    try {
      await onDelete(project)
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog open={project != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-6 rounded-[28px] p-7 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">
            <Trans id="navigation.editProject">Edit project</Trans>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="flex h-12 overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/45">
            <span className="flex w-12 shrink-0 items-center justify-center border-r text-muted-foreground">
              <Folder aria-hidden="true" size={18} />
            </span>
            <Input
              aria-label={i18n._(msg({ id: "navigation.projectName", message: "Project name" }))}
              autoFocus
              className="h-full rounded-none border-0 shadow-none focus-visible:ring-0"
              maxLength={200}
              onChange={(event) => setName(event.currentTarget.value)}
              value={name}
            />
          </div>

          <div className="grid gap-2.5">
            <div className="text-sm font-medium">
              <Trans id="chat.project.sourceFolders">Source folders</Trans>
            </div>
            <div className="overflow-hidden rounded-xl border bg-background">
              {roots.map((root, index) => (
                <div
                  className="flex min-h-14 items-center gap-3 border-b px-4 last:border-b-0"
                  key={root}
                >
                  <Folder aria-hidden="true" className="shrink-0 text-muted-foreground" size={18} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={root}>
                    {folderName(root)}
                  </span>
                  {index === 0 ? (
                    <span className="rounded-lg border px-2.5 py-1 text-xs text-muted-foreground">
                      <Trans id="chat.project.primary">Primary</Trans>
                    </span>
                  ) : (
                    <Button
                      className="h-8 rounded-lg px-3 text-xs"
                      onClick={() => setPrimary(root)}
                      type="button"
                      variant="secondary"
                    >
                      <Trans id="chat.project.setPrimary">Set as primary</Trans>
                    </Button>
                  )}
                  <Button
                    aria-label={i18n._(
                      msg({ id: "chat.project.removeFolder", message: "Remove folder" })
                    )}
                    className="size-8 shrink-0 text-muted-foreground"
                    disabled={roots.length === 1}
                    onClick={() =>
                      setRoots((current) => current.filter((candidate) => candidate !== root))
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" size={17} />
                  </Button>
                </div>
              ))}
              <button
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm font-medium outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
                onClick={() => void addRoot()}
                type="button"
              >
                <FolderPlus aria-hidden="true" className="text-muted-foreground" size={18} />
                <Trans id="chat.project.addFolder">Add folder</Trans>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <Button
            className="rounded-xl"
            disabled={pending != null}
            onClick={() => void remove()}
            type="button"
            variant="destructive"
          >
            {pending === "delete" ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            <Trans id="chat.project.removeLocalProject">Remove local project</Trans>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              disabled={pending != null}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              <Trans id="chat.cancel">Cancel</Trans>
            </Button>
            <Button
              className="min-w-24 rounded-xl"
              disabled={pending != null || !name.trim() || roots.length === 0}
              onClick={() => void submit()}
              type="button"
            >
              {pending === "save" ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              <Trans id="navigation.save">Save</Trans>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
