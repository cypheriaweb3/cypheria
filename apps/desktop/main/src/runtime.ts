import {
  type AuditLogService,
  applyDatabaseMigrations,
  createAuditLogService,
  createAutomationPersistenceService,
  createNetworkPersistenceService,
  createSigningIntentPersistenceService,
  createSigningPolicyPersistenceService,
  createWalletProviderPersistenceService,
  createWalletPublicStatePersistenceService,
  type OpenDatabaseResult,
  openCypheriaDatabase,
} from "@cypheria/db"
import {
  type AutomationRuntimeService,
  type AutomationRuntimeServiceOptions,
  buildCodexEnvironment,
  buildRuntimePaths,
  CypheriaRuntime,
  type CypheriaRuntimeOptions,
  type CypheriaRuntimePaths,
  createAutomationRuntimeService,
  createEthereumProviderRuntimeService,
  createNetworkManager,
  createSigningIntentRuntimeService,
  createSigningPolicyRuntimeService,
  createSolanaProviderRuntimeService,
  createWalletKeystoreCodec,
  createWalletManager,
  createWalletVaultController,
  type EthereumProviderRuntimeServiceOptions,
  ensureRuntimeDirectories,
  type NetworkManager,
  NetworkRpcRouter,
  type RuntimeHomeEnv,
  type SigningIntentRuntimeService,
  type SigningPolicyRuntimeService,
  type SolanaProviderRuntimeServiceOptions,
  type VaultMasterKeyProvider,
  type WalletManager,
  type WalletVaultController,
} from "@cypheria/runtime"
import { createDappSessionManager, type DappSessionManager } from "@cypheria/wallet-provider"
import {
  type CodexAppServerContext,
  type StartCodexAppServerOptions,
  shutdownCodexAppServer,
  startCodexAppServer,
} from "./codex-app-server.js"
import { createDesktopNetworkCredentialStore } from "./network-credential-store.js"
import { createDesktopVaultMasterKeyProvider } from "./vault-key-provider.js"

export type DesktopRuntimeContext = {
  readonly audit: AuditLogService
  readonly automation: AutomationRuntimeService
  readonly codexAppServer?: CodexAppServerContext
  readonly dappSessions: DappSessionManager
  readonly database: OpenDatabaseResult
  readonly paths: CypheriaRuntimePaths
  readonly codexEnv: RuntimeHomeEnv
  readonly runtime: CypheriaRuntime
  readonly policies: SigningPolicyRuntimeService
  readonly networks: NetworkManager
  readonly signingIntents: SigningIntentRuntimeService
  readonly vault: WalletVaultController
  readonly wallets: WalletManager
}

export type DesktopRuntimeOptions = CypheriaRuntimeOptions & {
  readonly automation?: Omit<AutomationRuntimeServiceOptions, "audit" | "persistence">
  readonly codexAppServer?: Omit<StartCodexAppServerOptions, "clientVersion" | "codexEnv" | "paths">
  readonly clientVersion?: string
  readonly ethereumProvider?: Partial<
    Omit<
      EthereumProviderRuntimeServiceOptions,
      "audit" | "networks" | "persistence" | "router" | "sessions"
    >
  >
  readonly solanaProvider?: Partial<
    Omit<SolanaProviderRuntimeServiceOptions, "audit" | "networks" | "persistence" | "sessions">
  >
  readonly startCodexAppServer?: boolean
  readonly vaultKeyProvider?: VaultMasterKeyProvider
}

