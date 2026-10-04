// Adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/desktop/src/features/browser-automation/service.ts.
import { realpathSync } from "node:fs"
import { isAbsolute, relative, resolve as resolvePath } from "node:path"
import type {
  BrowserAutomationCommand,
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationDialogEvent,
  BrowserAutomationErrorCode,
  BrowserAutomationNetworkLogEntry,
  BrowserAutomationOutcome,
  BrowserAutomationRequest,
  BrowserTabKind,
} from "@cypheria/protocol"
import jsQR from "jsqr"
import { type ActionabilityResult, waitForActionableTarget } from "./actionability.js"
import { BrowserSnapshotEngine, type SnapshotPage } from "./snapshot-engine.js"
import {
  type ClickInputOptions,
  dispatchTrustedClick,
  dispatchTrustedDrag,
  dispatchTrustedHover,
  dispatchTrustedKey,
  dispatchTrustedScroll,
  dispatchTrustedText,
  type IsolatedKeyboardInputEvent,
} from "./trusted-input.js"

export interface TabContents {
  readonly id: number
  getURL(): string
  getTitle(): string
  canGoBack(): boolean
  canGoForward(): boolean
  isLoading(): boolean
  isDestroyed(): boolean
  executeJavaScript(code: string): Promise<unknown>
  loadURL(url: string): Promise<void>
  goBack(): void
  goForward(): void
  reload(): void
  captureFrame(signal: AbortSignal): Promise<TabImage>
  invalidate(): void
  withFrameProduction<T>(capture: () => Promise<T>): Promise<T>
  sendInputEvent(event: IsolatedKeyboardInputEvent): void
  getConsoleMessages?(): BrowserAutomationConsoleLogEntry[]
  captureDialogs?<T>(
    task: () => Promise<T>
  ): Promise<{ result: T; dialogs: BrowserAutomationDialogEvent[] }>
  sendDebugCommand?(command: string, params?: Record<string, unknown>): Promise<unknown>
}

export interface TabImage {
  toPNG(): Uint8Array
  getSize(): { width: number; height: number }
  toBitmap?(): Uint8Array | Buffer
  crop?(rect: { x: number; y: number; width: number; height: number }): TabImage
}

export interface BrowserRegistry {
  listRegisteredBrowserIds(): string[]
  listRegisteredBrowserIdsForThread(threadId: string): string[]
  getTabContents(browserId: string): TabContents | null
  getBrowserThreadId(browserId: string): string | null
  getThreadActiveBrowserId(threadId: string): string | null
  getBrowserKind(browserId: string): BrowserTabKind
  activateTab?(browserId: string): void
}

export type AutomationCommandPayload = BrowserAutomationOutcome
type FailurePayload = Extract<AutomationCommandPayload, { ok: false }>

const defaultSnapshotEngine = new BrowserSnapshotEngine()
const DEFAULT_WAIT_TIMEOUT_MS = 5_000
const WAIT_POLL_INTERVAL_MS = 25
const PIXEL_CAPTURE_TIMEOUT_MS = 5_000
const PIXEL_CAPTURE_RETRY_INTERVAL_MS = 200
const SCREENSHOT_NO_FRAME_MESSAGE = "The tab has not painted yet. Retry the screenshot."
const ALLOWED_PAGE_URL_PROTOCOLS = new Set(["http:", "https:"])
const MAX_EVALUATE_RESULT_JSON_LENGTH = 80_000
const MAX_EVALUATE_RESULT_PREVIEW_LENGTH = 79_000
const MAX_EVALUATE_ERROR_MESSAGE_LENGTH = 2_000
let pixelCaptureQueue: Promise<void> = Promise.resolve()

function fail(
  automationId: string,
  code: BrowserAutomationErrorCode,
  message: string,
  retryable = false
): FailurePayload {
  return { automationId, ok: false, error: { code, message, retryable } }
}

async function withDialogCapture(
  contents: TabContents,
  task: () => Promise<AutomationCommandPayload>
): Promise<AutomationCommandPayload> {
  if (!contents.captureDialogs) {
    return task()
  }
  const { result, dialogs } = await contents.captureDialogs(task)
  return dialogs.length > 0 ? { ...result, dialogs } : result
}

export class BrowserTabClosedError extends Error {
  public constructor() {
    super("Browser tab has been closed")
    this.name = "BrowserTabClosedError"
  }
}

class ScreenshotNoFrameError extends Error {
  public constructor(message = SCREENSHOT_NO_FRAME_MESSAGE) {
    super(message)
    this.name = "ScreenshotNoFrameError"
  }
}

function isScreenshotNoFrameError(error: unknown): error is ScreenshotNoFrameError {
  return error instanceof ScreenshotNoFrameError
}

function screenshotNoFrameFailure(
  automationId: string,
  error: ScreenshotNoFrameError
): FailurePayload {
  return fail(automationId, "screenshot_no_frame", error.message, true)
}

async function withPixelCaptureTimeout<T>(
  capture: Promise<T>,
  timeoutMs = PIXEL_CAPTURE_TIMEOUT_MS
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new ScreenshotNoFrameError()
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ScreenshotNoFrameError())
    }, timeoutMs)
  })

  try {
    return await Promise.race([capture, timeout])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function runSerializedPixelCapture<T>(capture: () => Promise<T>): Promise<T> {
  const previous = pixelCaptureQueue
  let releaseCurrent = () => {}
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  pixelCaptureQueue = tail

  await previous.catch(() => {})
  try {
    return await capture()
  } finally {
    releaseCurrent()
    if (pixelCaptureQueue === tail) {
      pixelCaptureQueue = Promise.resolve()
    }
  }
}

async function capturePixelFrameWithRetry<T>(
  contents: TabContents,
  capture: () => Promise<T>,
  deadline: number
): Promise<T> {
  while (Date.now() < deadline) {
    try {
      contents.invalidate()
      return await withPixelCaptureTimeout(capture(), deadline - Date.now())
    } catch (error) {
      if (isScreenshotNoFrameError(error)) {
        throw error
      }
      if (!isKnownNoFrameCaptureError(error)) {
        throw error
      }
      await delay(Math.min(PIXEL_CAPTURE_RETRY_INTERVAL_MS, Math.max(0, deadline - Date.now())))
    }
  }
  throw new ScreenshotNoFrameError()
}

function isKnownNoFrameCaptureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("UnknownVizError") ||
    message.includes("No frame") ||
    message.includes("no painted frame")
  )
}

async function waitForPaint(contents: TabContents, deadline: number): Promise<void> {
  // A hidden page may have unpainted DOM updates. The first animation callback
  // precedes paint; the next frame ensures capture cannot reuse the old surface.
  await withPixelCaptureTimeout(
    contents.executeJavaScript(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))"
    ),
    deadline - Date.now()
  )
}

async function runPaintedPixelCapture<T>(
  contents: TabContents,
  capture: () => Promise<T>
): Promise<T> {
  return runSerializedPixelCapture(() =>
    contents.withFrameProduction(async () => {
      const deadline = Date.now() + PIXEL_CAPTURE_TIMEOUT_MS
      await waitForPaint(contents, deadline)
      return capturePixelFrameWithRetry(contents, capture, deadline)
    })
  )
}

async function capturePaintedViewport(contents: TabContents): Promise<TabImage> {
  return runSerializedPixelCapture(() =>
    contents.withFrameProduction(async () => {
      const deadline = Date.now() + PIXEL_CAPTURE_TIMEOUT_MS
      const controller = new AbortController()
      try {
        await waitForPaint(contents, deadline)
        contents.invalidate()
        return await withPixelCaptureTimeout(
          contents.captureFrame(controller.signal),
          deadline - Date.now()
        )
      } finally {
        controller.abort()
      }
    })
  )
}

