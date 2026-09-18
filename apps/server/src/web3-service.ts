import { join } from "node:path"
import {
  createAuditLogService,
  createNetworkPersistenceService,
  createSigningIntentPersistenceService,
  createSigningPolicyPersistenceService,
  createWalletProviderPersistenceService,
  createWalletPublicStatePersistenceService,
  type OpenDatabaseResult,
} from "@cypheria/db"
import type { Web3ClientMessage, Web3ServerMessage } from "@cypheria/protocol"
import { createDappSessionManager, type DappSessionManager } from "@cypheria/web3/provider"

import {
  type CypheriaRuntimePaths,
  createEncryptedFileNetworkCredentialStore,
  createEthereumProviderRuntimeService,
  createNetworkManager,
  createPrivateFileVaultMasterKeyProvider,
  createSigningIntentRuntimeService,
  createSigningPolicyRuntimeService,
  createSolanaProviderRuntimeService,
  createWalletKeystoreCodec,
  createWalletManager,
  createWalletVaultController,
  type NetworkManager,
  NetworkRpcRouter,
  type SigningIntentRuntimeService,
  type SigningPolicyRuntimeService,
  type VaultMasterKeyProvider,
  type WalletManager,
  type WalletVaultController,
} from "./runtime/index.js"

type Send = (message: Web3ServerMessage) => void

const errorCode = (error: unknown): string => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code
  }
  return error instanceof Error ? error.name : "WEB3_REQUEST_FAILED"
}

export class ServerWeb3Service {
  readonly #masterKey: VaultMasterKeyProvider
  readonly audit: ReturnType<typeof createAuditLogService>
  readonly networks: NetworkManager
  readonly policies: SigningPolicyRuntimeService
  readonly signingIntents: SigningIntentRuntimeService
  readonly dappSessions: DappSessionManager
  readonly vault: WalletVaultController
  readonly wallets: WalletManager
  readonly #requestEthereumProvider: (request: unknown) => Promise<unknown>
  readonly #requestSolanaProvider: (request: unknown) => Promise<unknown>

  constructor(database: OpenDatabaseResult, paths: CypheriaRuntimePaths) {
    this.audit = createAuditLogService(database.db)
    const networkPersistence = createNetworkPersistenceService(database.db)
    const walletPersistence = createWalletPublicStatePersistenceService(database.db)
    const providerPersistence = createWalletProviderPersistenceService(database.db)
    const masterKey = createPrivateFileVaultMasterKeyProvider(
      join(paths.configDir, "server-master-key.bin")
    )
    this.#masterKey = masterKey
    const credentials = createEncryptedFileNetworkCredentialStore({
      directory: paths.networkCredentialsDir,
      keyProvider: masterKey,
    })
    const router = new NetworkRpcRouter({ credentials, persistence: networkPersistence })
    this.networks = createNetworkManager({
      audit: this.audit,
      credentials,
      lifecycle: {
        clearWorkspaceContext: async (networkId) => {
          await walletPersistence.clearActiveContextForNetwork(networkId)
        },
        failPendingWork: async (chainKey) => router.invalidateChain(chainKey),
        revokeDappGrants: async (_networkId, chainKey) => {
          await providerPersistence.revokeChainPermissions(chainKey)
        },
      },
      persistence: networkPersistence,
      router,
    })
    this.vault = createWalletVaultController({
      codec: createWalletKeystoreCodec(),
      keyProvider: masterKey,
      vaultDir: paths.vaultDir,
    })
    this.wallets = createWalletManager({
      audit: this.audit,
      networks: networkPersistence,
      persistence: walletPersistence,
      vault: this.vault,
    })
    this.policies = createSigningPolicyRuntimeService({
      audit: this.audit,
      persistence: createSigningPolicyPersistenceService(database.db),
      wallets: walletPersistence,
    })
    this.signingIntents = createSigningIntentRuntimeService({
      audit: this.audit,
      persistence: createSigningIntentPersistenceService(database.db),
      policies: this.policies,
    })
    this.dappSessions = createDappSessionManager({ persistence: providerPersistence })
    const ethereumProvider = createEthereumProviderRuntimeService({
      audit: this.audit,
      executeSigningIntent: async () => {
        throw new Error("Ethereum signing execution is not configured.")
      },
      getActiveSigningContext: async () => undefined,
      networks: this.networks,
      permissionAuthorizer: async () => undefined,
      persistence: providerPersistence,
      router,
      sessions: this.dappSessions,
      signingIntents: this.signingIntents,
    })
    const solanaProvider = createSolanaProviderRuntimeService({
      audit: this.audit,
      executeSigningIntent: async () => {
        throw new Error("Solana signing execution is not configured.")
      },
      networks: this.networks,
      permissionAuthorizer: async () => undefined,
      persistence: providerPersistence,
      sessions: this.dappSessions,
      signingIntents: this.signingIntents,
    })
    this.#requestEthereumProvider = ethereumProvider.handle
    this.#requestSolanaProvider = solanaProvider.handle
  }

  async initialize(): Promise<void> {
    await this.networks.initialize()
  }

  stop(): void {
    this.vault.lockAll()
    this.#masterKey.clearCachedMasterKey?.()
  }

