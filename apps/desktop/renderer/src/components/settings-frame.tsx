import { cn } from "@cypheria/ui/lib/utils"
import type { ReactNode } from "react"

export function SettingsFrame({
  children,
  wide = false,
}: Readonly<{ children: ReactNode; wide?: boolean }>) {
  return (
    <main className="h-screen min-h-0 overflow-y-auto bg-background px-6 py-10 max-[860px]:h-[calc(100vh-48px)]">
      <div className={cn("mx-auto grid w-full gap-6", wide ? "max-w-6xl" : "max-w-3xl")}>
        {children}
      </div>
    </main>
  )
}
