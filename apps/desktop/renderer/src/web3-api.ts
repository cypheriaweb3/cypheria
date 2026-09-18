import { ensureCypheriaClient } from "./cypheria-client.js"

/** Renderer-safe adapter preserving the established Desktop view contracts over Cypheria API. */
export const web3Api = {
  approval: {
    decide: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["approvals"]["decide"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.approvals.decide(input),
    list: async (status?: "approved" | "expired" | "pending" | "rejected") =>
      (await ensureCypheriaClient()).web3.approvals.list({ status }),
  },
  audit: {
    list: async (limit?: number) => (await ensureCypheriaClient()).web3.audit.list({ limit }),
  },
  network: {
    addEndpoint: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["networks"]["addEndpoint"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.networks.addEndpoint(input),
    create: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["networks"]["create"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.networks.create(input),
    list: async () => (await ensureCypheriaClient()).web3.networks.list(),
    probeEndpoint: async (endpointId: string) =>
      (await ensureCypheriaClient()).web3.networks.probeEndpoint(endpointId as never),
    remove: async (networkId: string, confirmed: boolean) =>
      (await ensureCypheriaClient()).web3.networks.remove({
        confirmed,
        networkId: networkId as never,
      }),
    removeEndpoint: async (endpointId: string) =>
      (await ensureCypheriaClient()).web3.networks.removeEndpoint(endpointId as never),
    reorder: async (networkIds: readonly string[]) =>
      (await ensureCypheriaClient()).web3.networks.reorder(networkIds as never),
    reorderEndpoints: async (networkId: string, endpointIds: readonly string[]) =>
      (await ensureCypheriaClient()).web3.networks.reorderEndpoints({
        endpointIds: endpointIds as never,
        networkId: networkId as never,
      }),
    setEnabled: async (networkId: string, enabled: boolean, expectedRevision: number) =>
      (await ensureCypheriaClient()).web3.networks.setEnabled({
        enabled,
        expectedRevision,
        networkId: networkId as never,
      }),
    setEndpointEnabled: async (endpointId: string, enabled: boolean, expectedRevision: number) =>
      (await ensureCypheriaClient()).web3.networks.setEndpointEnabled({
        enabled,
        endpointId: endpointId as never,
        expectedRevision,
      }),
  },
  policy: {
    create: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["policies"]["create"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.policies.create(input),
    disable: async (policyId: string, expectedRevision: number) =>
      (await ensureCypheriaClient()).web3.policies.disable({ expectedRevision, policyId }),
    list: async () => (await ensureCypheriaClient()).web3.policies.list(),
    update: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["policies"]["update"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.policies.update(input),
  },
  wallet: {
    addWatch: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["wallets"]["addWatch"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.wallets.addWatch(input),
    clearActive: async () => (await ensureCypheriaClient()).web3.wallets.clearActive(),
    delete: async (walletId: string) =>
      (await ensureCypheriaClient()).web3.wallets.delete(walletId as never),
    deriveHdAccount: async (input: { name?: string; walletId: string }) =>
      (await ensureCypheriaClient()).web3.wallets.derive({
        ...input,
        walletId: input.walletId as never,
      }),
    generateHd: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["wallets"]["generate"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.wallets.generate(input),
    getActive: async () => (await ensureCypheriaClient()).web3.wallets.getActive(),
    importHd: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["wallets"]["importHd"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.wallets.importHd(input),
    importPrivateKey: async (
      input: Parameters<
        Awaited<ReturnType<typeof ensureCypheriaClient>>["web3"]["wallets"]["importPrivateKey"]
      >[0]
    ) => (await ensureCypheriaClient()).web3.wallets.importPrivateKey(input),
    list: async () => (await ensureCypheriaClient()).web3.wallets.list(),
    lock: async (walletId: string) =>
      (await ensureCypheriaClient()).web3.wallets.lock(walletId as never),
    rename: async (walletId: string, name: string) =>
      (await ensureCypheriaClient()).web3.wallets.rename({ name, walletId: walletId as never }),
    reorder: async (walletIds: readonly string[]) =>
      (await ensureCypheriaClient()).web3.wallets.reorder(walletIds as never),
    reorderAccounts: async (walletId: string, walletAccountIds: readonly string[]) =>
      (await ensureCypheriaClient()).web3.wallets.reorderAccounts({
        walletAccountIds: walletAccountIds as never,
        walletId: walletId as never,
      }),
    setActive: async (input: {
      chainAccountId: string
      mode: "conditional-auto-signing" | "human-approval" | "read-only"
      networkId: string
      walletAccountId: string
      walletId: string
    }) =>
      (await ensureCypheriaClient()).web3.wallets.setActive({
        ...input,
        chainAccountId: input.chainAccountId as never,
        networkId: input.networkId as never,
        walletAccountId: input.walletAccountId as never,
        walletId: input.walletId as never,
      }),
    unlock: async (walletId: string) =>
      (await ensureCypheriaClient()).web3.wallets.unlock(walletId as never),
  },
} as const
