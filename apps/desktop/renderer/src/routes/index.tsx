import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Textarea } from "@cypheria/ui/components/textarea"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ArrowUp,
  ChevronDown,
  FileDiff,
  FolderGit2,
  Globe2,
  HardDrive,
  LockKeyhole,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  TerminalSquare,
  WalletCards,
} from "lucide-react"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

const auditRows = [
  ["Codex home", "$CYPHERIA_HOME/codex"],
  ["Runtime", "Electron main"],
  ["Renderer", "Typed IPC only"],
  ["Auto-signing", "Off"],
] as const

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
    <section className="workspace-screen" aria-label="Open workspace">
      <main className="chat-region" aria-label="Chat">
        <header className="chat-titlebar">
          <div className="chat-title">
            <FolderGit2 aria-hidden="true" size={16} strokeWidth={1.9} />
            <span>cypheria</span>
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
          </div>
          <div className="chat-title-actions">
            <Badge variant={window.cypheria ? "secondary" : "outline"}>
              {window.cypheria ? "Live" : "Preview"}
            </Badge>
            <Button aria-label="Collapse panel" size="icon" variant="ghost">
              <PanelRightClose aria-hidden="true" size={16} strokeWidth={1.9} />
            </Button>
          </div>
        </header>

        <div className="chat-scroll">
          <section className="chat-empty-prompt" aria-label="Chat prompt">
            <h1>What should we build in Cypheria?</h1>
          </section>

          <div className="chat-empty-state">
            <span>Open a chat or start a new one.</span>
          </div>
        </div>

        <form aria-label="Message composer" className="composer">
          <Textarea
            aria-label="Message Cypheria"
            className="composer-input"
            placeholder="Ask Cypheria to inspect, edit, run, or review..."
            rows={3}
          />
          <div className="composer-actions">
            <div className="composer-left-actions">
              <Button aria-label="Attach context" size="icon" variant="ghost">
                <Plus aria-hidden="true" size={17} strokeWidth={1.9} />
              </Button>
              <Button size="sm" variant="ghost">
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.9} />
                Full access
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
              </Button>
            </div>
            <div className="composer-right-actions">
              <Button size="sm" variant="ghost">
                GPT-5
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
              </Button>
              <Button aria-label="Send message" size="icon">
                <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
              </Button>
            </div>
          </div>
          <div className="composer-context">
            <button type="button">
              <FolderGit2 aria-hidden="true" size={14} strokeWidth={1.9} />
              cypheria
            </button>
            <button type="button">
              <HardDrive aria-hidden="true" size={14} strokeWidth={1.9} />
              Local mode
            </button>
            <button type="button">
              <WalletCards aria-hidden="true" size={14} strokeWidth={1.9} />
              Wallet
            </button>
            <button type="button">
              <Globe2 aria-hidden="true" size={14} strokeWidth={1.9} />
              Network
            </button>
          </div>
        </form>
      </main>

      <aside className="context-panel" aria-label="Panel">
        <header className="panel-titlebar">
          <div>
            <h2>Panel</h2>
            <span>
              {healthStatus} · App {appVersion}
            </span>
          </div>
          <Button aria-label="Panel options" size="icon" variant="ghost">
            <MoreHorizontal aria-hidden="true" size={16} strokeWidth={1.9} />
          </Button>
        </header>

        <section className="panel-launcher" aria-label="Panel tools">
          <button type="button">
            <FolderGit2 aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong>Files</strong>
            <span>Browse workspace files</span>
          </button>
          <button type="button">
            <Globe2 aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong>Browser</strong>
            <span>Open dApps and sites</span>
          </button>
          <button type="button">
            <FileDiff aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong>Review</strong>
            <span>Inspect code changes</span>
          </button>
          <button type="button">
            <TerminalSquare aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong>Terminal</strong>
            <span>Interactive shell</span>
          </button>
        </section>

        <section className="context-section">
          <div className="panel-heading compact-heading">
            <div>
              <h2>Web3 Context</h2>
              <span className="panel-kicker">Renderer-safe state</span>
            </div>
          </div>
          <div className="panel-empty-state">No wallet, network, or policy context selected.</div>
        </section>

        <section className="context-section">
          <div className="panel-heading compact-heading">
            <div>
              <h2>Runtime</h2>
              <span className="panel-kicker">Local Cypheria home</span>
            </div>
          </div>
          <div className="audit-table">
            <div className="audit-row">
              <span>Home</span>
              <code title={preloadStatus}>{preloadStatus}</code>
            </div>
            {auditRows.map(([label, value]) => (
              <div className="audit-row" key={label}>
                <span>{label}</span>
                <code>{value}</code>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </section>
  )
}
