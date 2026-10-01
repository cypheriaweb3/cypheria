import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Network } from "lucide-react"
import { useEffect } from "react"
import { GatewayGeneralSection } from "../components/gateway/gateway-general-section"
import { GatewayProvidersSection } from "../components/gateway/gateway-providers-section"
import { GatewayRoutingSection } from "../components/gateway/gateway-routing-section"
import { GatewayUsageSection } from "../components/gateway/gateway-usage-section"
import { SettingsFrame } from "../components/settings-frame"

export const Route = createFileRoute("/settings/gateway/$sectionId")({
  component: GatewaySettingsRoute,
})

const GATEWAY_SECTIONS = [
  { id: "general", label: msg({ id: "settings.gateway.general", message: "General" }) },
  { id: "providers", label: msg({ id: "settings.gateway.providers", message: "Providers" }) },
  { id: "routing", label: msg({ id: "settings.gateway.routing", message: "Routing" }) },
  { id: "usage", label: msg({ id: "settings.gateway.usage", message: "Usage" }) },
] as const

type SectionId = (typeof GATEWAY_SECTIONS)[number]["id"]

function GatewaySettingsRoute() {
  const { sectionId } = Route.useParams()
  const navigate = useNavigate()
  const { i18n } = useLingui()

  useEffect(() => {
    if (!GATEWAY_SECTIONS.some((s) => s.id === sectionId)) {
      void navigate({
        params: { sectionId: "general" },
        replace: true,
        to: "/settings/gateway/$sectionId",
      })
    }
  }, [navigate, sectionId])

  const currentSection = (
    GATEWAY_SECTIONS.some((s) => s.id === sectionId) ? sectionId : "general"
  ) as SectionId

  return (
    <SettingsFrame wide>
      <div className="grid gap-6">
        <header className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-card text-primary shadow-xs">
            <Network className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">
                <Trans>Gateway</Trans>
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <Trans>
                A local gateway, run by magpie, that serves every model and subscription to the
                Agents Cypheria manages.
              </Trans>
            </p>
          </div>
        </header>

        <div className="grid min-h-[520px] gap-6 md:grid-cols-[190px_minmax(0,1fr)]">
          {/* Mobile dropdown navigation */}
          <Select
            value={currentSection}
            onValueChange={(value) =>
              void navigate({
                params: { sectionId: String(value) },
                to: "/settings/gateway/$sectionId",
              })
            }
          >
            <SelectTrigger className="md:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GATEWAY_SECTIONS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {i18n._(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Desktop side tab navigation */}
          <nav
            aria-label="Gateway settings tabs"
            className="cypheria-scrollbar hidden max-h-[70vh] content-start gap-1 overflow-y-auto md:grid"
          >
            {GATEWAY_SECTIONS.map((item) => (
              <button
                className={
                  item.id === currentSection
                    ? "rounded-md bg-muted px-3 py-2 text-left text-sm font-medium"
                    : "rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }
                key={item.id}
                type="button"
                onClick={() =>
                  void navigate({
                    params: { sectionId: item.id },
                    to: "/settings/gateway/$sectionId",
                  })
                }
              >
                {i18n._(item.label)}
              </button>
            ))}
          </nav>

          {/* Content Sections */}
          <section className="min-w-0">
            {currentSection === "general" ? <GatewayGeneralSection /> : null}
            {currentSection === "providers" ? <GatewayProvidersSection /> : null}
            {currentSection === "routing" ? <GatewayRoutingSection /> : null}
            {currentSection === "usage" ? <GatewayUsageSection /> : null}
          </section>
        </div>
      </div>
    </SettingsFrame>
  )
}
