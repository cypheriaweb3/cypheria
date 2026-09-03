import type { ReactNode } from "react"

export function SettingsFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="h-screen min-h-0 overflow-y-auto bg-background px-6 py-10 max-[860px]:h-[calc(100vh-48px)]">
      <div className="mx-auto grid w-full max-w-3xl gap-6">{children}</div>
    </main>
  )
}
