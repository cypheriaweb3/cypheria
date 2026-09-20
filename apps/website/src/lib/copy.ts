import { msg } from "@lingui/core/macro"

export const copy = {
  architecture: msg({ id: "nav.architecture", message: "Architecture" }),
  audit: msg({ id: "feature.audit", message: "Audit" }),
  browser: msg({ id: "feature.browser", message: "Isolated browser" }),
  cli: msg({ id: "architecture.cli", message: "CLI" }),
  comingSoon: msg({ id: "common.comingSoon", message: "Planned" }),
  developers: msg({ id: "nav.developers", message: "Developers" }),
  docs: msg({ id: "nav.docs", message: "Docs" }),
  expo: msg({ id: "architecture.expo", message: "Expo" }),
  github: msg({ id: "common.github", message: "View on GitHub" }),
  language: msg({ id: "common.language", message: "Language" }),
  localServer: msg({ id: "architecture.localServer", message: "Local Server" }),
  marketplace: msg({ id: "architecture.marketplace", message: "Marketplace" }),
  product: msg({ id: "nav.product", message: "Product" }),
  relay: msg({ id: "architecture.relay", message: "Encrypted Relay (optional)" }),
  security: msg({ id: "nav.security", message: "Security" }),
  theme: msg({ id: "common.theme", message: "Theme" }),
  themeDark: msg({ id: "common.theme.dark", message: "Dark" }),
  themeLight: msg({ id: "common.theme.light", message: "Light" }),
  themeSystem: msg({ id: "common.theme.system", message: "System" }),
} as const

export const homeCopy = {
  agentEyebrow: msg({ id: "home.agents.eyebrow", message: "Works with your agents" }),
  agentText: msg({
    id: "home.agents.text",
    message: "Keep your tools and workflow while Cypheria provides one consistent workspace.",
  }),
  agentTitle: msg({ id: "home.agents.title", message: "Bring the agents you already use." }),
  architectureEyebrow: msg({
    id: "home.architecture.eyebrow",
    message: "A local, open architecture",
  }),
  architectureText: msg({
    id: "home.architecture.text",
    message:
      "Desktop, CLI, and Expo connect to a local Server with explicit approvals and audit logging. The encrypted Relay is optional.",
  }),
  architectureTitle: msg({
    id: "home.architecture.title",
    message: "One system. Under your control.",
  }),
  ctaDocs: msg({ id: "home.cta.docs", message: "Read the docs" }),
  eyebrow: msg({ id: "home.eyebrow", message: "Pre-release · Cypheria is in active development." }),
  footnote: msg({ id: "home.footnote", message: "Open source. Local first. You stay in control." }),
  subtitle: msg({
    id: "home.subtitle",
    message:
      "Cypheria brings code, wallets, and the web together in a single local workspace with Web3 security controls.",
  }),
  title: msg({ id: "home.title", message: "Local agents. One trusted workspace." }),
} as const

export const productCopy = {
  eyebrow: msg({ id: "product.eyebrow", message: "Product" }),
  intro: msg({
    id: "product.intro",
    message:
      "A single workspace for conversations, tools, terminals, projects, schedules, integrations, and carefully controlled Web3 actions.",
  }),
  title: msg({ id: "product.title", message: "One workspace across the agent lifecycle." }),
  sections: [
    [
      msg({ id: "product.workspace.title", message: "Conversation workspace" }),
      msg({
        id: "product.workspace.text",
        message:
          "Projects, Threads, Sections, artifacts, terminals, and tools stay together in a durable Canonical Timeline.",
      }),
    ],
    [
      msg({ id: "product.agents.title", message: "Agent runtimes" }),
      msg({
        id: "product.agents.text",
        message:
          "Codex, Claude, Pi, OpenCode, and ACP share one conversation shell while retaining runtime-specific capabilities.",
      }),
    ],
    [
      msg({ id: "product.web3.title", message: "Web3 with explicit control" }),
      msg({
        id: "product.web3.text",
        message:
          "Networks, wallets, signing policies, approvals, isolated dApp sessions, and audit records remain behind the privileged Server boundary.",
      }),
    ],
    [
      msg({ id: "product.remote.title", message: "Schedules and remote access" }),
      msg({
        id: "product.remote.text",
        message:
          "Schedules execute with recovery and non-replay guarantees. Optional E2EE Relay access keeps application payloads opaque in transit.",
      }),
    ],
  ],
} as const

export const securityCopy = {
  eyebrow: msg({ id: "security.eyebrow", message: "Security" }),
  intro: msg({
    id: "security.intro",
    message:
      "Cypheria keeps authority in the local Server, makes sensitive actions explicit, and records the decisions that matter.",
  }),
  title: msg({ id: "security.title", message: "Designed around visible trust boundaries." }),
  sections: [
    [
      msg({ id: "security.boundary.title", message: "Privileged Server boundary" }),
      msg({
        id: "security.boundary.text",
        message:
          "Private keys, database access, signing, schedules, Agent processes, and policy evaluation stay outside renderers and dApp pages.",
      }),
    ],
    [
      msg({ id: "security.approval.title", message: "Policy and approval" }),
      msg({
        id: "security.approval.text",
        message:
          "Every signing intent passes policy. Auto-signing remains off unless an explicit enabled policy permits the exact action.",
      }),
    ],
    [
      msg({ id: "security.isolation.title", message: "Isolation by origin" }),
      msg({
        id: "security.isolation.text",
        message:
          "dApp sessions use isolated browser partitions and receive neither Node.js access nor raw signers.",
      }),
    ],
    [
      msg({ id: "security.audit.title", message: "Audit without automatic replay" }),
      msg({
        id: "security.audit.text",
        message:
          "Approvals, rejections, policies, schedules, signatures, and transaction outcomes are auditable. Interrupted signing or sending is never replayed automatically.",
      }),
    ],
  ],
} as const

export const developersCopy = {
  eyebrow: msg({ id: "developers.eyebrow", message: "Developers" }),
  intro: msg({
    id: "developers.intro",
    message:
      "Explore the architecture, public protocol, client SDK, Agent adapters, Web3 domain packages, and local development workflow.",
  }),
  title: msg({ id: "developers.title", message: "Build with Cypheria's public boundaries." }),
  commandsTitle: msg({ id: "developers.commands.title", message: "Start locally" }),
  sections: [
    [
      msg({ id: "developers.protocol.title", message: "Protocol and client" }),
      msg({
        id: "developers.protocol.text",
        message:
          "Use @cypheria/client with @cypheria/protocol. Clients never import Server internals, repositories, or Agent SDKs.",
      }),
    ],
    [
      msg({ id: "developers.server.title", message: "Server composition" }),
      msg({
        id: "developers.server.text",
        message:
          "The Server composes explicit services for runtimes, storage, schedules, integrations, terminals, Web3 execution, and audit.",
      }),
    ],
    [
      msg({ id: "developers.docs.title", message: "One documentation source" }),
      msg({
        id: "developers.docs.text",
        message:
          "Architecture and package contracts live in the repository documentation; this page links to them instead of duplicating them.",
      }),
    ],
  ],
} as const
