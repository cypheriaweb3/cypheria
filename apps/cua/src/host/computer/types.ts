import type {
  AppAction,
  AppBinding,
  AppHandle,
  AppInfo,
  CuaObservation,
  WindowInfo,
} from "../../protocol.ts"

/**
 * Native app control on one device, whichever backend its settings select: cua-driver, or the
 * Codex Computer Use runtime of the user's installed ChatGPT on macOS. Element indices in an
 * observation belong to that window's latest state.
 */
export interface NativeAppsBackend {
  listApps(threadId: string): Promise<AppInfo[]>
  listWindows(threadId: string, pid?: number): Promise<WindowInfo[]>
  /** Binds an app's window, opening the app in the background on macOS when needed. */
  getApp(
    threadId: string,
    target: string | { windowId: number }
  ): Promise<{ binding: AppBinding; observation: CuaObservation }>
  observe(
    threadId: string,
    handle: AppHandle,
    options: { screenshot?: boolean; tree?: boolean; query?: string }
  ): Promise<CuaObservation>
  act(threadId: string, handle: AppHandle, action: AppAction): Promise<{ notice?: string }>
  launchApp(threadId: string, app: string): Promise<void>
  /** Starts recording the computer's audio; backends that cannot record leave both out. */
  startAudioRecording?(threadId: string, maxDurationMs?: number): Promise<void>
  /** Stops the recording and says where the backend saved it on this device. */
  stopAudioRecording?(threadId: string): Promise<{ path: string; mimeType: string }>
  turnEnded?(threadId: string): Promise<void>
  closeThread(threadId: string): void
}
