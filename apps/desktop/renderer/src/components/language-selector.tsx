import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@cypheria/ui/components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@cypheria/ui/components/popover"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { ChevronDown } from "lucide-react"
import { useState } from "react"
import type { LanguagePreference } from "../../../ipc/src/index.js"
import { getLanguageOptionLabel, languageOptions } from "../language-options.js"

export function LanguageSelector({
  disabled,
  onChange,
  value,
}: Readonly<{
  disabled?: boolean
  onChange: (preference: LanguagePreference) => void
  value: LanguagePreference
}>) {
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)
  const automaticLabel = i18n._(
    msg({ id: "settings.language.automatic", message: "Automatic detection" })
  )
  const selectedOption = languageOptions.find((option) => option.locale === value)
  const selectedLabel = selectedOption
    ? getLanguageOptionLabel(selectedOption, i18n.locale)
    : automaticLabel

  const select = (preference: LanguagePreference) => {
    setOpen(false)
    if (preference !== value) {
      onChange(preference)
    }
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={i18n._(msg({ id: "settings.language.label", message: "Display language" }))}
        className="inline-flex h-9 min-w-[180px] items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] gap-0 rounded-2xl p-0" sideOffset={6}>
        <Command>
          <CommandInput
            autoFocus
            placeholder={i18n._(
              msg({ id: "settings.language.search", message: "Search languages" })
            )}
          />
          <CommandList className="max-h-[460px] p-1">
            <CommandEmpty>
              {i18n._(msg({ id: "settings.language.empty", message: "No languages found" }))}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                data-checked={value === "system"}
                keywords={["system", "default", "automatic"]}
                onSelect={() => select("system")}
                value="system"
              >
                {automaticLabel}
              </CommandItem>
              {languageOptions.map((option) => (
                <CommandItem
                  data-checked={value === option.locale}
                  key={option.locale}
                  keywords={[
                    option.label,
                    option.zhLabel ?? "",
                    option.locale,
                    ...(option.searchAliases ?? []),
                  ]}
                  onSelect={() => select(option.locale)}
                  value={option.locale}
                >
                  <span dir="auto">{getLanguageOptionLabel(option, i18n.locale)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