function tabInfoFromContents(
  browserId: string,
  contents: TabContents,
  activeBrowserId: string | null,
  threadId: string,
  kind: BrowserTabKind
) {
  return {
    browserId,
    kind,
    threadId,
    url: contents.getURL(),
    title: contents.getTitle(),
    isActive: activeBrowserId === browserId,
    isLoading: contents.isLoading(),
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
  }
}

export function executeAutomationCommand(
  request: BrowserAutomationRequest,
  registry: BrowserRegistry,
  options?: { snapshotEngine?: BrowserSnapshotEngine }
): AutomationCommandPayload | Promise<AutomationCommandPayload> {
  const { automationId, command } = request
  const threadId = request.threadId
  const snapshotEngine = options?.snapshotEngine ?? defaultSnapshotEngine
  const handler = commandHandlers[command.command]

  return handler({ request, command, automationId, threadId, registry, snapshotEngine })
}

interface CommandHandlerContext {
  request: BrowserAutomationRequest
  command: BrowserAutomationCommand
  automationId: string
  threadId: string | undefined
  registry: BrowserRegistry
  snapshotEngine: BrowserSnapshotEngine
}

type CommandHandler = (
  context: CommandHandlerContext
) => AutomationCommandPayload | Promise<AutomationCommandPayload>

export function elementExpressionFromSelector(selector: string): string {
  if (selector.startsWith("//") || selector.startsWith("(//") || selector.startsWith("xpath=")) {
    const rawXpath = selector.startsWith("xpath=") ? selector.slice(6) : selector
    return `(() => {
      const res = document.evaluate(${JSON.stringify(rawXpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return res.singleNodeValue instanceof Element ? res.singleNodeValue : null;
    })()`
  }
  return `document.querySelector(${JSON.stringify(selector)})`
}

interface TargetPointInput {
  ref?: string
  selector?: string
  point?: { x: number; y: number }
  x?: number
  y?: number
}

async function resolveActionablePoint(input: {
  automationId: string
  browserId: string
  contents: TabContents
  snapshotEngine: BrowserSnapshotEngine
  target: TargetPointInput
  targetName?: string
  editable?: boolean
}): Promise<{ ok: true; point: { x: number; y: number } } | FailurePayload> {
  const {
    automationId,
    browserId,
    contents,
    snapshotEngine,
    target,
    targetName = "target",
    editable,
  } = input

  if (target.point) {
    return { ok: true, point: target.point }
  }
  if (typeof target.x === "number" && typeof target.y === "number") {
    return { ok: true, point: { x: target.x, y: target.y } }
  }

  let elementExpression: string | null = null
  let usingRef = false

  if (target.ref) {
    const expr = snapshotEngine.runtimeElementExpression({ browserId, ref: target.ref })
    if (typeof expr === "string") {
      elementExpression = expr
      usingRef = true
    } else if (!target.selector) {
      return staleRefFailure(automationId, target.ref)
    }
  }

  if (!elementExpression && target.selector) {
    elementExpression = elementExpressionFromSelector(target.selector)
  }

  if (!elementExpression) {
    return fail(
      automationId,
      "browser_target_not_found",
      `No ref, selector, or point was specified for ${targetName}.`
    )
  }

  const actionable = await waitForActionableTarget({
    page: contents,
    elementExpression,
    editable,
  })

  if (!actionable.ok) {
    if (usingRef && target.ref) {
      return actionabilityFailure(automationId, target.ref, actionable)
    }
    return fail(
      automationId,
      "browser_target_not_found",
      `Element matching "${target.selector}" is ${actionable.reason === "timeout" ? (actionable.detail ?? "not actionable") : actionable.reason}.`
    )
  }

  return { ok: true, point: actionable.target.point }
}

async function executeFillElement(
  page: SnapshotPage,
  expression: string,
  value: string
): Promise<boolean> {
  const script = `(() => {
    const element = ${expression};
    if (!element || !element.isConnected) return false;
    element.scrollIntoView?.({ block: 'center', inline: 'center' });
    element.focus?.();
    const nextValue = ${JSON.stringify(value)};
    if ('value' in element) {
      element.value = nextValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    element.textContent = nextValue;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
    return true;
  })()`
  const res = await page.executeJavaScript(script)
  return res === true
}

async function executeSelectElement(
  page: SnapshotPage,
  expression: string,
  value: string
): Promise<boolean> {
  const script = `(() => {
    const element = ${expression};
    if (!element || !element.isConnected) return false;
    element.scrollIntoView?.({ block: 'center', inline: 'center' });
    element.focus?.();
    const nextValue = ${JSON.stringify(value)};
    if ('value' in element) {
      element.value = nextValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  })()`
  const res = await page.executeJavaScript(script)
  return res === true
}

