import { createProviderBridge } from "@cypheria/web3-browser"
import { contextBridge, ipcRenderer } from "electron"

import { CYPHERIA_IPC_CHANNELS } from "../../ipc/src/index.js"

const provider = createProviderBridge({
  origin: globalThis.location.origin,
  transport: (request) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.dappProviderRequest, request),
})

contextBridge.exposeInMainWorld("ethereum", Object.freeze({ request: provider.request }))
