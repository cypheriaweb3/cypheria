import { buttonVariants } from "@cypheria/ui/components/button"
import type { MessageDescriptor } from "@lingui/core"
import { useLingui } from "@lingui/react"
import { Link } from "@tanstack/react-router"
import {
  ArrowRight,
  Blocks,
  BookOpen,
  Cloud,
  Database,
  Monitor,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
} from "lucide-react"
import type { ReactNode } from "react"
import { AgentMark } from "@/components/agent-icons"
import { GitHubLogo } from "@/components/brand"
import { SiteFooter } from "@/components/site-footer"
import { githubUrl, SiteHeader } from "@/components/site-header"
import { copy, developersCopy, homeCopy, productCopy, securityCopy } from "@/lib/copy"
import type { WebsiteLocale } from "@/lib/i18n"

const agents = [
  ["Codex", "Code and reasoning"],
  ["Claude", "Research and analysis"],
  ["Pi", "Agent framework"],
  ["OpenCode", "Local coding agent"],
  ["ACP", "Agent connectivity"],
] as const

const chineseAgentDescriptions: Record<(typeof agents)[number][0], string> = {
  ACP: "Agent 连接协议",
  Claude: "研究与分析",
  Codex: "代码与推理",
  OpenCode: "本地编程 Agent",
  Pi: "Agent 框架",
}

function LocaleLink({ locale, path }: { locale: WebsiteLocale; path: string }) {
  return locale === "zh-CN" ? `/zh-CN${path === "/" ? "" : path}` : path
}

function GithubCta({ label }: { label: string }) {
  return (
    <a className={buttonVariants({ className: "primary-cta", size: "lg" })} href={githubUrl}>
      <GitHubLogo />
      {label}
      <ArrowRight aria-hidden="true" />
    </a>
  )
}