const commandHandlers: Record<BrowserAutomationCommand["command"], CommandHandler> = {
  list_tabs: ({ automationId, threadId, registry }) =>
    executeListTabs(automationId, threadId, registry),
  new_tab: ({ automationId }) =>
    fail(automationId, "browser_unsupported", "browser_new_tab is handled by the app runtime."),
  list_mcp_apps: ({ automationId }) =>
    fail(automationId, "browser_unsupported", "MCP Apps are listed by the app runtime."),
  mcp_app: ({ automationId }) =>
    fail(automationId, "browser_unsupported", "MCP App actions are handled by the app runtime."),
  snapshot: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const snapshotCommand = command as Extract<BrowserAutomationCommand, { command: "snapshot" }>
    return executeSnapshot(
      automationId,
      threadId,
      snapshotCommand.args.browserId,
      registry,
      snapshotEngine
    )
  },
  click: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const clickCommand = command as Extract<BrowserAutomationCommand, { command: "click" }>
    return executeClick(
      automationId,
      threadId,
      clickCommand.args.browserId,
      {
        ref: clickCommand.args.ref,
        selector: clickCommand.args.selector,
        point: clickCommand.args.point,
      },
      {
        button: clickCommand.args.button,
        doubleClick: clickCommand.args.doubleClick,
        modifiers: clickCommand.args.modifiers,
      },
      registry,
      snapshotEngine
    )
  },
  fill: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const fillCommand = command as Extract<BrowserAutomationCommand, { command: "fill" }>
    return executeFill(
      automationId,
      threadId,
      fillCommand.args.browserId,
      {
        ref: fillCommand.args.ref,
        selector: fillCommand.args.selector,
      },
      fillCommand.args.value,
      registry,
      snapshotEngine
    )
  },
  wait: ({ command, automationId, threadId, registry }) => {
    const waitCommand = command as Extract<BrowserAutomationCommand, { command: "wait" }>
    return executeWait(
      automationId,
      threadId,
      waitCommand.args.browserId,
      {
        text: waitCommand.args.text,
        url: waitCommand.args.url,
        timeoutMs: waitCommand.args.timeoutMs,
      },
      registry
    )
  },
  type: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const typeCommand = command as Extract<BrowserAutomationCommand, { command: "type" }>
    return executeType(
      automationId,
      threadId,
      typeCommand.args.browserId,
      {
        ref: typeCommand.args.ref,
        selector: typeCommand.args.selector,
      },
      typeCommand.args.text,
      registry,
      snapshotEngine
    )
  },
  keypress: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const keypressCommand = command as Extract<BrowserAutomationCommand, { command: "keypress" }>
    return executeKeypress(
      automationId,
      threadId,
      keypressCommand.args.browserId,
      {
        ref: keypressCommand.args.ref,
        selector: keypressCommand.args.selector,
      },
      keypressCommand.args.key,
      registry,
      snapshotEngine
    )
  },
  navigate: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const navigateCommand = command as Extract<BrowserAutomationCommand, { command: "navigate" }>
    return executeNavigate(
      automationId,
      threadId,
      navigateCommand.args.browserId,
      navigateCommand.args.url,
      registry,
      snapshotEngine
    )
  },
  back: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const backCommand = command as Extract<BrowserAutomationCommand, { command: "back" }>
    return executeNavigationAction(
      automationId,
      threadId,
      backCommand.args.browserId,
      "back",
      registry,
      snapshotEngine
    )
  },
  forward: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const forwardCommand = command as Extract<BrowserAutomationCommand, { command: "forward" }>
    return executeNavigationAction(
      automationId,
      threadId,
      forwardCommand.args.browserId,
      "forward",
      registry,
      snapshotEngine
    )
  },
  reload: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const reloadCommand = command as Extract<BrowserAutomationCommand, { command: "reload" }>
    return executeNavigationAction(
      automationId,
      threadId,
      reloadCommand.args.browserId,
      "reload",
      registry,
      snapshotEngine
    )
  },
  screenshot: ({ command, automationId, threadId, registry }) => {
    const screenshotCommand = command as Extract<
      BrowserAutomationCommand,
      { command: "screenshot" }
    >
    return executeScreenshot(
      automationId,
      threadId,
      screenshotCommand.args.browserId,
      screenshotCommand.args.fullPage,
      registry
    )
  },
  upload: ({ request, command, automationId, threadId, registry, snapshotEngine }) => {
    const uploadCommand = command as Extract<BrowserAutomationCommand, { command: "upload" }>
    return executeUpload(
      automationId,
      request.cwd,
      threadId,
      uploadCommand.args.browserId,
      {
        ref: uploadCommand.args.ref,
        selector: uploadCommand.args.selector,
        filePaths: uploadCommand.args.filePaths,
      },
      registry,
      snapshotEngine
    )
  },
  select: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const selectCommand = command as Extract<BrowserAutomationCommand, { command: "select" }>
    return executeSelect(
      automationId,
      threadId,
      selectCommand.args.browserId,
      {
        ref: selectCommand.args.ref,
        selector: selectCommand.args.selector,
      },
      selectCommand.args.value,
      registry,
      snapshotEngine
    )
  },
  hover: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const hoverCommand = command as Extract<BrowserAutomationCommand, { command: "hover" }>
    return executeHover(
      automationId,
      threadId,
      hoverCommand.args.browserId,
      {
        ref: hoverCommand.args.ref,
        selector: hoverCommand.args.selector,
        point: hoverCommand.args.point,
      },
      registry,
      snapshotEngine
    )
  },
  drag: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const dragCommand = command as Extract<BrowserAutomationCommand, { command: "drag" }>
    return executeDrag(
      automationId,
      threadId,
      dragCommand.args.browserId,
      {
        ref: dragCommand.args.sourceRef,
        selector: dragCommand.args.sourceSelector,
        point: dragCommand.args.sourcePoint,
      },
      {
        ref: dragCommand.args.targetRef,
        selector: dragCommand.args.targetSelector,
        point: dragCommand.args.targetPoint,
      },
      registry,
      snapshotEngine
    )
  },
  logs: ({ command, automationId, threadId, registry }) => {
    const logsCommand = command as Extract<BrowserAutomationCommand, { command: "logs" }>
    return executeLogs(
      automationId,
      threadId,
      logsCommand.args.browserId,
      logsCommand.args.maxEntries,
      registry
    )
  },
  evaluate: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const evaluateCommand = command as Extract<BrowserAutomationCommand, { command: "evaluate" }>
    return executeEvaluate(
      automationId,
      threadId,
      evaluateCommand.args.browserId,
      evaluateCommand.args.function,
      {
        ref: evaluateCommand.args.ref,
        selector: evaluateCommand.args.selector,
      },
      registry,
      snapshotEngine
    )
  },
  scroll: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const scrollCommand = command as Extract<BrowserAutomationCommand, { command: "scroll" }>
    return executeScroll(
      automationId,
      threadId,
      scrollCommand.args.browserId,
      {
        ref: scrollCommand.args.ref,
        selector: scrollCommand.args.selector,
        point: scrollCommand.args.point,
      },
      scrollCommand.args.deltaX,
      scrollCommand.args.deltaY,
      registry,
      snapshotEngine
    )
  },
  resize: ({ automationId }) =>
    fail(automationId, "browser_unsupported", "browser_resize is handled by the app runtime."),
  close_tab: ({ automationId }) =>
    fail(automationId, "browser_unsupported", "browser_close_tab is handled by the app runtime."),
  mark_deliverable: ({ command, automationId, threadId, registry }) => {
    const c = command as Extract<BrowserAutomationCommand, { command: "mark_deliverable" }>
    return executeMarkDeliverable(automationId, threadId, c.args.browserId, registry)
  },
  mark_handoff: ({ command, automationId, threadId, registry }) => {
    const c = command as Extract<BrowserAutomationCommand, { command: "mark_handoff" }>
    return executeMarkHandoff(automationId, threadId, c.args.browserId, registry)
  },
  request_manual_handoff: ({ command, automationId, threadId, registry }) => {
    const c = command as Extract<BrowserAutomationCommand, { command: "request_manual_handoff" }>
    return executeRequestManualHandoff(
      automationId,
      threadId,
      c.args.browserId,
      c.args.reason,
      registry
    )
  },
  scan_qr: ({ command, automationId, threadId, registry, snapshotEngine }) => {
    const c = command as Extract<BrowserAutomationCommand, { command: "scan_qr" }>
    return executeScanQr(
      automationId,
      threadId,
      c.args.browserId,
      { ref: c.args.ref, selector: c.args.selector },
      registry,
      snapshotEngine
    )
  },
  extract_assets: ({ command, automationId, threadId, registry }) => {
    const c = command as Extract<BrowserAutomationCommand, { command: "extract_assets" }>
    return executeExtractAssets(automationId, threadId, c.args.browserId, c.args.kinds, registry)
  },
}

interface ResolvedTabTarget {
  browserId: string
  contents: TabContents
}

function executeListTabs(
  automationId: string,
  threadId: string | undefined,
  registry: BrowserRegistry
): AutomationCommandPayload {
  const browserIds = threadId
    ? registry.listRegisteredBrowserIdsForThread(threadId)
    : registry.listRegisteredBrowserIds()
  const activeBrowserId = threadId ? registry.getThreadActiveBrowserId(threadId) : null
  const tabs: Array<ReturnType<typeof tabInfoFromContents>> = []

  for (const browserId of browserIds) {
    const contents = registry.getTabContents(browserId)
    // Every tab belongs to a Thread; an unscoped registration is not listed.
    const tabThreadId = registry.getBrowserThreadId(browserId)
    if (contents && !contents.isDestroyed() && tabThreadId) {
      tabs.push(
        tabInfoFromContents(
          browserId,
          contents,
          activeBrowserId,
          tabThreadId,
          registry.getBrowserKind(browserId)
        )
      )
    }
  }

  return { automationId, ok: true, result: { command: "list_tabs", tabs } }
}

async function executeSnapshot(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({
    automationId,
    threadId,
    browserId,
    registry,
  })
  if ("ok" in target) {
    return target
  }

  return withDialogCapture(target.contents, async () => {
    const snapshot = await snapshotEngine.snapshot({
      browserId: target.browserId,
      page: target.contents,
    })

    return {
      automationId,
      ok: true,
      result: {
        command: "snapshot",
        browserId: target.browserId,
        url: target.contents.getURL(),
        title: target.contents.getTitle(),
        ...snapshot,
      },
    }
  })
}

async function executeClick(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string; point?: { x: number; y: number } },
  options: ClickInputOptions,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!target.contents.sendDebugCommand) {
      return fail(
        automationId,
        "browser_unsupported",
        "browser_click requires trusted browser input"
      )
    }
    const resolvedPoint = await resolveActionablePoint({
      automationId,
      browserId: target.browserId,
      contents: target.contents,
      snapshotEngine,
      target: targetInput,
    })
    if (!("ok" in resolvedPoint) || !resolvedPoint.ok) {
      return resolvedPoint
    }
    await dispatchTrustedClick(cdpSender(target.contents), resolvedPoint.point, options)
    return {
      automationId,
      ok: true,
      result: {
        command: "click",
        browserId: target.browserId,
        ...(targetInput.ref ? { ref: targetInput.ref } : {}),
        ...(targetInput.selector ? { selector: targetInput.selector } : {}),
        ...(targetInput.point ? { point: targetInput.point } : {}),
        x: resolvedPoint.point.x,
        y: resolvedPoint.point.y,
      },
    }
  })
}

