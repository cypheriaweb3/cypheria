import { Button } from "@cypheria/ui/components/button"
import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"

export function WorkbenchFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="h-screen overflow-auto bg-background px-6 py-8 max-[860px]:h-[calc(100vh-48px)]">
      <div className="mx-auto grid max-w-5xl gap-6">
        <Button
          className="justify-self-start"
          nativeButton={false}
          render={
            <a href="/">
              <ArrowLeft className="size-4" />
              Workspace
            </a>
          }
          size="sm"
          variant="ghost"
        />
        {children}
      </div>
    </main>
  )
}
