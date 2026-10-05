import { detectFamily, ExtensionBackend } from "../src/backend.ts"
import type { ChromeApi } from "../src/chrome-api.ts"
import { NativeConnection } from "../src/native-port.ts"

const RECONNECT_ALARM = "cypheria.native-reconnect"
const STATUS_KEY = "status"

export default defineBackground({
  main() {
    const api = chrome as unknown as ChromeApi
    const connection: NativeConnection = new NativeConnection({
      connectNative: (name) => chrome.runtime.connectNative(name),
      extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
      lastError: () => chrome.runtime.lastError?.message,
      onRequest: (method, params) => backend.handle(method, params),
      onStatus: (status) => {
        void chrome.storage.session.set({ [STATUS_KEY]: status }).catch(() => undefined)
        void chrome.action
          .setBadgeText({ text: status.state === "connected" ? "" : "!" })
          .catch(() => undefined)
      },
      // Timers stop while the worker sleeps; the alarm wakes it to retry.
      scheduleWakeup: (delayMs) => {
        void chrome.alarms.create(RECONNECT_ALARM, {
          delayInMinutes: Math.max(0.5, delayMs / 60_000),
        })
      },
    })
    const backend = new ExtensionBackend({
      chrome: api,
      family: detectFamily(navigator as never),
      notify: (method, params) => connection.notify(method, params),
    })
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RECONNECT_ALARM) connection.connect()
    })
    chrome.runtime.onStartup.addListener(() => connection.connect())
    chrome.runtime.onInstalled.addListener(() => connection.connect())
    connection.connect()
  },
})
