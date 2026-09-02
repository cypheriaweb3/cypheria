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
          <Button
            nativeButton={false}
            render={
              <a href="/settings/models">
                <Bot className="size-4" />
                Models
              </a>
            }
            size="sm"
            variant={itemVariant("models")}
          />
          <Button
            nativeButton={false}
            render={
              <a href="/settings/account">
                <LogIn className="size-4" />
                Account
              </a>
            }
            size="sm"
            variant={itemVariant("account")}
          />
          <Button
            nativeButton={false}
            render={
              <a href="/settings/appearance">
                <Palette className="size-4" />
                Appearance
              </a>
            }
            size="sm"
            variant={itemVariant("appearance")}
          />
        </nav>
        {children}
      </div>
    </main>
  )
}