  async handle(message: Web3ClientMessage, send: Send): Promise<boolean> {
    const responseType = message.type.replace(/\.request$/, ".response")
    try {
      const value = await this.#execute(message)
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: responseType,
      } as Web3ServerMessage)
    } catch (error) {
      send({
        payload: {
          error: {
            code: errorCode(error),
            message: error instanceof Error ? error.message : "Web3 request failed",
          },
          ok: false,
        },
        requestId: message.requestId,
        type: responseType,
      } as Web3ServerMessage)
    }
    return true
  }

  async #execute(message: Web3ClientMessage): Promise<unknown> {
    switch (message.type) {
      case "web3.network.list.request":
        return this.networks.list()
      case "web3.network.create.request":
        return this.networks.create(message.payload)
      case "web3.network.set-enabled.request":
        return this.networks.setEnabled(
          message.payload.networkId,
          message.payload.enabled,
          message.payload.expectedRevision
        )
      case "web3.network.remove.request":
        await this.networks.removeCustomNetwork(
          message.payload.networkId,
          message.payload.confirmed
        )
        return { completed: true }
      case "web3.network.reorder.request":
        await this.networks.reorderNetworks(message.payload.networkIds)
        return { completed: true }
      case "web3.endpoint.add.request":
        return this.networks.addEndpoint(message.payload.networkId, message.payload.endpoint)
      case "web3.endpoint.probe.request":
        return this.networks.probeEndpoint(message.payload.endpointId)
      case "web3.endpoint.set-enabled.request":
        return this.networks.setEndpointEnabled(
          message.payload.endpointId,
          message.payload.enabled,
          message.payload.expectedRevision
        )
      case "web3.endpoint.remove.request":
        await this.networks.removeEndpoint(message.payload.endpointId)
        return { completed: true }
      case "web3.endpoint.reorder.request":
        await this.networks.reorderEndpoints(message.payload.networkId, message.payload.endpointIds)
        return { completed: true }
      case "web3.wallet.list.request":
        return this.wallets.listWallets()
      case "web3.wallet.generate.request":
        return this.wallets.generateHdWallet(message.payload)
      case "web3.wallet.derive.request":
        return this.wallets.deriveHdAccount(message.payload)
      case "web3.wallet.import-hd.request":
        return this.wallets.importHdWallet(message.payload)
      case "web3.wallet.import-private-key.request":
        return this.wallets.importPrivateKeyWallet(message.payload)
      case "web3.wallet.add-watch.request":
        return this.wallets.addWatchWallet(message.payload)
      case "web3.wallet.rename.request":
        return this.wallets.renameWallet(message.payload.walletId, message.payload.name)
      case "web3.wallet.reorder.request":
        await this.wallets.reorderWallets(message.payload.walletIds)
        return { completed: true }
      case "web3.wallet.reorder-accounts.request":
        await this.wallets.reorderWalletAccounts(
          message.payload.walletId,
          message.payload.walletAccountIds
        )
        return { completed: true }
      case "web3.wallet.delete.request":
        await this.wallets.deleteWallet(message.payload.walletId)
        return { completed: true }
      case "web3.wallet.active.get.request":
        return this.wallets.getActiveContext()
      case "web3.wallet.active.set.request":
        return this.wallets.setActiveContext(message.payload)
      case "web3.wallet.active.clear.request":
        await this.wallets.clearActiveContext()
        return { completed: true }
      case "web3.wallet.lock.request":
        return this.#setVaultLock(message.payload.walletId, true)
      case "web3.wallet.unlock.request":
        return this.#setVaultLock(message.payload.walletId, false)
      case "web3.policy.list.request":
        return this.policies.list(message.payload)
      case "web3.policy.create.request":
        return this.policies.create(message.payload)
      case "web3.policy.update.request": {
        const { policyId, ...input } = message.payload
        return this.policies.update(policyId, input)
      }
      case "web3.policy.disable.request":
        return this.policies.disable(message.payload.policyId, message.payload.expectedRevision)
      case "web3.approval.list.request":
        return this.signingIntents.listApprovals(message.payload.status)
      case "web3.approval.decide.request":
        return this.signingIntents.decide(message.payload.approvalId, {
          decision: message.payload.decision,
          expectedRevision: message.payload.expectedRevision,
          reviewer: message.payload.reviewer,
        })
      case "web3.audit.list.request":
        return this.audit.list(message.payload)
      case "web3.dapp.session.open.request":
        return this.dappSessions.open(message.payload.url)
      case "web3.dapp.provider.request":
        return message.payload.method.startsWith("solana:") ||
          message.payload.method.startsWith("standard:")
          ? this.#requestSolanaProvider(message.payload)
          : this.#requestEthereumProvider(message.payload)
    }
  }

  async #setVaultLock(walletId: string, locked: boolean): Promise<unknown> {
    const wallet = await this.wallets.getWallet(walletId as never)
    if (!wallet || !("vaultId" in wallet.wallet))
      throw new Error("The wallet does not have a local vault.")
    if (locked) this.vault.lock(wallet.wallet.vaultId)
    else await this.vault.unlock(wallet.wallet.vaultId)
    return { unlocked: !locked, walletId }
  }
}
