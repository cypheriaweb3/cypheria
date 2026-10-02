import { type ReactNode, useState } from "react"
import { Button } from "#components/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "#components/command"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#components/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "#components/popover"
import { DotsHorizontalIcon, SearchIcon } from "../icons/index.js"
import type { ChatDiffStyle } from "./diff-viewer.js"

export type ChatDiffOptionsLabels = {
  menu: string
  layout: string
  auto: string
  split: string
  unified: string
  wordDiffs: string
  wrap: string
  fullFiles: string
  expandAll: string
  collapseAll: string
  copyGitApply: string
}

export type ChatDiffOptionsMenuProps = {
  labels: ChatDiffOptionsLabels
  diffStyle: ChatDiffStyle
  onDiffStyleChange: (style: ChatDiffStyle) => void
  wordDiffs: boolean
  onWordDiffsChange: (value: boolean) => void
  wrap: boolean
  onWrapChange: (value: boolean) => void
  /** Offered only when complete file contents can be loaded. */
  fullFiles?: boolean
  onFullFilesChange?: (value: boolean) => void
  onExpandAll?: () => void
  onCollapseAll?: () => void
  onCopyGitApply?: () => void
  /** Additional items placed after the built-in ones. */
  children?: ReactNode
}

/** The display options of a diff: layout, word changes, wrapping, context, and bulk actions. */
export function ChatDiffOptionsMenu({
  children,
  diffStyle,
  fullFiles,
  labels,
  onCollapseAll,
  onCopyGitApply,
  onDiffStyleChange,
  onExpandAll,
  onFullFilesChange,
  onWordDiffsChange,
  onWrapChange,
  wordDiffs,
  wrap,
}: ChatDiffOptionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label={labels.menu} size="icon-sm" title={labels.menu} variant="ghost" />
        }
      >
        <DotsHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{labels.layout}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(value) => onDiffStyleChange(value as ChatDiffStyle)}
            value={diffStyle}
          >
            <DropdownMenuRadioItem value="auto">{labels.auto}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="split">{labels.split}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="unified">{labels.unified}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={wordDiffs}
          onCheckedChange={(checked) => onWordDiffsChange(checked === true)}
        >
          {labels.wordDiffs}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={wrap}
          onCheckedChange={(checked) => onWrapChange(checked === true)}
        >
          {labels.wrap}
        </DropdownMenuCheckboxItem>
        {onFullFilesChange ? (
          <DropdownMenuCheckboxItem
            checked={fullFiles ?? false}
            onCheckedChange={(checked) => onFullFilesChange(checked === true)}
          >
            {labels.fullFiles}
          </DropdownMenuCheckboxItem>
        ) : null}
        {onExpandAll || onCollapseAll || onCopyGitApply ? <DropdownMenuSeparator /> : null}
        {onExpandAll ? (
          <DropdownMenuItem onClick={onExpandAll}>{labels.expandAll}</DropdownMenuItem>
        ) : null}
        {onCollapseAll ? (
          <DropdownMenuItem onClick={onCollapseAll}>{labels.collapseAll}</DropdownMenuItem>
        ) : null}
        {onCopyGitApply ? (
          <DropdownMenuItem onClick={onCopyGitApply}>{labels.copyGitApply}</DropdownMenuItem>
        ) : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type ChatJumpToFileProps = {
  files: readonly string[]
  labels: { trigger: string; placeholder: string; empty: string }
  onSelect: (path: string) => void
}

/** A searchable list of the changed files that moves the diff to the chosen one. */
export function ChatJumpToFile({ files, labels, onSelect }: ChatJumpToFileProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={labels.trigger}
            size="icon-sm"
            title={labels.trigger}
            variant="ghost"
          />
        }
      >
        <SearchIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={labels.placeholder} />
          <CommandList>
            <CommandEmpty>{labels.empty}</CommandEmpty>
            {files.map((path) => (
              <CommandItem
                key={path}
                onSelect={() => {
                  onSelect(path)
                  setOpen(false)
                }}
                value={path}
              >
                <span className="truncate font-mono text-xs">{path}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * A shell command that applies the patch with `git apply`, through a quoted heredoc whose
 * delimiter does not occur in the patch, so the text is passed through unchanged.
 */
export const chatGitApplyCommand = (patch: string): string => {
  const body = patch.endsWith("\n") ? patch : `${patch}\n`
  const lines = new Set(body.split("\n"))
  let delimiter = "CYPHERIA_PATCH"
  for (let index = 1; lines.has(delimiter); index += 1) delimiter = `CYPHERIA_PATCH_${index}`
  return `git apply --3way <<'${delimiter}'\n${body}${delimiter}\n`
}
