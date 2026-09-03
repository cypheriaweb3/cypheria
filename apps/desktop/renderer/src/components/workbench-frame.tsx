import type { ReactNode } from "react"

export function WorkbenchFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="h-screen overflow-auto bg-background px-6 py-8 max-[860px]:h-[calc(100vh-48px)]">
      <div className="mx-auto grid max-w-5xl gap-6">{children}</div>
    </main>
  )
}