async function executeFill(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string },
  value: string,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (targetInput.ref) {
      const result = await snapshotEngine.fill({
        browserId: target.browserId,
        page: target.contents,
        ref: targetInput.ref,
        value,
      })
      if (result.ok) {
        return {
          automationId,
          ok: true,
          result: {
            command: "fill",
            browserId: target.browserId,
            ref: targetInput.ref,
            ...(targetInput.selector ? { selector: targetInput.selector } : {}),
          },
        }
      }
      if (!targetInput.selector) {
        return staleRefFailure(automationId, targetInput.ref)
      }
    }

    if (targetInput.selector) {
      const expr = elementExpressionFromSelector(targetInput.selector)
      const filled = await executeFillElement(target.contents, expr, value)
      if (!filled) {
        return fail(
          automationId,
          "browser_target_not_found",
          `Element matching "${targetInput.selector}" was not found or could not be filled.`
        )
      }
      return {
        automationId,
        ok: true,
        result: {
          command: "fill",
          browserId: target.browserId,
          selector: targetInput.selector,
          ...(targetInput.ref ? { ref: targetInput.ref } : {}),
        },
      }
    }

    return fail(automationId, "browser_target_not_found", "Neither ref nor selector was provided.")
  })
}

async function executeSelect(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string },
  value: string,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (targetInput.ref) {
      const result = await snapshotEngine.select({
        browserId: target.browserId,
        page: target.contents,
        ref: targetInput.ref,
        value,
      })
      if (result.ok) {
        return {
          automationId,
          ok: true,
          result: {
            command: "select",
            browserId: target.browserId,
            ref: targetInput.ref,
            value,
            ...(targetInput.selector ? { selector: targetInput.selector } : {}),
          },
        }
      }
      if (!targetInput.selector) {
        return staleRefFailure(automationId, targetInput.ref)
      }
    }

    if (targetInput.selector) {
      const expr = elementExpressionFromSelector(targetInput.selector)
      const selected = await executeSelectElement(target.contents, expr, value)
      if (!selected) {
        return fail(
          automationId,
          "browser_target_not_found",
          `Element matching "${targetInput.selector}" was not found or could not be selected.`
        )
      }
      return {
        automationId,
        ok: true,
        result: {
          command: "select",
          browserId: target.browserId,
          selector: targetInput.selector,
          value,
          ...(targetInput.ref ? { ref: targetInput.ref } : {}),
        },
      }
    }

    return fail(automationId, "browser_target_not_found", "Neither ref nor selector was provided.")
  })
}

async function executeHover(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string; point?: { x: number; y: number } },
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!target.contents.sendDebugCommand) {
      return fail(
        automationId,
        "browser_unsupported",
        "browser_hover requires trusted browser input"
      )
    }
    const resolvedPoint = await resolveActionablePoint({
      automationId,
      browserId: target.browserId,
      contents: target.contents,
      snapshotEngine,
      target: targetInput,
    })
    if (!("ok" in resolvedPoint) || !resolvedPoint.ok) {
      return resolvedPoint
    }
    await dispatchTrustedHover(cdpSender(target.contents), resolvedPoint.point)
    return {
      automationId,
      ok: true,
      result: {
        command: "hover",
        browserId: target.browserId,
        ...(targetInput.ref ? { ref: targetInput.ref } : {}),
        ...(targetInput.selector ? { selector: targetInput.selector } : {}),
        ...(targetInput.point ? { point: targetInput.point } : {}),
        x: resolvedPoint.point.x,
        y: resolvedPoint.point.y,
      },
    }
  })
}

async function executeDrag(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  sourceInput: { ref?: string; selector?: string; point?: { x: number; y: number } },
  targetInput: { ref?: string; selector?: string; point?: { x: number; y: number } },
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!target.contents.sendDebugCommand) {
      return fail(
        automationId,
        "browser_unsupported",
        "browser_drag requires trusted browser input"
      )
    }
    const source = await resolveActionablePoint({
      automationId,
      browserId: target.browserId,
      contents: target.contents,
      snapshotEngine,
      target: sourceInput,
      targetName: "source",
    })
    if (!("ok" in source) || !source.ok) {
      return source
    }
    const dropTarget = await resolveActionablePoint({
      automationId,
      browserId: target.browserId,
      contents: target.contents,
      snapshotEngine,
      target: targetInput,
      targetName: "target",
    })
    if (!("ok" in dropTarget) || !dropTarget.ok) {
      return dropTarget
    }
    await dispatchTrustedDrag(cdpSender(target.contents), source.point, dropTarget.point)
    return {
      automationId,
      ok: true,
      result: {
        command: "drag",
        browserId: target.browserId,
        ...(sourceInput.ref ? { sourceRef: sourceInput.ref } : {}),
        ...(sourceInput.selector ? { sourceSelector: sourceInput.selector } : {}),
        ...(sourceInput.point ? { sourcePoint: sourceInput.point } : {}),
        ...(targetInput.ref ? { targetRef: targetInput.ref } : {}),
        ...(targetInput.selector ? { targetSelector: targetInput.selector } : {}),
        ...(targetInput.point ? { targetPoint: targetInput.point } : {}),
        sourceX: source.point.x,
        sourceY: source.point.y,
        targetX: dropTarget.point.x,
        targetY: dropTarget.point.y,
      },
    }
  })
}

async function executeLogs(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  maxEntries: number,
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    const consoleMessages = target.contents.getConsoleMessages?.() ?? []
    const networkEntries = parseNetworkEntries(
      await target.contents.executeJavaScript(NETWORK_PERFORMANCE_SCRIPT)
    )
    return {
      automationId,
      ok: true,
      result: {
        command: "logs",
        browserId: target.browserId,
        console: consoleMessages.slice(-maxEntries),
        network: networkEntries.slice(-maxEntries),
      },
    }
  })
}

async function executeEvaluate(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  functionSource: string,
  targetInput: { ref?: string; selector?: string },
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    let elementExpression: string | undefined
    if (targetInput.ref) {
      const expression = snapshotEngine.runtimeElementExpression({
        browserId: target.browserId,
        ref: targetInput.ref,
      })
      if (typeof expression !== "string") {
        if (!targetInput.selector) {
          return staleRefFailure(automationId, targetInput.ref)
        }
      } else {
        elementExpression = expression
      }
    }
    if (!elementExpression && targetInput.selector) {
      elementExpression = elementExpressionFromSelector(targetInput.selector)
    }

    let rawResult: unknown
    try {
      rawResult = await target.contents.executeJavaScript(
        buildEvaluateScript(functionSource, elementExpression)
      )
    } catch (error) {
      return fail(automationId, "browser_unknown_error", evaluateErrorMessage(error))
    }

    const result = readEvaluateScriptResult(rawResult)
    if (result.status === "stale_ref") {
      return staleRefFailure(automationId, targetInput.ref ?? targetInput.selector ?? "unknown")
    }
    if (result.status === "error") {
      return fail(automationId, "browser_unknown_error", capEvaluateErrorMessage(result.message))
    }

    const capped = capEvaluateResultJson(result.resultJson)
    return {
      automationId,
      ok: true,
      result: {
        command: "evaluate",
        browserId: target.browserId,
        resultJson: capped.resultJson,
        truncated: result.truncated || capped.truncated,
      },
    }
  })
}

