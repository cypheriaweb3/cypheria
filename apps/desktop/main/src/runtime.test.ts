import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toChainKey } from "@cypheria/network-core"
import { createMemoryVaultMasterKeyProvider } from "@cypheria/runtime"
import { describe, expect, it } from "vitest"

import { initializeDesktopRuntime, shutdownDesktopRuntime } from "./runtime.js"

describe("desktop runtime bootstrap", () => {
  it("starts and stops the Cypheria runtime host", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cypheria-desktop-runtime-test-"))

    try {
      const context = await initializeDesktopRuntime({
        homeDir,
        startCodexAppServer: false,
        vaultKeyProvider: createMemoryVaultMasterKeyProvider(),
      })

      expect(context.runtime.lifecycleState).toBe("ready")
      expect(context.paths).toBe(context.runtime.paths)
      expect(context.codexEnv.CODEX_HOME).toBe(context.paths.codexHome)
      await expect(context.dappSessions.open("https://app.example/path")).resolves.toMatchObject({
        origin: "https://app.example",
      })
      const wallet = await context.wallets.addWatchWallet({
        address: "0x0000000000000000000000000000000000000001",
        name: "Desktop watch wallet",
      })
      await expect(context.wallets.listWallets()).resolves.toEqual([wallet])
      const walletAccount = wallet.accounts[0]
      const chainAccount = walletAccount?.chainAccounts[0]
      if (!walletAccount || !chainAccount || chainAccount.chain.namespace !== "eip155") {
        throw new Error("Expected an EVM wallet account.")
      }
      await context.policies.create({
        chainKeys: [toChainKey(chainAccount.chain)],
        effect: "require-human-approval",
        enabled: true,
        methods: ["personal_sign"],
        origins: ["https://app.example"],
        requireHumanApproval: true,
        walletId: wallet.wallet.id,
      })
      await context.signingIntents.create({
        intent: {
          account: {
            address: chainAccount.address,
            chainAccountId: chainAccount.id,
            chainKey: toChainKey(chainAccount.chain),
            walletAccountId: walletAccount.account.id,
            walletId: wallet.wallet.id,
          },
          correlationId: "desktop-approval-smoke",
          kind: "personal-sign",
          message: "0x68656c6c6f",
          origin: "https://app.example",
        },
        mode: "human-approval",
        source: "dapp",
      })
      await expect(context.signingIntents.listApprovals("pending")).resolves.toHaveLength(1)

      await expect(context.runtime.request("runtime.info")).resolves.toMatchObject({
        cypheriaHome: context.paths.cypheriaHome,
        lifecycleState: "ready",
      })
      const task = await context.automation.createTask({
        definition: { handler: "noop" },
        status: "enabled",
        title: "Desktop smoke task",
        trigger: { kind: "manual", requestedBy: "user" },
        walletPolicyScope: { accountIds: [], chainKeys: [], mode: "read-only" },
        workspace: { id: "desktop", path: homeDir },
      })
      await expect(
        context.runtime.request("automation.run.start", { taskId: task.id })
      ).resolves.toMatchObject({ status: "succeeded", taskId: task.id })

      await shutdownDesktopRuntime(context)
      expect(context.runtime.lifecycleState).toBe("stopped")
    } finally {
      await rm(homeDir, { force: true, recursive: true })
    }
  })
})
