const http = require("node:http")
const path = require("node:path")
const { app, BrowserWindow, ipcMain } = require("electron")

const channel = "dapp.provider.request"
const eventChannel = "dapp.provider.event"
const ethereumAccount = "0x0000000000000000000000000000000000000001"
const account = {
  address: "11111111111111111111111111111111",
  chains: ["solana:mainnet"],
  features: ["solana:signMessage"],
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
}

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Security-Policy": "default-src 'none'",
    "Content-Type": "text/html; charset=utf-8",
  })
  response.end("<!doctype html><title>Wallet provider smoke test</title>")
})

const fail = (error) => {
  console.error(error instanceof Error ? error.stack : error)
  app.exit(1)
}

app
  .whenReady()
  .then(async () => {
    ipcMain.handle(channel, (event, request) => {
      if (request.method === "eth_chainId") {
        event.sender.send(eventChannel, {
          event: "ethereum.accountsChanged",
          origin: request.origin,
          payload: [ethereumAccount],
          sessionKey: request.sessionKey,
        })
        event.sender.send(eventChannel, {
          event: "solana.accountsChanged",
          origin: request.origin,
          payload: [account],
          sessionKey: request.sessionKey,
        })
        return { id: request.id, result: "0x1" }
      }
      if (request.method === "standard:connect") {
        return { id: request.id, result: { accounts: [account] } }
      }
      if (request.method === "solana:signMessage") {
        return {
          id: request.id,
          result: request.input.map((input) => ({
            signature:
              "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
            signatureType: "ed25519",
            signedMessage: input.message,
          })),
        }
      }
      return { error: { code: 4200, message: "Unsupported smoke-test method." }, id: request.id }
    })

    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing HTTP test address.")

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve(__dirname, "../dist/dapp-preload/index.cjs"),
        sandbox: true,
        webSecurity: true,
      },
    })
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.error(`Preload error in ${preloadPath}:`, error)
    })
    window.webContents.on("console-message", (_event, details) => {
      console.error(`Renderer console (${details.level}): ${details.message}`)
    })
    await window.loadURL(`http://127.0.0.1:${address.port}`)
    const result = await window.webContents.executeJavaScript(`
    new Promise(async (resolve, reject) => {
      try {
        let ethereumDetail
        addEventListener("eip6963:announceProvider", (event) => { ethereumDetail = event.detail })
        dispatchEvent(new Event("eip6963:requestProvider"))
        let solanaWallet
        dispatchEvent(new CustomEvent("wallet-standard:app-ready", {
          detail: { register(wallet) { solanaWallet = wallet; return () => undefined } }
        }))
        let ethereumEvent
        let solanaEvent
        globalThis.ethereum.on("accountsChanged", (accounts) => { ethereumEvent = accounts[0] })
        solanaWallet.features["standard:events"].on("change", (change) => {
          solanaEvent = change.accounts?.[0]?.address
        })
        const chainId = await globalThis.ethereum.request({ method: "eth_chainId" })
        await new Promise((done) => setTimeout(done, 25))
        const connected = await solanaWallet.features["standard:connect"].connect()
        const [signed] = await solanaWallet.features["solana:signMessage"].signMessage({
          account: connected.accounts[0],
          message: new Uint8Array([1, 2, 3]),
        })
        resolve({
          chainId,
          contextIsolated: typeof globalThis.process === "undefined",
          ethereumDiscovered: ethereumDetail?.provider === globalThis.ethereum,
          ethereumEvent,
          solanaAccount: connected.accounts[0]?.address,
          solanaDiscovered: solanaWallet?.name === "Cypheria",
          solanaEvent,
          solanaSignatureLength: signed.signature.length,
        })
      } catch (error) {
        reject(String(error?.stack || error))
      }
    })
  `)
    const expected = {
      chainId: "0x1",
      contextIsolated: true,
      ethereumDiscovered: true,
      ethereumEvent: ethereumAccount,
      solanaAccount: account.address,
      solanaDiscovered: true,
      solanaEvent: account.address,
      solanaSignatureLength: 64,
    }
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected Electron wallet-provider result: ${JSON.stringify(result)}`)
    }
    console.log(JSON.stringify(result))
    window.destroy()
    server.close()
    app.exit(0)
  })
  .catch(fail)

setTimeout(() => fail(new Error("Electron wallet-provider smoke test timed out.")), 15_000).unref()