async function executeScroll(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string; point?: { x: number; y: number } },
  deltaX: number,
  deltaY: number,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!target.contents.sendDebugCommand) {
      return fail(
        automationId,
        "browser_unsupported",
        "browser_scroll requires trusted browser input"
      )
    }

    let point: { x: number; y: number }
    if (targetInput.ref || targetInput.selector || targetInput.point) {
      const res = await resolveActionablePoint({
        automationId,
        browserId: target.browserId,
        contents: target.contents,
        snapshotEngine,
        target: targetInput,
      })
      if (!("ok" in res) || !res.ok) {
        return res
      }
      point = res.point
    } else {
      point = await readViewportCenter(target.contents)
    }

    await dispatchTrustedScroll(cdpSender(target.contents), point, deltaX, deltaY)
    return {
      automationId,
      ok: true,
      result: {
        command: "scroll",
        browserId: target.browserId,
        ...(targetInput.ref ? { ref: targetInput.ref } : {}),
        ...(targetInput.selector ? { selector: targetInput.selector } : {}),
        ...(targetInput.point ? { point: targetInput.point } : {}),
        deltaX,
        deltaY,
        x: point.x,
        y: point.y,
      },
    }
  })
}

async function readViewportCenter(contents: TabContents): Promise<{ x: number; y: number }> {
  const value = await contents.executeJavaScript(
    "({ x: Math.max(0, (window.innerWidth || 1) / 2), y: Math.max(0, (window.innerHeight || 1) / 2) })"
  )
  if (!value || typeof value !== "object") {
    return { x: 0, y: 0 }
  }
  const record = value as Record<string, unknown>
  return {
    x: readNumber(record.x) ?? 0,
    y: readNumber(record.y) ?? 0,
  }
}

function staleRefFailure(automationId: string, ref: string): FailurePayload {
  return fail(
    automationId,
    "browser_stale_ref",
    `Browser element reference ${ref} is stale. Take a new snapshot and try again.`
  )
}

function actionabilityFailure(
  automationId: string,
  ref: string,
  result: Exclude<ActionabilityResult, { ok: true }>
): FailurePayload {
  if (result.reason === "stale_ref") {
    return staleRefFailure(automationId, ref)
  }
  return fail(
    automationId,
    "browser_timeout",
    `Timed out waiting for browser element ${ref} to become actionable.`,
    true
  )
}

function cdpSender(contents: TabContents): NonNullable<TabContents["sendDebugCommand"]> {
  return contents.sendDebugCommand?.bind(contents) as NonNullable<TabContents["sendDebugCommand"]>
}

async function executeWait(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  condition: { text?: string; url?: string; timeoutMs?: number },
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!condition.text && !condition.url) {
      return fail(automationId, "browser_unsupported", "browser_wait requires text or url")
    }

    const timeoutMs = condition.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    do {
      if (condition.url && target.contents.getURL().includes(condition.url)) {
        return {
          automationId,
          ok: true,
          result: { command: "wait", browserId: target.browserId, matched: "url" },
        }
      }
      if (condition.text) {
        const pageText = await target.contents.executeJavaScript("document.body.innerText || ''")
        if (typeof pageText === "string" && pageText.includes(condition.text)) {
          return {
            automationId,
            ok: true,
            result: { command: "wait", browserId: target.browserId, matched: "text" },
          }
        }
      }
      await delay(WAIT_POLL_INTERVAL_MS)
    } while (Date.now() < deadline)

    if (condition.text) {
      return fail(
        automationId,
        "browser_timeout",
        `Timed out waiting for browser text: ${condition.text}`,
        true
      )
    }
    if (condition.url) {
      return fail(
        automationId,
        "browser_timeout",
        `Timed out waiting for browser URL: ${condition.url}`,
        true
      )
    }
    return fail(automationId, "browser_unsupported", "browser_wait requires text or url")
  })
}

async function executeType(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string; point?: { x: number; y: number } },
  text: string,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!target.contents.sendDebugCommand) {
      return fail(
        automationId,
        "browser_unsupported",
        "browser_type requires trusted browser input"
      )
    }
    let resolvedPoint: { x: number; y: number } | null = null
    if (targetInput.ref || targetInput.selector || targetInput.point) {
      const res = await resolveActionablePoint({
        automationId,
        browserId: target.browserId,
        contents: target.contents,
        snapshotEngine,
        target: targetInput,
        editable: true,
      })
      if (!("ok" in res) || !res.ok) {
        return res
      }
      resolvedPoint = res.point
      await dispatchTrustedClick(cdpSender(target.contents), resolvedPoint)
    }
    await dispatchTrustedText(cdpSender(target.contents), text)
    return {
      automationId,
      ok: true,
      result: {
        command: "type",
        browserId: target.browserId,
        ...(targetInput.ref ? { ref: targetInput.ref } : {}),
        ...(targetInput.selector ? { selector: targetInput.selector } : {}),
        ...(targetInput.point ? { point: targetInput.point } : {}),
        ...(resolvedPoint ? { x: resolvedPoint.x, y: resolvedPoint.y } : {}),
      },
    }
  })
}

async function executeKeypress(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string; point?: { x: number; y: number } },
  key: string,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    let resolvedPoint: { x: number; y: number } | null = null
    if (targetInput.ref || targetInput.selector || targetInput.point) {
      if (targetInput.point) {
        if (!target.contents.sendDebugCommand) {
          return fail(
            automationId,
            "browser_unsupported",
            "browser_keypress requires trusted browser input"
          )
        }
        resolvedPoint = targetInput.point
        await dispatchTrustedClick(cdpSender(target.contents), resolvedPoint)
      } else {
        let elementExpression: string | null = null
        if (targetInput.ref) {
          const expr = snapshotEngine.runtimeElementExpression({
            browserId: target.browserId,
            ref: targetInput.ref,
          })
          if (typeof expr === "string") {
            elementExpression = expr
          } else if (!targetInput.selector) {
            return staleRefFailure(automationId, targetInput.ref)
          }
        }
        if (!elementExpression && targetInput.selector) {
          elementExpression = elementExpressionFromSelector(targetInput.selector)
        }
        if (elementExpression) {
          const actionable = await waitForActionableTarget({
            page: target.contents,
            elementExpression,
          })
          if (!actionable.ok) {
            if (targetInput.ref) {
              return actionabilityFailure(automationId, targetInput.ref, actionable)
            }
            return fail(
              automationId,
              "browser_target_not_found",
              `Element matching "${targetInput.selector}" is ${actionable.reason === "timeout" ? (actionable.detail ?? "not actionable") : actionable.reason}.`
            )
          }
          resolvedPoint = actionable.target.point
          const focused = await focusKeypressTarget(target.contents, elementExpression)
          if (focused === "stale_ref") {
            return staleRefFailure(
              automationId,
              targetInput.ref ?? targetInput.selector ?? "target"
            )
          }
          if (focused === "editable") {
            if (!target.contents.sendDebugCommand) {
              return fail(
                automationId,
                "browser_unsupported",
                "browser_keypress requires trusted browser input"
              )
            }
            await dispatchTrustedClick(cdpSender(target.contents), actionable.target.point)
          }
        }
      }
    }
    dispatchTrustedKey((event) => target.contents.sendInputEvent(event), key)
    return {
      automationId,
      ok: true,
      result: {
        command: "keypress",
        browserId: target.browserId,
        key,
        ...(targetInput.ref ? { ref: targetInput.ref } : {}),
        ...(targetInput.selector ? { selector: targetInput.selector } : {}),
        ...(targetInput.point ? { point: targetInput.point } : {}),
        ...(resolvedPoint ? { x: resolvedPoint.x, y: resolvedPoint.y } : {}),
      },
    }
  })
}

async function executeNavigate(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  url: string,
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!isAllowedPageUrl(url)) {
      return fail(
        automationId,
        "browser_denied",
        "Browser navigation only supports http and https URLs."
      )
    }
    snapshotEngine.clearBrowser(browserId)
    await target.contents.loadURL(url)
    return {
      automationId,
      ok: true,
      result: { command: "navigate", browserId: target.browserId, url },
    }
  })
}