export function HomePage({ locale }: { locale: WebsiteLocale }) {
  const { i18n } = useLingui()
  const zh = locale === "zh-CN"

  return (
    <div className="website-shell">
      <SiteHeader />
      <main>
        <section className="hero-section">
          <p className="pre-release">{i18n._(homeCopy.eyebrow)}</p>
          <h1>{i18n._(homeCopy.title)}</h1>
          <p className="hero-subtitle">{i18n._(homeCopy.subtitle)}</p>
          <div className="hero-actions">
            <GithubCta label={i18n._(copy.github)} />
            <Link
              className={buttonVariants({
                className: "secondary-cta",
                size: "lg",
                variant: "outline",
              })}
              to={LocaleLink({ locale, path: "/docs" })}
            >
              <BookOpen aria-hidden="true" />
              {i18n._(homeCopy.ctaDocs)}
            </Link>
          </div>
          <p className="hero-footnote">{i18n._(homeCopy.footnote)}</p>
          <figure className="product-frame">
            <figcaption className="sr-only">
              {zh ? "Cypheria Desktop 产品截图" : "Cypheria Desktop product screenshot"}
            </figcaption>
            <span aria-hidden="true" className="window-dots">
              <i />
              <i />
              <i />
            </span>
            <img
              alt={zh ? "Cypheria Desktop 浅色主题" : "Cypheria Desktop in light theme"}
              className="desktop-shot desktop-shot-light"
              height="720"
              loading="eager"
              src="/screenshots/desktop-light.webp"
              width="1280"
            />
            <img
              alt={zh ? "Cypheria Desktop 深色主题" : "Cypheria Desktop in dark theme"}
              className="desktop-shot desktop-shot-dark"
              height="720"
              loading="eager"
              src="/screenshots/desktop-dark.webp"
              width="1280"
            />
          </figure>
        </section>

        <section className="agents-section section-rule">
          <div className="section-intro">
            <p className="eyebrow">{i18n._(homeCopy.agentEyebrow)}</p>
            <h2>{i18n._(homeCopy.agentTitle)}</h2>
            <p>{i18n._(homeCopy.agentText)}</p>
          </div>
          <div className="agent-list">
            {agents.map(([name, description]) => (
              <div className="agent-item" key={name}>
                <span className="agent-icon-frame">
                  <AgentMark name={name} />
                </span>
                <strong>{name}</strong>
                <span>{zh ? chineseAgentDescriptions[name] : description}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="architecture-section section-rule">
          <div className="section-intro architecture-copy">
            <p className="eyebrow">{i18n._(homeCopy.architectureEyebrow)}</p>
            <h2>{i18n._(homeCopy.architectureTitle)}</h2>
            <p>{i18n._(homeCopy.architectureText)}</p>
            <Link className="text-link" to={LocaleLink({ locale, path: "/docs/architecture" })}>
              {i18n._(copy.architecture)}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <ArchitectureDiagram locale={locale} />
        </section>

        <FinalCta locale={locale} />
      </main>
      <SiteFooter />
    </div>
  )
}

function ArchitectureNode({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <div className="architecture-node">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function ArchitectureDiagram({ locale }: { locale: WebsiteLocale }) {
  const { i18n } = useLingui()
  return (
    <div className="architecture-diagram">
      <div className="architecture-clients">
        <ArchitectureNode icon={<Monitor aria-hidden="true" />}>Desktop</ArchitectureNode>
        <ArchitectureNode icon={<TerminalSquare aria-hidden="true" />}>
          {i18n._(copy.cli)}
        </ArchitectureNode>
        <ArchitectureNode icon={<Smartphone aria-hidden="true" />}>
          {i18n._(copy.expo)}
        </ArchitectureNode>
      </div>
      <span aria-hidden="true" className="diagram-connector" />
      <div className="architecture-core">
        <ArchitectureNode icon={<Database aria-hidden="true" />}>
          {i18n._(copy.localServer)}
        </ArchitectureNode>
        <ArchitectureNode icon={<ShieldCheck aria-hidden="true" />}>
          {locale === "zh-CN" ? "审批与审计" : "Approvals & Audit"}
        </ArchitectureNode>
      </div>
      <div className="architecture-future">
        <ArchitectureNode icon={<Cloud aria-hidden="true" />}>
          {i18n._(copy.relay)}
        </ArchitectureNode>
        <div className="architecture-node planned-node">
          <Blocks aria-hidden="true" />
          <span>
            {i18n._(copy.marketplace)}
            <small>{i18n._(copy.comingSoon)}</small>
          </span>
        </div>
      </div>
    </div>
  )
}

type DetailCopy = {
  eyebrow: MessageDescriptor
  intro: MessageDescriptor
  sections: readonly (readonly [MessageDescriptor, MessageDescriptor])[]
  title: MessageDescriptor
}

export function DetailPage({
  kind,
  locale,
}: {
  kind: "developers" | "product" | "security"
  locale: WebsiteLocale
}) {
  const { i18n } = useLingui()
  const content: DetailCopy =
    kind === "product" ? productCopy : kind === "security" ? securityCopy : developersCopy

  return (
    <div className="website-shell">
      <SiteHeader />
      <main>
        <section className="detail-hero">
          <p className="eyebrow">{i18n._(content.eyebrow)}</p>
          <h1>{i18n._(content.title)}</h1>
          <p>{i18n._(content.intro)}</p>
          <div className="hero-actions">
            <GithubCta label={i18n._(copy.github)} />
            <Link
              className={buttonVariants({ size: "lg", variant: "outline" })}
              to={LocaleLink({ locale, path: "/docs" })}
            >
              {i18n._(copy.docs)}
            </Link>
          </div>
        </section>
        <section className="detail-grid section-rule">
          {content.sections.map(([title, text], index) => (
            <article className="detail-section" key={title.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h2>{i18n._(title)}</h2>
              <p>{i18n._(text)}</p>
            </article>
          ))}
        </section>
        {kind === "product" ? <Maturity locale={locale} /> : null}
        {kind === "developers" ? <DeveloperCommands locale={locale} /> : null}
        <FinalCta locale={locale} />
      </main>
      <SiteFooter />
    </div>
  )
}

function Maturity({ locale }: { locale: WebsiteLocale }) {
  const rows =
    locale === "zh-CN"
      ? [
          ["Desktop", "主要产品界面", "持续实现"],
          ["CLI", "非 TUI 的协议与 Server 生命周期入口", "已具备基础"],
          ["Expo", "iOS、Android 与静态 Web 基础", "早期基础"],
        ]
      : [
          ["Desktop", "Primary product surface", "Active implementation"],
          ["CLI", "Non-TUI protocol and Server lifecycle surface", "Foundation available"],
          ["Expo", "iOS, Android, and static web foundation", "Early foundation"],
        ]
  return (
    <section className="maturity-section section-rule">
      <p className="eyebrow">{locale === "zh-CN" ? "当前成熟度" : "Current maturity"}</p>
      <h2>{locale === "zh-CN" ? "清楚区分现在与未来。" : "Clear about what exists today."}</h2>
      <div className="maturity-table">
        {rows.map(([surface, scope, status]) => (
          <div className="maturity-row" key={surface}>
            <strong>{surface}</strong>
            <span>{scope}</span>
            <em>{status}</em>
          </div>
        ))}
      </div>
    </section>
  )
}

function DeveloperCommands({ locale }: { locale: WebsiteLocale }) {
  const { i18n } = useLingui()
  return (
    <section className="commands-section section-rule">
      <div>
        <p className="eyebrow">{i18n._(developersCopy.commandsTitle)}</p>
        <h2>{locale === "zh-CN" ? "从仓库开始。" : "Start from the repository."}</h2>
        <p>
          {locale === "zh-CN"
            ? "使用固定的 pnpm 工具链，按工作区运行定向检查。"
            : "Use the pinned pnpm toolchain and run focused checks by workspace."}
        </p>
      </div>
      <pre>
        <code>{`pnpm install\npnpm docs:check\npnpm check\npnpm build`}</code>
      </pre>
    </section>
  )
}

function FinalCta({ locale }: { locale: WebsiteLocale }) {
  const { i18n } = useLingui()
  return (
    <section className="final-cta section-rule">
      <div>
        <p className="eyebrow">{locale === "zh-CN" ? "参与 Cypheria" : "Build with Cypheria"}</p>
        <h2>{locale === "zh-CN" ? "跟进进展，阅读源码。" : "Follow the work. Read the source."}</h2>
      </div>
      <GithubCta label={i18n._(copy.github)} />
    </section>
  )
}
