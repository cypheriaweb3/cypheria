import { open, stat } from "node:fs/promises"

import type { ChromeBrowserInfo } from "../browser/types.ts"
import {
  type CuaAudioRecording,
  CuaDeviceRequestSchema,
  type ParsedCuaDeviceRequest,
} from "../protocol.ts"
import type { ChromeSessions } from "./chrome/sessions.ts"
import type { NativeAppsBackend } from "./computer/types.ts"
import { CuaHostError } from "./errors.ts"

/** The Thread a device request runs for, as the Server stated it. */
export type CuaDeviceContext = { readonly threadId: string; readonly cwd?: string }

export type CuaDeviceOptions = {
  /** The device's `chrome` browsers, through the driver its settings select. */
  readonly chrome?: () => ChromeSessions | undefined
  /** Native apps on this device, through the backend its settings select. */
  readonly computer?: () => NativeAppsBackend | undefined
}

/**
 * The device side of Computer Use: it runs on the Desktop that hosts the person's browsers and
 * apps, executing what the Server routed to it. The Server owns policy and audit; this side
 * re-validates every request and keeps per-Thread state, such as tabs a Thread opened.
 */
export class CuaDevice {
  readonly #options: CuaDeviceOptions
  /** Each Thread's latest finished audio recording, which the Server reads in pieces. */
  readonly #recordings = new Map<string, { path: string; size: number }>()

  constructor(options: CuaDeviceOptions) {
    this.#options = options
  }

  /** Whether this device can serve its external browsers and its native apps right now. */
  get capabilities(): { readonly chrome: boolean; readonly computer: boolean } {
    return { chrome: !!this.#options.chrome?.(), computer: !!this.#options.computer?.() }
  }

  async handle(input: unknown, context: CuaDeviceContext): Promise<unknown> {
    const parsed = CuaDeviceRequestSchema.safeParse(input)
    if (!parsed.success) {
      throw new CuaHostError(
        "invalid",
        `Invalid device request: ${parsed.error.issues[0]?.message ?? "malformed"}`
      )
    }
    return this.#dispatch(parsed.data, context)
  }

  async #dispatch(request: ParsedCuaDeviceRequest, context: CuaDeviceContext): Promise<unknown> {
    const { threadId } = context
    switch (request.op) {
      case "device.turnEnded":
        await this.#options.chrome?.()?.turnEnded(threadId)
        await this.#options.computer?.()?.turnEnded?.(threadId)
        return null
      case "device.closeThread":
        this.#recordings.delete(threadId)
        this.#options.chrome?.()?.closeThread(threadId)
        this.#options.computer?.()?.closeThread(threadId)
        return null
      case "apps.list":
        return this.#computer().listApps(threadId)
      case "apps.windows":
        return this.#computer().listWindows(threadId, request.pid)
      case "apps.get":
        return this.#computer().getApp(threadId, request.app)
      case "apps.observe":
        return this.#computer().observe(threadId, request.handle, request)
      case "apps.act":
        return this.#computer().act(threadId, request.handle, request.action)
      case "apps.launch":
        return this.#computer().launchApp(threadId, request.app)
      case "apps.audio.start": {
        const computer = this.#computer()
        if (!computer.startAudioRecording) throw unsupportedAudio()
        this.#recordings.delete(threadId)
        await computer.startAudioRecording(threadId, request.maxDurationMs)
        return null
      }
      case "apps.audio.stop": {
        const computer = this.#computer()
        if (!computer.stopAudioRecording) throw unsupportedAudio()
        const { mimeType, path } = await computer.stopAudioRecording(threadId)
        const { size } = await stat(path)
        this.#recordings.set(threadId, { path, size })
        return { mimeType, size } satisfies CuaAudioRecording
      }
      case "apps.audio.read":
        return this.#readAudio(threadId, request.offset, request.length)
      case "browsers.list": {
        const chrome = this.#options.chrome?.()
        return chrome ? chrome.list() : ([] satisfies ChromeBrowserInfo[])
      }
      case "browser.call":
        return this.#chrome().call(request, context)
    }
  }

  async #readAudio(threadId: string, offset: number, length: number): Promise<string> {
    const recording = this.#recordings.get(threadId)
    if (!recording) {
      throw new CuaHostError(
        "invalid",
        "No finished computer audio recording; call cua.computer.stop_audio_recording() first."
      )
    }
    const size = Math.max(0, Math.min(length, recording.size - offset))
    const buffer = Buffer.alloc(size)
    const file = await open(recording.path, "r")
    try {
      const { bytesRead } = await file.read(buffer, 0, size, offset)
      return buffer.subarray(0, bytesRead).toString("base64")
    } finally {
      await file.close()
    }
  }

  #chrome(): ChromeSessions {
    const chrome = this.#options.chrome?.()
    if (!chrome) {
      throw new CuaHostError(
        "unavailable",
        "External browser control is unavailable on this device."
      )
    }
    return chrome
  }

  #computer(): NativeAppsBackend {
    const computer = this.#options.computer?.()
    if (!computer) {
      throw new CuaHostError("unavailable", "Native app control is unavailable on this device.")
    }
    return computer
  }
}

const unsupportedAudio = () =>
  new CuaHostError(
    "unsupported",
    "This device's native app backend cannot record computer audio; ChatGPT's Computer Use can, on macOS."
  )