async function executeNavigationAction(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  action: "back" | "forward" | "reload",
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (action === "back") {
      if (!target.contents.canGoBack()) {
        return fail(automationId, "browser_denied", "There is nothing to go back to.")
      }
      snapshotEngine.clearBrowser(browserId)
      target.contents.goBack()
      return { automationId, ok: true, result: { command: "back", browserId: target.browserId } }
    }
    if (action === "forward") {
      if (!target.contents.canGoForward()) {
        return fail(automationId, "browser_denied", "There is nothing to go forward to.")
      }
      snapshotEngine.clearBrowser(browserId)
      target.contents.goForward()
      return { automationId, ok: true, result: { command: "forward", browserId: target.browserId } }
    }
    snapshotEngine.clearBrowser(browserId)
    target.contents.reload()
    return { automationId, ok: true, result: { command: "reload", browserId: target.browserId } }
  })
}

async function executeScreenshot(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  fullPage: boolean,
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  if (fullPage) {
    return executeFullPageScreenshot(automationId, threadId, browserId, registry)
  }

  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    let image: TabImage
    try {
      image = await capturePaintedViewport(target.contents)
    } catch (error) {
      if (error instanceof BrowserTabClosedError) {
        return fail(automationId, "browser_tab_closed", `Browser tab ${browserId} has been closed`)
      }
      if (isScreenshotNoFrameError(error)) {
        return screenshotNoFrameFailure(automationId, error)
      }
      throw error
    }
    const size = image.getSize()
    return {
      automationId,
      ok: true,
      result: {
        command: "screenshot",
        browserId: target.browserId,
        mimeType: "image/png",
        dataBase64: Buffer.from(image.toPNG()).toString("base64"),
        width: size.width,
        height: size.height,
      },
    }
  })
}

interface CdpLayoutMetrics {
  cssLayoutViewport?: {
    clientWidth?: number
    clientHeight?: number
  }
  layoutViewport?: {
    clientWidth?: number
    clientHeight?: number
  }
  cssContentSize?: {
    width?: number
    height?: number
  }
  contentSize?: {
    width?: number
    height?: number
  }
}

interface CdpCaptureScreenshotResult {
  data?: string
}

interface CdpRuntimeEvaluateResult {
  result?: {
    objectId?: string
    subtype?: string
  }
}

interface CdpDescribeNodeResult {
  node?: {
    backendNodeId?: number
    nodeId?: number
    nodeName?: string
  }
}

async function getCdpLayoutMetrics(contents: TabContents): Promise<{
  viewportWidth: number
  viewportHeight: number
  contentWidth: number
  contentHeight: number
}> {
  if (!contents.sendDebugCommand) {
    return { viewportWidth: 0, viewportHeight: 0, contentWidth: 0, contentHeight: 0 }
  }
  const metrics = (await contents.sendDebugCommand("Page.getLayoutMetrics")) as CdpLayoutMetrics
  const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport
  const contentSize = metrics.cssContentSize ?? metrics.contentSize
  return {
    viewportWidth: Math.ceil(viewport?.clientWidth ?? 0),
    viewportHeight: Math.ceil(viewport?.clientHeight ?? 0),
    contentWidth: Math.ceil(contentSize?.width ?? 0),
    contentHeight: Math.ceil(contentSize?.height ?? 0),
  }
}

async function executeFullPageScreenshot(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!target.contents.sendDebugCommand) {
      return fail(automationId, "browser_unsupported", "browser_screenshot fullPage requires CDP")
    }
    const sendDebugCommand = target.contents.sendDebugCommand.bind(target.contents)
    let screenshot: CdpCaptureScreenshotResult
    let width = 0
    let height = 0
    try {
      screenshot = await runPaintedPixelCapture(target.contents, async () => {
        const metrics = await getCdpLayoutMetrics(target.contents)
        width = metrics.contentWidth
        height = metrics.contentHeight
        return (await sendDebugCommand("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        })) as CdpCaptureScreenshotResult
      })
    } catch (error) {
      if (isScreenshotNoFrameError(error)) {
        return screenshotNoFrameFailure(automationId, error)
      }
      throw error
    }
    if (!screenshot.data) {
      return fail(
        automationId,
        "browser_unsupported",
        "browser_screenshot fullPage returned no data"
      )
    }
    return {
      automationId,
      ok: true,
      result: {
        command: "screenshot",
        browserId: target.browserId,
        mimeType: "image/png",
        dataBase64: screenshot.data,
        width,
        height,
      },
    }
  })
}

function isAllowedPageUrl(value: string): boolean {
  try {
    return ALLOWED_PAGE_URL_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

async function executeUpload(
  automationId: string,
  cwd: string | undefined,
  threadId: string | undefined,
  browserId: string,
  input: { ref?: string; selector?: string; filePaths: string[] },
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    if (!target.contents.sendDebugCommand) {
      return fail(automationId, "browser_unsupported", "browser_upload requires CDP")
    }
    let expression: string | null = null
    if (input.ref) {
      const expr = snapshotEngine.runtimeElementExpression({
        browserId: target.browserId,
        ref: input.ref,
      })
      if (typeof expr === "string") {
        expression = expr
      } else if (!input.selector) {
        return staleRefFailure(automationId, input.ref)
      }
    }
    if (!expression && input.selector) {
      expression = elementExpressionFromSelector(input.selector)
    }
    if (!expression) {
      return fail(
        automationId,
        "browser_target_not_found",
        "Neither ref nor selector was provided for upload."
      )
    }

    const evaluated = (await target.contents.sendDebugCommand("Runtime.evaluate", {
      expression,
      objectGroup: "cypheria-browser-automation",
      returnByValue: false,
    })) as CdpRuntimeEvaluateResult
    const objectId = evaluated.result?.objectId
    if (!objectId || evaluated.result?.subtype === "null") {
      if (input.ref) return staleRefFailure(automationId, input.ref)
      return fail(
        automationId,
        "browser_target_not_found",
        `Element with selector "${input.selector}" was not found.`
      )
    }
    const described = (await target.contents.sendDebugCommand("DOM.describeNode", {
      objectId,
    })) as CdpDescribeNodeResult
    const backendNodeId = described.node?.backendNodeId
    if (typeof backendNodeId !== "number" || backendNodeId <= 0) {
      if (input.ref) return staleRefFailure(automationId, input.ref)
      return fail(
        automationId,
        "browser_target_not_found",
        `Element with selector "${input.selector}" is not a valid DOM node.`
      )
    }
    const workspaceRoot = resolveUploadWorkspaceRoot(cwd)
    if (!workspaceRoot) {
      return fail(automationId, "browser_unsupported", "browser_upload requires request cwd")
    }
    const filePaths = resolveWorkspaceFilePaths(input.filePaths, workspaceRoot)
    if (!filePaths) {
      return fail(
        automationId,
        "browser_unsupported",
        "browser_upload only accepts files inside the thread working directory."
      )
    }

    await target.contents.sendDebugCommand("DOM.setFileInputFiles", {
      backendNodeId,
      files: filePaths,
    })
    return {
      automationId,
      ok: true,
      result: {
        command: "upload",
        browserId: target.browserId,
        filePaths,
        ...(input.ref ? { ref: input.ref } : {}),
        ...(input.selector ? { selector: input.selector } : {}),
      },
    }
  })
}

async function executeMarkDeliverable(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return {
    automationId,
    ok: true,
    result: {
      command: "mark_deliverable",
      browserId: target.browserId,
    },
  }
}

async function executeMarkHandoff(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return {
    automationId,
    ok: true,
    result: {
      command: "mark_handoff",
      browserId: target.browserId,
    },
  }
}

async function executeRequestManualHandoff(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  _reason: string | undefined,
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  if (registry.activateTab) {
    registry.activateTab(target.browserId)
  }
  return {
    automationId,
    ok: true,
    result: {
      command: "request_manual_handoff",
      browserId: target.browserId,
      status: "completed",
    },
  }
}

