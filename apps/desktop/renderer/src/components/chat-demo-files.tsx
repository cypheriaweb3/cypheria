import { Button } from "@cypheria/ui/components/button"
import {
  type ChatFileGitStatusEntry,
  type ChatFileRoot,
  ChatFilesPanel,
  type ChatFileTreeMutation,
  isChatDirectoryPath,
  isChatFilePathRemoved,
  moveChatFilePath,
} from "@cypheria/ui/components/chat"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { CodeIcon } from "@cypheria/ui/components/icons"
import { ChevronDown } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import promptWallpaper from "../assets/plugins/prompt-wallpaper.webp"

const initialContents: Record<string, string> = {
  ".gitignore": "node_modules/\ndist/\n.turbo/\n.cypheria/\n",
  "README.md": `# Cypheria workspace

A cross-platform **Web3 agent platform** with a shared server and multiple clients.

## Packages

| Path | Owns |
| --- | --- |
| \`apps/server\` | Shared state, Agent runtimes, schedules, and audit |
| \`apps/desktop\` | The Electron shell and the conversation workspace |
| \`packages/ui\` | The shared chat components |

## Getting started

\`\`\`sh
pnpm install
pnpm dev:desktop
\`\`\`

> Private keys, signing, and policy evaluation stay in the Server.

- [x] Files panel with preview
- [ ] Production file source
`,
  "docs/guide.mdx": `---
title: Signing policies
---

# Signing policies

Every signing intent passes policy. <Callout>Auto-signing is off by default.</Callout>

1. Open **Signing policies**.
2. Choose an origin and a method.
3. Enable the policy explicitly.
`,
  "docs/assets/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5cff"/>
      <stop offset="1" stop-color="#2bb6a3"/>
    </linearGradient>
  </defs>
  <rect width="160" height="160" rx="36" fill="url(#g)"/>
  <path d="M104 52a40 40 0 1 0 0 56" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
</svg>
`,
  "data/signing-audit.csv": `timestamp,origin,method,decision,note
2026-09-24T09:12:03Z,https://app.uniswap.org,eth_sendTransaction,prompt,"Swap 1.5 ETH → USDC"
2026-09-24T09:13:41Z,https://app.uniswap.org,eth_sendTransaction,allow,"Approved by user"
2026-09-24T10:02:17Z,https://opensea.io,eth_signTypedData_v4,deny,"Origin not in allow list"
2026-09-24T11:45:09Z,https://app.aave.com,personal_sign,prompt,"Login, ""nonce"" 42"
`,
  "data/networks.tsv": `chain\tchainId\tnative\trpc
Ethereum\t1\tETH\thttps://eth.llamarpc.com
Base\t8453\tETH\thttps://mainnet.base.org
Solana\t-\tSOL\thttps://api.mainnet-beta.solana.com
`,
  "apps/desktop/renderer/src/components/chat-demo.tsx": `import { ChatFilesPanel } from "@cypheria/ui/components/chat"

export function WorkspaceFiles({ paths }: { paths: readonly string[] }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  return (
    <ChatFilesPanel
      paths={paths}
      selectedPath={selectedPath}
      onSelectedPathChange={setSelectedPath}
    />
  )
}
`,
  "apps/server/src/agents/runtime.ts": `import type { ThreadId } from "@cypheria/protocol"

export interface AgentRuntime {
  readonly harness: "codex" | "claude" | "pi" | "opencode" | "acp"
  start(threadId: ThreadId): Promise<void>
  interrupt(threadId: ThreadId): Promise<void>
}

export function assertRuntimeReady(runtime: AgentRuntime | undefined): AgentRuntime {
  if (!runtime) throw new Error("Agent runtime is not available")
  return runtime
}
`,
  "apps/server/src/web3/policy.ts": `export type SigningDecision = "allow" | "prompt" | "deny"

export interface SigningIntent {
  readonly chainId: number
  readonly origin: string
  readonly method: "eth_sendTransaction" | "personal_sign" | "eth_signTypedData_v4"
}

/** Auto-signing stays off unless an explicit enabled policy allows the exact action. */
export function evaluatePolicy(intent: SigningIntent, allowList: readonly string[]): SigningDecision {
  return allowList.includes(\`\${intent.origin}:\${intent.method}\`) ? "allow" : "prompt"
}
`,
  "docs/architecture.md": `# Architecture

The Server is the only process that holds private keys, evaluates signing policy,
and runs Agent processes. Clients use \`@cypheria/client\` with \`@cypheria/protocol\`.
`,
  "package.json": `{
  "name": "cypheria",
  "private": true,
  "packageManager": "pnpm@11.1.3",
  "scripts": {
    "check": "turbo check",
    "docs:check": "node scripts/check-docs.mjs"
  }
}
`,
  "packages/ui/src/components/chat/files-panel.tsx": `export function ChatFilesPanel(props: ChatFilesPanelProps) {
  // Path-first tree from @pierre/trees and a highlighted, editable viewer from @pierre/diffs.
  return <div data-slot="chat-files-panel" />
}
`,
  "packages/ui/src/styles.css": `:root {
  --radius: 0.625rem;
  --font-mono-size: 12px;
}

.dark {
  --background: oklch(0.145 0 0);
}
`,
  "relay/main.go": `package main

import "log"

func main() {
\tlog.Println("cypheria relay listening")
}
`,
}

const workspaceExtras: Record<string, string> = {
  "AGENTS.md": "# Contributor Instructions\n\nUse pnpm, not npm, Yarn, or Bun.\n",
  LICENSE: "MIT License\n\nCopyright (c) Cypheria contributors\n",
  "README.zh-CN.md": "# Cypheria 工作区\n\n跨平台 Web3 Agent 平台。\n",
  "biome.json": `{
  "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",
  "formatter": { "indentStyle": "space", "lineWidth": 100 }
}
`,
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
  "tsconfig.base.json": `{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "target": "ES2024"
  }
}
`,
  "turbo.json": `{
  "tasks": {
    "check": { "dependsOn": ["^check"] },
    "build": { "outputs": ["dist/**"] }
  }
}
`,
}

const contractsContents: Record<string, string> = {
  "README.md": "# Cypheria contracts\n\nSession-scoped policy vault used by signing tests.\n",
  "foundry.toml": `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.28"
`,
  "src/PolicyVault.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Records which origins may request which signing methods.
contract PolicyVault {
    mapping(bytes32 => bool) public allowed;

    event PolicyChanged(bytes32 indexed key, bool allowed);

    function setPolicy(string calldata origin, bytes4 method, bool value) external {
        bytes32 key = keccak256(abi.encode(origin, method));
        allowed[key] = value;
        emit PolicyChanged(key, value);
    }
}
`,
  "test/PolicyVault.t.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyVault} from "../src/PolicyVault.sol";

contract PolicyVaultTest is Test {
    function testDefaultsToDenied() public {
        PolicyVault vault = new PolicyVault();
        assertFalse(vault.allowed(bytes32(0)));
    }
}
`,
}

const initialUrls: Record<string, string> = {
  "docs/assets/prompt-wallpaper.webp": promptWallpaper,
}

type DemoWorkspace = {
  readonly contents: Record<string, string>
  readonly urls: Record<string, string>
  readonly gitStatus: readonly ChatFileGitStatusEntry[]
  readonly paths: readonly string[]
  readonly selectedPath: string | null
}

const demoRoots: readonly ChatFileRoot[] = [
  { description: "~/Code/web3/cypheria", id: "cypheria", label: "cypheria" },
  {
    description: "~/Code/web3/cypheria-contracts",
    id: "cypheria-contracts",
    label: "cypheria-contracts",
  },
]

const initialWorkspaces: Record<string, DemoWorkspace> & { cypheria: DemoWorkspace } = {
  cypheria: {
    contents: { ...initialContents, ...workspaceExtras },
    gitStatus: [
      { path: "packages/ui/src/components/chat/files-panel.tsx", status: "added" },
      { path: "apps/desktop/renderer/src/components/chat-demo.tsx", status: "modified" },
      { path: "apps/server/src/web3/policy.ts", status: "modified" },
    ],
    paths: [
      ...Object.keys(initialContents),
      ...Object.keys(initialUrls),
      ...Object.keys(workspaceExtras),
      "apps/cli/",
      "apps/expo/",
      "apps/website/",
      "patches/",
      "plugins/",
      "scripts/",
    ],
    selectedPath: "README.md",
    urls: initialUrls,
  },
  "cypheria-contracts": {
    contents: contractsContents,
    gitStatus: [{ path: "test/PolicyVault.t.sol", status: "untracked" }],
    paths: [...Object.keys(contractsContents), "lib/"],
    selectedPath: "src/PolicyVault.sol",
    urls: {},
  },
}

const openTargets = ["Visual Studio Code", "Cursor", "Finder", "Terminal"]

const remapRecord = <T,>(
  record: Record<string, T>,
  mutation: ChatFileTreeMutation
): Record<string, T> => {
  if (mutation.type === "add") return record
  const next: Record<string, T> = {}
  for (const [path, value] of Object.entries(record)) {
    if (mutation.type === "remove") {
      if (!isChatFilePathRemoved(path, mutation.path)) next[path] = value
    } else next[moveChatFilePath(path, mutation.from, mutation.to)] = value
  }
  return next
}

const remapGitStatus = (
  entries: readonly ChatFileGitStatusEntry[],
  mutation: ChatFileTreeMutation
): ChatFileGitStatusEntry[] => {
  switch (mutation.type) {
    case "add":
      return isChatDirectoryPath(mutation.path)
        ? [...entries]
        : [...entries, { path: mutation.path, status: "untracked" }]
    case "remove":
      return entries.filter((entry) => !isChatFilePathRemoved(entry.path, mutation.path))
    case "move":
      return entries.map((entry) => {
        const path = moveChatFilePath(entry.path, mutation.from, mutation.to)
        if (path === entry.path) return entry
        return { path, status: entry.status === "untracked" ? "untracked" : "renamed" }
      })
  }
}

const applyMutations = (
  workspace: DemoWorkspace,
  paths: string[],
  mutations: readonly ChatFileTreeMutation[]
): DemoWorkspace => {
  let selectedPath = workspace.selectedPath
  for (const mutation of mutations) {
    if (!selectedPath) break
    if (mutation.type === "move")
      selectedPath = moveChatFilePath(selectedPath, mutation.from, mutation.to)
    if (mutation.type === "remove" && isChatFilePathRemoved(selectedPath, mutation.path))
      selectedPath = null
  }
  return {
    contents: mutations.reduce((record, mutation) => {
      const next = remapRecord(record, mutation)
      if (mutation.type === "add" && !isChatDirectoryPath(mutation.path)) next[mutation.path] ??= ""
      return next
    }, workspace.contents),
    gitStatus: mutations.reduce(remapGitStatus, workspace.gitStatus),
    paths,
    selectedPath,
    urls: mutations.reduce(remapRecord, workspace.urls),
  }
}

/** Local, in-memory multi-folder workspace used to exercise the shared files panel. */
export function DemoFilesPanel() {
  const [workspaces, setWorkspaces] = useState<Record<string, DemoWorkspace>>(initialWorkspaces)
  const [activeRootId, setActiveRootId] = useState("cypheria")
  const workspace = workspaces[activeRootId] ?? initialWorkspaces.cypheria

  const updateWorkspace = useCallback(
    (update: (current: DemoWorkspace) => DemoWorkspace) =>
      setWorkspaces((current) => {
        const target = current[activeRootId]
        return target ? { ...current, [activeRootId]: update(target) } : current
      }),
    [activeRootId]
  )

  const handlePathsChange = useCallback(
    (paths: string[], mutations: readonly ChatFileTreeMutation[]) =>
      updateWorkspace((current) => applyMutations(current, paths, mutations)),
    [updateWorkspace]
  )

  const handleSelectedPathChange = useCallback(
    (selectedPath: string) => updateWorkspace((current) => ({ ...current, selectedPath })),
    [updateWorkspace]
  )

  const handleFileSave = useCallback(
    ({ contents: text, path }: { contents: string; path: string }) =>
      updateWorkspace((current) => ({
        ...current,
        contents: { ...current.contents, [path]: text },
        gitStatus: current.gitStatus.some((entry) => entry.path === path)
          ? current.gitStatus
          : [...current.gitStatus, { path, status: "modified" }],
      })),
    [updateWorkspace]
  )

  const { contents, selectedPath, urls } = workspace
  const file = useMemo(() => {
    if (!selectedPath) return null
    const url = urls[selectedPath]
    if (url !== undefined) return { path: selectedPath, url }
    const text = contents[selectedPath]
    return text === undefined ? null : { contents: text, path: selectedPath }
  }, [contents, selectedPath, urls])

  return (
    <ChatFilesPanel
      activeRootId={activeRootId}
      file={file}
      gitStatus={workspace.gitStatus}
      headerActions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button className="ml-1 gap-1.5" size="sm" type="button" variant="outline" />}
          >
            <CodeIcon />
            Open
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {openTargets.map((target) => (
              <DropdownMenuItem key={target}>{target}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
      onActiveRootChange={setActiveRootId}
      onFileSave={handleFileSave}
      onPathsChange={handlePathsChange}
      onSelectedPathChange={handleSelectedPathChange}
      paths={workspace.paths}
      roots={demoRoots}
      selectedPath={selectedPath}
    />
  )
}
