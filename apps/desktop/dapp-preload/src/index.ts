import {
  base64ToBytes,
  createEip6963ProviderDetail,
  createEthereumProvider,
  createSolanaWallet,
  installEip6963ProviderInMainWorld,
  installSolanaWalletInMainWorld,
  updateSolanaWalletAccountsInMainWorld,
  walletProviderEventSchema,
} from "@cypheria/wallet-provider"
import { SOLANA_CHAINS } from "@solana/wallet-standard-chains"
import { contextBridge, ipcRenderer } from "electron"

import { CYPHERIA_IPC_CHANNELS } from "../../ipc/src/index.js"

const ethereum = createEthereumProvider({
  origin: globalThis.location.origin,
  transport: (request) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.dappProviderRequest, request),
})

const icon =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAnUlEQVR42u3RQQ0AAAgDsbmYf6Ugg4T0cQauaTu6KyYAACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAAAJgAAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAPrRgdZKkJSVs4wAAAABJRU5ErkJggg==" as const

const solana = createSolanaWallet({
  chains: SOLANA_CHAINS,
  icon,
  name: "Cypheria",
  origin: globalThis.location.origin,
  transport: (request) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.dappProviderRequest, request),
})

const copySolanaAccount = (account: (typeof solana.wallet.accounts)[number]) => ({
  address: account.address,
  chains: [...account.chains],
  features: [...account.features],
  ...(account.icon ? { icon: account.icon } : {}),
  ...(account.label ? { label: account.label } : {}),
  publicKey: new Uint8Array(account.publicKey),
})

const solanaContextBridge = {
  accounts: solana.wallet.accounts.map(copySolanaAccount),
  chains: [...solana.wallet.chains],
  features: {
    "standard:connect": {
      connect: async (input?: { readonly silent?: boolean }) => {
        const output = await solana.wallet.features["standard:connect"].connect(input)
        return { accounts: output.accounts.map(copySolanaAccount) }
      },
      version: "1.0.0" as const,
    },
    "standard:disconnect": solana.wallet.features["standard:disconnect"],
    "standard:events": {
      on: (
        event: "change",
        listener: (properties: { readonly accounts?: readonly unknown[] }) => void
      ) =>
        solana.wallet.features["standard:events"].on(event, (properties) =>
          listener({
            ...properties,
            ...(properties.accounts
              ? { accounts: properties.accounts.map(copySolanaAccount) }
              : {}),
          })
        ),
      version: "1.0.0" as const,
    },
    "solana:signAndSendTransaction": solana.wallet.features["solana:signAndSendTransaction"],
    "solana:signMessage": solana.wallet.features["solana:signMessage"],
    "solana:signTransaction": solana.wallet.features["solana:signTransaction"],
  },
  icon: solana.wallet.icon,
  name: solana.wallet.name,
  version: solana.wallet.version,
}

const detail = createEip6963ProviderDetail(
  {
    icon,
    name: "Cypheria",
    rdns: "io.cypheria.wallet",
    uuid: globalThis.crypto.randomUUID(),
  },
  ethereum.provider
)

ipcRenderer.on(CYPHERIA_IPC_CHANNELS.dappProviderEvent, (_event, eventValue: unknown) => {
  const event = walletProviderEventSchema.parse(eventValue)
  if (event.origin !== globalThis.location.origin) return
  switch (event.event) {
    case "ethereum.accountsChanged":
      ethereum.emit("accountsChanged", event.payload)
      break
    case "ethereum.chainChanged":
      ethereum.emit("chainChanged", event.payload)
      break
    case "ethereum.connect":
      ethereum.emit("connect", event.payload)
      break
    case "ethereum.disconnect":
      ethereum.emit("disconnect", event.payload)
      break
    case "ethereum.message":
      ethereum.emit("message", event.payload)
      break
    case "solana.accountsChanged":
      solana.setAccounts(event.payload)
      contextBridge.executeInMainWorld({
        args: [
          event.payload.map((account) => ({
            ...account,
            publicKey: base64ToBytes(account.publicKey),
          })),
        ],
        func: updateSolanaWalletAccountsInMainWorld,
      })
      break
  }
})

contextBridge.exposeInMainWorld("ethereum", ethereum.provider)
contextBridge.exposeInMainWorld("cypheriaSolana", solanaContextBridge)
contextBridge.executeInMainWorld({
  args: [detail.info, "ethereum"],
  func: installEip6963ProviderInMainWorld,
})
contextBridge.executeInMainWorld({
  args: ["cypheriaSolana"],
  func: installSolanaWalletInMainWorld,
})