async function executeScanQr(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  targetInput: { ref?: string; selector?: string },
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    let cropRect: { x: number; y: number; width: number; height: number } | null = null
    if (targetInput.ref || targetInput.selector) {
      let elementExpression: string | null = null
      if (targetInput.ref) {
        const expr = snapshotEngine.runtimeElementExpression({
          browserId: target.browserId,
          ref: targetInput.ref,
        })
        if (typeof expr === "string") {
          elementExpression = expr
        } else if (!targetInput.selector) {
          return staleRefFailure(automationId, targetInput.ref)
        }
      }
      if (!elementExpression && targetInput.selector) {
        elementExpression = elementExpressionFromSelector(targetInput.selector)
      }
      if (elementExpression) {
        const rectResult = (await target.contents.executeJavaScript(`(() => {
          const el = ${elementExpression};
          if (!el || !el.isConnected) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()`)) as { x: number; y: number; width: number; height: number } | null
        if (rectResult && rectResult.width > 0 && rectResult.height > 0) {
          cropRect = rectResult
        } else if (targetInput.ref) {
          return staleRefFailure(automationId, targetInput.ref)
        } else if (targetInput.selector) {
          return fail(
            automationId,
            "browser_target_not_found",
            `Element with selector "${targetInput.selector}" not found or has 0 size.`
          )
        }
      }
    }

    let image: TabImage
    try {
      image = await capturePaintedViewport(target.contents)
    } catch (error) {
      if (error instanceof BrowserTabClosedError) {
        return fail(automationId, "browser_tab_closed", `Browser tab ${browserId} has been closed`)
      }
      if (isScreenshotNoFrameError(error)) {
        return screenshotNoFrameFailure(automationId, error)
      }
      throw error
    }

    let targetImage = image
    let offsetX = 0
    let offsetY = 0
    if (cropRect && targetImage.crop) {
      offsetX = Math.max(0, Math.floor(cropRect.x))
      offsetY = Math.max(0, Math.floor(cropRect.y))
      const cropW = Math.max(1, Math.floor(cropRect.width))
      const cropH = Math.max(1, Math.floor(cropRect.height))
      targetImage = targetImage.crop({ x: offsetX, y: offsetY, width: cropW, height: cropH })
    }

    let bitmap: Uint8Array | null = null
    let width = targetImage.getSize().width
    let height = targetImage.getSize().height

    if (targetImage.toBitmap) {
      const raw = targetImage.toBitmap()
      bitmap = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    }

    if (!bitmap) {
      try {
        const electron = await import("electron")
        let nImg = electron.nativeImage.createFromBuffer(Buffer.from(targetImage.toPNG()))
        if (cropRect && !targetImage.crop) {
          offsetX = Math.max(0, Math.floor(cropRect.x))
          offsetY = Math.max(0, Math.floor(cropRect.y))
          const cropW = Math.max(1, Math.floor(cropRect.width))
          const cropH = Math.max(1, Math.floor(cropRect.height))
          nImg = nImg.crop({ x: offsetX, y: offsetY, width: cropW, height: cropH })
        }
        const s = nImg.getSize()
        width = s.width
        height = s.height
        bitmap = new Uint8Array(nImg.toBitmap())
      } catch {
        return {
          automationId,
          ok: true,
          result: { command: "scan_qr", browserId: target.browserId, found: false },
        }
      }
    }

    if (bitmap.length < width * height * 4) {
      return {
        automationId,
        ok: true,
        result: { command: "scan_qr", browserId: target.browserId, found: false },
      }
    }

    const rgba = new Uint8ClampedArray(bitmap.length)
    for (let i = 0; i < bitmap.length; i += 4) {
      rgba[i] = bitmap[i + 2] ?? 0
      rgba[i + 1] = bitmap[i + 1] ?? 0
      rgba[i + 2] = bitmap[i] ?? 0
      rgba[i + 3] = bitmap[i + 3] ?? 0
    }

    const code = jsQR(rgba, width, height)
    if (code?.data) {
      const minX = Math.min(
        code.location.topLeftCorner.x,
        code.location.bottomLeftCorner.x,
        code.location.topRightCorner.x,
        code.location.bottomRightCorner.x
      )
      const maxX = Math.max(
        code.location.topLeftCorner.x,
        code.location.bottomLeftCorner.x,
        code.location.topRightCorner.x,
        code.location.bottomRightCorner.x
      )
      const minY = Math.min(
        code.location.topLeftCorner.y,
        code.location.bottomLeftCorner.y,
        code.location.topRightCorner.y,
        code.location.bottomRightCorner.y
      )
      const maxY = Math.max(
        code.location.topLeftCorner.y,
        code.location.bottomLeftCorner.y,
        code.location.topRightCorner.y,
        code.location.bottomRightCorner.y
      )
      return {
        automationId,
        ok: true,
        result: {
          command: "scan_qr",
          browserId: target.browserId,
          found: true,
          text: code.data,
          bounds: {
            x: Math.round(minX + offsetX),
            y: Math.round(minY + offsetY),
            width: Math.round(maxX - minX),
            height: Math.round(maxY - minY),
          },
        },
      }
    }

    return {
      automationId,
      ok: true,
      result: {
        command: "scan_qr",
        browserId: target.browserId,
        found: false,
      },
    }
  })
}

async function executeExtractAssets(
  automationId: string,
  threadId: string | undefined,
  browserId: string,
  kinds: Array<"image" | "svg" | "font" | "stylesheet"> | undefined,
  registry: BrowserRegistry
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ automationId, threadId, browserId, registry })
  if ("ok" in target) {
    return target
  }
  return withDialogCapture(target.contents, async () => {
    const script = `(() => {
      const allowedKinds = ${JSON.stringify(kinds ?? ["image", "svg", "font", "stylesheet"])};
      const results = [];
      const seen = new Set();
      const add = (kind, url, name) => {
        if (!url || typeof url !== 'string') return;
        try {
          const absolute = new URL(url, document.baseURI).href;
          const key = kind + ':' + absolute;
          if (!seen.has(key)) {
            seen.add(key);
            const item = { kind, url: absolute };
            if (name) item.name = name;
            results.push(item);
          }
        } catch {}
      };

      if (allowedKinds.includes("image")) {
        document.querySelectorAll('img[src], picture source[srcset]').forEach(el => {
          if (el.src) add('image', el.src, el.alt || undefined);
          if (el.currentSrc) add('image', el.currentSrc, el.alt || undefined);
          if (el.srcset) {
            el.srcset.split(',').forEach(part => {
              const u = part.trim().split(/\\s+/)[0];
              if (u) add('image', u);
            });
          }
        });
        document.querySelectorAll('link[rel*="icon"]').forEach(el => add('image', el.href));
      }

      if (allowedKinds.includes("svg")) {
        document.querySelectorAll('image[*|href], image[href]').forEach(el => {
          const href = el.getAttribute('xlink:href') || el.getAttribute('href');
          if (href) add('svg', href);
        });
        document.querySelectorAll('img[src*=".svg"]').forEach(el => {
          if (el.src) add('svg', el.src, el.alt || undefined);
        });
      }

      if (allowedKinds.includes("stylesheet")) {
        document.querySelectorAll('link[rel="stylesheet"][href]').forEach(el => add('stylesheet', el.href));
      }

      if (allowedKinds.includes("font")) {
        document.querySelectorAll('link[rel*="font"][href], link[rel="preload"][as="font"][href]').forEach(el => add('font', el.href));
        try {
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules || []) {
                if (rule.type === CSSRule.FONT_FACE_RULE && rule.cssText) {
                  const matches = rule.cssText.matchAll(/url\\(["']?([^"')]+)["']?\\)/g);
                  for (const m of matches) {
                    if (m[1]) add('font', m[1]);
                  }
                }
              }
            } catch {}
          }
        } catch {}
      }

      return results;
    })()`

    let rawAssets: unknown
    try {
      rawAssets = await target.contents.executeJavaScript(script)
    } catch (error) {
      return fail(automationId, "browser_unknown_error", evaluateErrorMessage(error))
    }

    const assets: Array<{
      kind: "image" | "svg" | "font" | "stylesheet"
      url: string
      name?: string
    }> = []
    if (Array.isArray(rawAssets)) {
      for (const item of rawAssets) {
        if (
          item &&
          typeof item === "object" &&
          typeof item.url === "string" &&
          typeof item.kind === "string"
        ) {
          assets.push({
            kind: item.kind as "image" | "svg" | "font" | "stylesheet",
            url: item.url,
            ...(typeof item.name === "string" && item.name.length > 0 ? { name: item.name } : {}),
          })
        }
      }
    }

    return {
      automationId,
      ok: true,
      result: {
        command: "extract_assets",
        browserId: target.browserId,
        assets,
        totalCount: assets.length,
      },
    }
  })
}

