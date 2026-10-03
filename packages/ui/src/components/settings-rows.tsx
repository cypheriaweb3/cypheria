import type * as React from "react"

import { cn } from "#lib/utils"

/** A titled group of settings rows on a settings page. */
function SettingsSection({
  actions,
  children,
  className,
  description,
  title,
}: Readonly<{
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  description?: React.ReactNode
  title?: React.ReactNode
}>) {
  return (
    <section data-slot="settings-section" className={cn("flex flex-col gap-2", className)}>
      {title || actions ? (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <h2 className="font-medium text-sm">{title}</h2> : null}
            {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  )
}

/** One setting: its label and description on the left and its control on the right. */
function SettingsRow({
  children,
  className,
  control,
  description,
  htmlFor,
  label,
}: Readonly<{
  children?: React.ReactNode
  className?: string
  control?: React.ReactNode
  description?: React.ReactNode
  htmlFor?: string
  label: React.ReactNode
}>) {
  return (
    <div data-slot="settings-row" className={cn("flex flex-col gap-3 px-4 py-3", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label className="text-sm" htmlFor={htmlFor}>
            {label}
          </label>
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </div>
        {control ? <div className="flex shrink-0 items-center">{control}</div> : null}
      </div>
      {children}
    </div>
  )
}

export { SettingsRow, SettingsSection }
