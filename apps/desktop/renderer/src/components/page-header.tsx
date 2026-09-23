import { cn } from "@cypheria/ui"
import type { HTMLAttributes } from "react"

export function PageHeader({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header
      className={cn(
        "desktop-titlebar flex h-11 min-h-11 shrink-0 items-center bg-background px-4",
        className
      )}
      data-slot="page-header"
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">{children}</div>
    </header>
  )
}