function resolveUploadWorkspaceRoot(cwd: string | undefined): string | null {
  return cwd ? resolvePath(cwd) : null
}

// Symlinks are resolved so a link inside the working directory cannot upload a file outside it.
function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function resolveWorkspaceFilePaths(filePaths: string[], workspaceRoot: string): string[] | null {
  const root = realPath(workspaceRoot)
  const resolvedPaths = filePaths.map((filePath) =>
    isAbsolute(filePath) ? resolvePath(filePath) : resolvePath(workspaceRoot, filePath)
  )
  if (
    resolvedPaths.some(
      (filePath) =>
        !isPathInsideDirectory(filePath, workspaceRoot) ||
        !isPathInsideDirectory(realPath(filePath), root)
    )
  ) {
    return null
  }
  return resolvedPaths
}

function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const relativePath = relative(directory, filePath)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseNetworkEntries(value: unknown): BrowserAutomationNetworkLogEntry[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed.flatMap((entry): BrowserAutomationNetworkLogEntry[] => {
    if (!entry || typeof entry !== "object") {
      return []
    }
    const record = entry as Record<string, unknown>
    const url = readString(record.url)
    const startTime = readNumber(record.startTime)
    const duration = readNumber(record.duration)
    if (!url || startTime === null || duration === null) {
      return []
    }
    return [
      {
        url,
        ...(readString(record.method) ? { method: readString(record.method) ?? undefined } : {}),
        ...(readNumber(record.status) !== null
          ? { status: readNumber(record.status) ?? undefined }
          : {}),
        ...(readString(record.type) ? { type: readString(record.type) ?? undefined } : {}),
        startTime,
        duration,
        ...(readNumber(record.transferSize) !== null
          ? { transferSize: readNumber(record.transferSize) ?? undefined }
          : {}),
      },
    ]
  })
}

type EvaluateScriptResult =
  | { status: "ok"; resultJson: string; truncated: boolean }
  | { status: "stale_ref" }
  | { status: "error"; message: string }

function readEvaluateScriptResult(value: unknown): EvaluateScriptResult {
  if (!value || typeof value !== "object") {
    return { status: "error", message: "Browser evaluate returned an invalid result." }
  }
  const record = value as Record<string, unknown>
  if (record.ok === true && typeof record.resultJson === "string") {
    return { status: "ok", resultJson: record.resultJson, truncated: record.truncated === true }
  }
  if (record.staleRef === true) {
    return { status: "stale_ref" }
  }
  if (typeof record.error === "string") {
    return { status: "error", message: record.error }
  }
  return { status: "error", message: "Browser evaluate returned an invalid result." }
}

function capEvaluateResultJson(resultJson: string): { resultJson: string; truncated: boolean } {
  if (resultJson.length <= MAX_EVALUATE_RESULT_JSON_LENGTH) {
    return { resultJson, truncated: false }
  }
  return {
    resultJson: JSON.stringify(resultJson.slice(0, MAX_EVALUATE_RESULT_PREVIEW_LENGTH)),
    truncated: true,
  }
}

function evaluateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return capEvaluateErrorMessage(message)
}

function capEvaluateErrorMessage(message: string): string {
  return message.length <= MAX_EVALUATE_ERROR_MESSAGE_LENGTH
    ? message
    : message.slice(0, MAX_EVALUATE_ERROR_MESSAGE_LENGTH)
}

function buildEvaluateScript(
  functionSource: string,
  elementExpression: string | undefined
): string {
  return `(async () => {
    const __CYPHERIA_BROWSER_EVALUATE__ = true;
    try {
      const userFunction = (0, eval)(${JSON.stringify(`(${functionSource})`)});
      if (typeof userFunction !== 'function') {
        throw new Error('browser_evaluate input must evaluate to a function.');
      }
      const args = [];
      ${
        elementExpression
          ? `const element = ${elementExpression};
      if (!element) return { staleRef: true };
      args.push(element);`
          : ""
      }
	      const value = await userFunction(...args);
	      const resultJson = JSON.stringify(value) ?? 'null';
	      if (resultJson.length <= ${MAX_EVALUATE_RESULT_JSON_LENGTH}) {
	        return { ok: true, resultJson, truncated: false };
	      }
	      return {
	        ok: true,
	        resultJson: JSON.stringify(resultJson.slice(0, ${MAX_EVALUATE_RESULT_PREVIEW_LENGTH})),
	        truncated: true
	      };
	    } catch (error) {
	      return { error: error instanceof Error ? error.message : String(error) };
	    }
	  })()`
}

async function focusKeypressTarget(
  contents: TabContents,
  elementExpression: string
): Promise<"editable" | "focused" | "stale_ref"> {
  const result = await contents.executeJavaScript(`(() => {
    const element = ${elementExpression};
    if (!element) return { staleRef: true };
    const tagName = element.tagName ? element.tagName.toLowerCase() : '';
    const inputType = tagName === 'input' ? String(element.getAttribute('type') || 'text').toLowerCase() : '';
    const editableInput = tagName === 'textarea' ||
      (tagName === 'input' && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(inputType));
    const editable = editableInput || element.isContentEditable === true;
    if (!editable && typeof element.focus === 'function') {
      element.focus({ preventScroll: true });
    }
    return { editable };
  })()`)
  if (!result || typeof result !== "object") {
    return "stale_ref"
  }
  const record = result as Record<string, unknown>
  if (record.staleRef === true) {
    return "stale_ref"
  }
  return record.editable === true ? "editable" : "focused"
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const NETWORK_PERFORMANCE_SCRIPT = `(() => {
  const entries = performance.getEntriesByType('resource')
    .concat(performance.getEntriesByType('navigation'))
    .slice(-200)
    .map((entry) => ({
      url: entry.name,
      method: entry.initiatorType === 'navigation' ? 'GET' : undefined,
      type: entry.initiatorType,
      startTime: entry.startTime,
      duration: entry.duration,
      transferSize: typeof entry.transferSize === 'number' ? entry.transferSize : undefined,
    }));
  return JSON.stringify(entries);
})()`

function resolveTabTarget(input: {
  automationId: string
  threadId: string | undefined
  browserId: string
  registry: BrowserRegistry
}): ResolvedTabTarget | FailurePayload {
  const { automationId, threadId, browserId, registry } = input
  if (threadId && registry.getBrowserThreadId(browserId) !== threadId) {
    return fail(automationId, "browser_tab_not_found", `No browser tab found for ID: ${browserId}`)
  }

  const contents = registry.getTabContents(browserId)
  if (!contents) {
    return fail(automationId, "browser_tab_not_found", `No browser tab found for ID: ${browserId}`)
  }

  if (contents.isDestroyed()) {
    return fail(automationId, "browser_tab_closed", `Browser tab ${browserId} has been closed`)
  }

  return { browserId, contents }
}
