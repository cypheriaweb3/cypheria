import { Button } from "@cypheria/ui/components/button"
import { ArrowLeft, Bot, LogIn, Palette } from "lucide-react"
import type { ReactNode } from "react"

type SettingsSection = "account" | "appearance" | "models"

export function SettingsFrame({
  active,
  children,
}: Readonly<{ active: SettingsSection; children: ReactNode }>) {
  const itemVariant = (section: SettingsSection) => (active === section ? "secondary" : "ghost")

  return (
    <main className="h-screen overflow-auto bg-background px-6 py-8 max-[860px]:h-[calc(100vh-48px)]">
      <div className="mx-auto grid max-w-3xl gap-6">
        <nav className="flex flex-wrap items-center gap-2">
          <Button
            render={
              <a href="/">
                <span className="sr-only">Workspace</span>
              </a>
            }
            size="sm"
            variant="ghost"
          >
            <ArrowLeft className="size-4" />
            Workspace
          </Button>
          <Button
            render={
              <a href="/settings/models">
                <span className="sr-only">Models</span>
              </a>
            }
            size="sm"
            variant={itemVariant("models")}
          >
            <Bot className="size-4" />
            Models
          </Button>
          <Button
            render={
              <a href="/settings/account">
                <span className="sr-only">Account</span>
              </a>
            }
            size="sm"
            variant={itemVariant("account")}
          >
            <LogIn className="size-4" />
            Account
          </Button>
          <Button
            render={
              <a href="/settings/appearance">
                <span className="sr-only">Appearance</span>
              </a>
            }
            size="sm"
            variant={itemVariant("appearance")}
          >
            <Palette className="size-4" />
            Appearance
          </Button>
        </nav>
        {children}
      </div>
    </main>
  )
}
