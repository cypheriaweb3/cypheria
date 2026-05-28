import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

const workspaceCards = [
  {
    label: "Codex threads",
    value: "0",
    detail: "Thread list and turn stream placeholder",
  },
  {
    label: "Wallet context",
    value: "Read-only",
    detail: "No signing policy is enabled by default",
  },
  {
    label: "Browser sessions",
    value: "Isolated",
    detail: "Origin-scoped dApp sessions will attach here",
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
    <section className="workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Desktop shell</p>
          <h1>Workspaces</h1>
        </div>
        <button className="primary-action" type="button">
          New Thread
        </button>
      </header>

      <div className="content-grid">
        <section className="thread-panel" aria-labelledby="threads-heading">
          <div className="panel-heading">
            <h2 id="threads-heading">Agent activity</h2>
            <span className="panel-kicker">Waiting for Codex bridge</span>
          </div>
          <div className="empty-state">
            <p>No workspace thread is selected.</p>
            <span>Typed IPC and Codex event streaming will populate this panel next.</span>
          </div>
        </section>

        <aside className="inspector" aria-labelledby="context-heading">
          <div className="panel-heading">
            <h2 id="context-heading">Context</h2>
            <span className="panel-kicker">Local first</span>
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
                  <strong>{card.label}</strong>
                  <span>{card.detail}</span>
                </div>
                <code>{card.value}</code>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
