import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@cypheria/ui/components/native-select"
import { useState } from "react"

export type PackageSourceType = "git" | "local" | "npm"

const PLACEHOLDERS: Record<PackageSourceType, string> = {
  git: "owner/repo or https://…/plugin.git",
  local: "/path/to/plugin",
  npm: "package-name or @scope/package",
}

/** Installs one Git repository, npm package, or local directory as a standalone plugin. */
export function InstallPackageDialog({
  error,
  onInstall,
  onOpenChange,
  open,
  pending,
}: {
  error: string | null
  onInstall: (input: { source: string; sourceType: PackageSourceType }) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  pending: boolean
}) {
  const [sourceType, setSourceType] = useState<PackageSourceType>("git")
  const [source, setSource] = useState("")
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install plugin package</DialogTitle>
          <DialogDescription>
            Install a plugin that is not in a marketplace. Agents that read its format install it
            natively; you can project it into the others.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm" htmlFor="package-source-type">
          Source type
          <NativeSelect
            id="package-source-type"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as PackageSourceType)}
          >
            <NativeSelectOption value="git">Git repository</NativeSelectOption>
            <NativeSelectOption value="npm">npm package</NativeSelectOption>
            <NativeSelectOption value="local">Local directory</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="package-source">
          Source
          <Input
            id="package-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={PLACEHOLDERS[sourceType]}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!source.trim() || pending}
            onClick={() => onInstall({ source: source.trim(), sourceType })}
          >
            {pending ? "Installing…" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
