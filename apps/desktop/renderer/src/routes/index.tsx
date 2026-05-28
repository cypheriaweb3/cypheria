import { Badge, Button, Input } from "@cypheria/ui"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  Activity,
  ArrowUpRight,
  Bot,
  Code2,
  FolderGit2,
  Globe2,
  ShieldCheck,
  TerminalSquare,
  WalletCards,
} from "lucide-react"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

const workspaceCards = [
  {
    detail: "Thread list and turn stream placeholder",
    icon: <Bot size={16} strokeWidth={1.9} />,
    label: "Codex threads",
    tone: "muted" as const,
    value: "0",
  },
  {
    label: "Wallet context",
    detail: "No signing policy is enabled by default",
    icon: <WalletCards size={16} strokeWidth={1.9} />,
    tone: "success" as const,
    value: "Read-only",
  },
  {
    label: "Browser sessions",
    detail: "Origin-scoped dApp sessions will attach here",
    icon: <Globe2 size={16} strokeWidth={1.9} />,
    tone: "default" as const,
    value: "Isolated",
  },
]

const emptyViews = [
  {
    description:
      "Create or open a workspace to attach Codex threads, diffs, terminals, and approvals.",
    icon: <FolderGit2 size={18} strokeWidth={1.9} />,
    label: "Workspaces",
  },
  {
    description:
      "Open dApps in origin-isolated sessions with provider permissions scoped per origin.",
    icon: <Globe2 size={18} strokeWidth={1.9} />,
    label: "Browser",
  },
  {
    description: "Connect local, embedded, external, or read-only wallet contexts before signing.",
    icon: <WalletCards size={18} strokeWidth={1.9} />,
    label: "Wallets",
  },
  {
    description: "Manual and scheduled tasks will appear here with auditable run history.",
    icon: <Activity size={18} strokeWidth={1.9} />,
    label: "Automations",
  },
  {
    description: "Review signing policies, approval defaults, and audit-sensitive boundaries.",
    icon: <ShieldCheck size={18} strokeWidth={1.9} />,
    label: "Security",
  },
  {
    description: "Configure runtime homes, Codex integration, browser partitions, and local data.",
    icon: <Code2 size={18} strokeWidth={1.9} />,
    label: "Settings",
  },
]

function HomeRoute() {
  const appMetadataQuery = useQuery({
    queryFn: () => window.cypheria?.app.getMetadata() ?? null,
    queryKey: ["app-metadata"],
    staleTime: Number.POSITIVE_INFINITY,
  })

  const appHealthQuery = useQuery({
    queryFn: () => window.cypheria?.app.getHealth() ?? null,
    queryKey: ["app-health"],
    staleTime: 10_000,
  })

  const runtimeInfoQuery = useQuery({
    queryFn: () => window.cypheria?.runtime.getInfo() ?? null,
    queryKey: ["runtime-info"],
    staleTime: Number.POSITIVE_INFINITY,
  })

  const preloadStatus = window.cypheria
    ? (runtimeInfoQuery.data?.cypheriaHome ?? "Loading")
    : "Browser preview"
  const appVersion = appMetadataQuery.data?.version ?? "0.0.0"
  const healthStatus = appHealthQuery.data?.status ?? (window.cypheria ? "Loading" : "Preview")

  return (
    <section className="workspace-screen">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Desktop shell</p>
          <h1>Workspaces</h1>
          <p className="workspace-subtitle">
            A local-first command surface for Codex threads, Web3 browser context, wallet approvals,
            automations, and security review.
          </p>
        </div>
        <div className="workspace-actions">
          <Input aria-label="Search workspaces" className="workspace-search" placeholder="Search" />
          <Button>
            New Thread
            <ArrowUpRight aria-hidden="true" size={14} strokeWidth={2} />
          </Button>
        </div>
      </header>

      <div className="content-grid">
        <section aria-labelledby="threads-heading" className="thread-panel">
          <div className="panel-heading">
            <div>
              <h2 id="threads-heading">Agent activity</h2>
              <span className="panel-kicker">Waiting for Codex bridge</span>
            </div>
            <Badge tone="muted">Empty</Badge>
          </div>
          <div className="activity-empty">
            <div className="activity-empty-icon">
              <TerminalSquare aria-hidden="true" size={22} strokeWidth={1.8} />
            </div>
            <p>No workspace thread is selected.</p>
            <span>Typed IPC and Codex event streaming will populate this panel next.</span>
          </div>

          <ul aria-label="Primary sections" className="empty-grid">
            {emptyViews.map((view) => (
              <li className="empty-card" key={view.label}>
                <div className="empty-card-icon">{view.icon}</div>
                <div>
                  <h3>{view.label}</h3>
                  <p>{view.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside aria-labelledby="context-heading" className="inspector">
          <div className="panel-heading">
            <div>
              <h2 id="context-heading">Context</h2>
              <span className="panel-kicker">Local first</span>
            </div>
            <Badge tone={window.cypheria ? "success" : "warning"}>
              {window.cypheria ? "Live" : "Preview"}
            </Badge>
          </div>
          <div className="context-list">
            <div className="context-row">
              <div>
                <strong>Preload bridge</strong>
                <span>Typed app and runtime endpoints</span>
              </div>
              <code>{preloadStatus}</code>
            </div>
            <div className="context-row">
              <div>
                <strong>App version</strong>
                <span>Read through the app metadata endpoint</span>
              </div>
              <code>{appVersion}</code>
            </div>
            <div className="context-row">
              <div>
                <strong>IPC health</strong>
                <span>Validated by the main-process IPC router</span>
              </div>
              <code>{healthStatus}</code>
            </div>
            {workspaceCards.map((card) => (
              <div className="context-row" key={card.label}>
                <div>
                  <strong>
                    {card.icon}
                    {card.label}
                  </strong>
                  <span>{card.detail}</span>
                </div>
                <Badge tone={card.tone}>{card.value}</Badge>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
