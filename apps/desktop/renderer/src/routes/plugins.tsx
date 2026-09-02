import { Badge } from "@cypheria/ui/components/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@cypheria/ui/components/card"
import { createFileRoute } from "@tanstack/react-router"
import { Boxes, PlugZap } from "lucide-react"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/plugins")({ component: PluginsRoute })

function PluginsRoute() {
  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Boxes className="size-5" />
          Plugins & skills
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codex discovers tools, MCP servers, apps, and skills from Cypheria's isolated Codex home.
        </p>
      </header>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="size-4" />
                Codex integration
              </CardTitle>
              <CardDescription>
                Changes are delivered live through App Server notifications and become available to
                agent turns.
              </CardDescription>
            </div>
            <Badge variant="secondary">Managed by Codex</Badge>
          </div>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cypheria Web3 tools</CardTitle>
          <CardDescription>
            Wallet, policy, automation, and browser capabilities are provided by Cypheria runtime
            with typed privileged boundaries.
          </CardDescription>
        </CardHeader>
      </Card>
    </WorkbenchFrame>
  )
}