export const initializeDesktopRuntime = async (
  options: DesktopRuntimeOptions = {}
): Promise<DesktopRuntimeContext> => {
  const {
    automation: automationOptions,
    clientVersion,
    codexAppServer: codexAppServerOptions,
    ethereumProvider: ethereumProviderOptions,
    solanaProvider: solanaProviderOptions,
    startCodexAppServer: shouldStartCodexAppServerOption,
    vaultKeyProvider,
    ...runtimeOptions
  } = options
  const paths = buildRuntimePaths(runtimeOptions)
  await ensureRuntimeDirectories(paths)
  const database = openCypheriaDatabase({ dbDir: paths.dbDir })
  const codexEnv = buildCodexEnvironment(paths)
  const shouldStartCodexAppServer = shouldStartCodexAppServerOption ?? true
  let runtime: CypheriaRuntime | undefined
  let codexAppServer: CodexAppServerContext | undefined

  try {
    await applyDatabaseMigrations(database.client)
    const audit = createAuditLogService(database.db)
    const networkPersistence = createNetworkPersistenceService(database.db)
    await networkPersistence.reconcileCatalog()
    const walletPersistence = createWalletPublicStatePersistenceService(database.db)
    const walletProviderPersistence = createWalletProviderPersistenceService(database.db)
    const automation = createAutomationRuntimeService({
      ...automationOptions,
      audit,
      persistence: createAutomationPersistenceService(database.db),
    })
    const networkCredentials = createDesktopNetworkCredentialStore(paths.configDir)
    const networkRouter = new NetworkRpcRouter({
      credentials: networkCredentials,
      persistence: networkPersistence,
    })
    const networks = createNetworkManager({
      audit,
      credentials: networkCredentials,
      lifecycle: {
        clearWorkspaceContext: async (networkId) => {
          await walletPersistence.clearActiveContextForNetwork(networkId)
        },
        failPendingWork: async (chainKey) => {
          networkRouter.invalidateChain(chainKey)
        },
        pauseAutomations: async (chainKey) => {
          const tasks = await automation.listTasks("enabled")
          await Promise.all(
            tasks
              .filter((task) => task.walletPolicyScope.chainKeys.includes(chainKey))
              .map((task) => automation.pauseTask(task.id, task.revision))
          )
        },
        revokeDappGrants: async (_networkId, chainKey) => {
          await walletProviderPersistence.revokeChainPermissions(chainKey)
        },
      },
      persistence: networkPersistence,
      router: networkRouter,
    })
    const vault = createWalletVaultController({
      codec: createWalletKeystoreCodec(),
      keyProvider: vaultKeyProvider ?? createDesktopVaultMasterKeyProvider(paths.configDir),
      vaultDir: paths.vaultDir,
    })
    const wallets = createWalletManager({
      audit,
      networks: networkPersistence,
      persistence: walletPersistence,
      vault,
    })
    const policies = createSigningPolicyRuntimeService({
      audit,
      persistence: createSigningPolicyPersistenceService(database.db),
      wallets: walletPersistence,
    })
    const signingIntents = createSigningIntentRuntimeService({
      audit,
      persistence: createSigningIntentPersistenceService(database.db),
      policies,
    })
    const dappSessions = createDappSessionManager({ persistence: walletProviderPersistence })
    const ethereumProvider = createEthereumProviderRuntimeService({
      executeSigningIntent:
        ethereumProviderOptions?.executeSigningIntent ??
        (async () => {
          throw new Error("Ethereum signing is not configured.")
        }),
      getActiveSigningContext:
        ethereumProviderOptions?.getActiveSigningContext ?? (async () => undefined),
      permissionAuthorizer:
        ethereumProviderOptions?.permissionAuthorizer ?? (async () => undefined),
      ...ethereumProviderOptions,
      audit,
      networks,
      persistence: walletProviderPersistence,
      router: networkRouter,
      sessions: dappSessions,
      signingIntents,
    })
    const solanaProvider = createSolanaProviderRuntimeService({
      executeSigningIntent:
        solanaProviderOptions?.executeSigningIntent ??
        (async () => {
          throw new Error("Solana signing is not configured.")
        }),
      permissionAuthorizer: solanaProviderOptions?.permissionAuthorizer ?? (() => undefined),
      ...solanaProviderOptions,
      audit,
      networks,
      persistence: walletProviderPersistence,
      sessions: dappSessions,
      signingIntents,
    })
    const providerService = {
      handlers: [...(ethereumProvider.handlers ?? []), ...(solanaProvider.handlers ?? [])],
      name: "wallet-provider",
      namespace: "dapp" as const,
    }
    runtime = new CypheriaRuntime({
      ...runtimeOptions,
      ensureDirectories: false,
      services: [...(runtimeOptions.services ?? []), automation, providerService],
    })
    await runtime.start()
    codexAppServer = shouldStartCodexAppServer
      ? await startCodexAppServer({
          ...codexAppServerOptions,
          clientVersion: clientVersion ?? "0.0.0",
          codexEnv,
          paths,
        })
      : undefined
    return {
      audit,
      automation,
      codexAppServer,
      database,
      dappSessions,
      networks,
      paths: runtime.paths,
      codexEnv,
      policies,
      runtime,
      signingIntents,
      vault,
      wallets,
    }
  } catch (error) {
    try {
      await runtime?.stop()
    } finally {
      database.close()
    }
    throw error
  }
}

export const shutdownDesktopRuntime = async (context: DesktopRuntimeContext): Promise<void> => {
  try {
    if (context.codexAppServer) {
      await shutdownCodexAppServer(context.codexAppServer)
    }
  } finally {
    try {
      await context.runtime.stop()
    } finally {
      context.database.close()
    }
  }
}
