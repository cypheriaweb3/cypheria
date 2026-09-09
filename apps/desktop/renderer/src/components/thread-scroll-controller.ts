import type { ConversationProps } from "@cypheria/ui/ai-elements/conversation"
import type { VirtualItem } from "@tanstack/react-virtual"
import {
  type MutableRefObject,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

export const THREAD_SCROLL_BOTTOM_THRESHOLD_PX = 24
const THREAD_SCROLL_NEAR_BOTTOM_THRESHOLD_PX = 160
const MAX_RETAINED_THREAD_SCROLL_STATES = 20

export type ThreadScrollAnchor = {
  key: string
  offsetFromViewportTopPx: number
}

export type ThreadScrollRestoreState = {
  anchor: ThreadScrollAnchor | null
  distanceFromBottomPx: number
  measurements: VirtualItem[]
  scrollOffsetPx: number
  viewportHeightPx: number
  wasAtBottom: boolean
}

export class ThreadScrollStateCache {
  readonly #entries = new Map<string, ThreadScrollRestoreState>()

  constructor(readonly maxEntries = MAX_RETAINED_THREAD_SCROLL_STATES) {}

  delete(key: string) {
    this.#entries.delete(key)
  }

  get(key: string): ThreadScrollRestoreState | null {
    const state = this.#entries.get(key)
    if (!state) return null
    this.#entries.delete(key)
    this.#entries.set(key, state)
    return state
  }

  set(key: string, state: ThreadScrollRestoreState) {
    this.#entries.delete(key)
    this.#entries.set(key, state)
    while (this.#entries.size > this.maxEntries) {
      const oldestKey = this.#entries.keys().next().value
      if (typeof oldestKey !== "string") break
      this.#entries.delete(oldestKey)
    }
  }

  get size() {
    return this.#entries.size
  }
}

type ConversationInstance = NonNullable<ConversationProps["instance"]>

export type ThreadVirtualizerHandle = {
  getVirtualItems: () => VirtualItem[]
  takeSnapshot: () => VirtualItem[]
}

export type ThreadScrollController = {
  adoptStateKey: (nextKey: string) => void
  completeInitialRestore: () => void
  conversationInstance: ConversationInstance
  initialRestoreState: ThreadScrollRestoreState | null
  registerVirtualizer: (virtualizer: ThreadVirtualizerHandle | null) => void
  saveState: () => void
  scrollRef: MutableRefObject<HTMLElement | null> & RefCallback<HTMLElement>
}

const threadScrollStateCache = new ThreadScrollStateCache()

const createMutableCallbackRef = <T>() => {
  const ref = ((node: T | null) => {
    ref.current = node
  }) as MutableRefObject<T | null> & RefCallback<T>
  ref.current = null
  return ref
}

export const getDistanceFromBottomPx = (element: HTMLElement) =>
  Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop)

export const getBottomDistanceRestoreOffset = ({
  clientHeight,
  distanceFromBottomPx,
  scrollHeight,
}: {
  clientHeight: number
  distanceFromBottomPx: number
  scrollHeight: number
}) => Math.max(0, scrollHeight - clientHeight - distanceFromBottomPx)

const findViewportAnchor = (element: HTMLElement): ThreadScrollAnchor | null => {
  const viewport = element.getBoundingClientRect()
  const rows = element.querySelectorAll<HTMLElement>("[data-thread-message-key]")
  for (const row of rows) {
    const bounds = row.getBoundingClientRect()
    if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
    const key = row.dataset.threadMessageKey
    if (!key) continue
    return {
      key,
      offsetFromViewportTopPx: bounds.top - viewport.top,
    }
  }
  return null
}

export function useThreadScrollController(stateKey: string): ThreadScrollController {
  const stateKeyRef = useRef(stateKey)
  const initialRestoreStateRef = useRef<ThreadScrollRestoreState | null>(null)
  const didReadInitialStateRef = useRef(false)
  if (!didReadInitialStateRef.current) {
    didReadInitialStateRef.current = true
    initialRestoreStateRef.current = threadScrollStateCache.get(stateKey)
  }

  const scrollRef = useMemo(() => createMutableCallbackRef<HTMLElement>(), [])
  const contentRef = useMemo(() => createMutableCallbackRef<HTMLElement>(), [])
  const virtualizerRef = useRef<ThreadVirtualizerHandle | null>(null)
  const restorePendingRef = useRef(true)
  const initialState = initialRestoreStateRef.current
  const followsBottomRef = useRef(initialState?.wasAtBottom ?? true)
  const captureFrameRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(initialState?.wasAtBottom ?? true)
  const [isNearBottom, setIsNearBottom] = useState(
    (initialState?.distanceFromBottomPx ?? 0) <= THREAD_SCROLL_NEAR_BOTTOM_THRESHOLD_PX
  )

  const persistState = useCallback(
    (includeMeasurements: boolean, targetKey = stateKeyRef.current) => {
      const element = scrollRef.current
      if (!element) return
      const previous = threadScrollStateCache.get(targetKey)
      const distanceFromBottomPx = getDistanceFromBottomPx(element)
      const virtualizer = virtualizerRef.current
      threadScrollStateCache.set(targetKey, {
        anchor: findViewportAnchor(element),
        distanceFromBottomPx,
        measurements:
          includeMeasurements && virtualizer
            ? virtualizer.takeSnapshot()
            : (previous?.measurements ?? initialRestoreStateRef.current?.measurements ?? []),
        scrollOffsetPx: element.scrollTop,
        viewportHeightPx: element.clientHeight,
        wasAtBottom: distanceFromBottomPx <= THREAD_SCROLL_BOTTOM_THRESHOLD_PX,
      })
    },
    [scrollRef]
  )

  const updatePositionState = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const distance = getDistanceFromBottomPx(element)
    const nextAtBottom = distance <= THREAD_SCROLL_BOTTOM_THRESHOLD_PX
    const nextNearBottom = distance <= THREAD_SCROLL_NEAR_BOTTOM_THRESHOLD_PX
    if (!restorePendingRef.current) followsBottomRef.current = nextAtBottom
    setIsAtBottom((current) => (current === nextAtBottom ? current : nextAtBottom))
    setIsNearBottom((current) => (current === nextNearBottom ? current : nextNearBottom))
    if (restorePendingRef.current || captureFrameRef.current != null) return
    captureFrameRef.current = window.requestAnimationFrame(() => {
      captureFrameRef.current = null
      persistState(false)
    })
  }, [persistState, scrollRef])

  useLayoutEffect(() => {
    const content = contentRef.current
    const element = scrollRef.current
    if (!content || !element) return

    const observer = new ResizeObserver(() => {
      if (followsBottomRef.current) {
        // The virtualizer compensates measured rows, while this catches layout
        // outside its measurement root (content padding, images, and fixed UI).
        // Use an immediate DOM write so CSS smooth scrolling cannot compete.
        element.scrollTop = element.scrollHeight
      }
      if (resizeFrameRef.current != null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        updatePositionState()
      })
    })
    observer.observe(content)

    return () => {
      observer.disconnect()
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
  }, [contentRef, scrollRef, updatePositionState])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    element.addEventListener("scroll", updatePositionState, { passive: true })
    return () => {
      element.removeEventListener("scroll", updatePositionState)
      if (captureFrameRef.current != null) {
        window.cancelAnimationFrame(captureFrameRef.current)
        captureFrameRef.current = null
      }
      persistState(true)
    }
  }, [persistState, scrollRef, updatePositionState])

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return false
    followsBottomRef.current = true
    element.scrollTo({ behavior: "auto", top: element.scrollHeight })
    updatePositionState()
    return true
  }, [scrollRef, updatePositionState])

  const stopScroll = useCallback(() => {}, [])

  const conversationInstance = useMemo<ConversationInstance>(
    () => ({
      contentRef,
      escapedFromLock: !isAtBottom,
      isAtBottom,
      isNearBottom,
      scrollRef,
      scrollToBottom,
      state: {
        accumulated: 0,
        calculatedTargetScrollTop: scrollRef.current?.scrollTop ?? 0,
        escapedFromLock: !isAtBottom,
        isAtBottom,
        isNearBottom,
        resizeDifference: 0,
        scrollDifference: scrollRef.current ? getDistanceFromBottomPx(scrollRef.current) : 0,
        scrollTop: scrollRef.current?.scrollTop ?? 0,
        targetScrollTop: scrollRef.current?.scrollTop ?? 0,
        velocity: 0,
      },
      stopScroll,
    }),
    [contentRef, isAtBottom, isNearBottom, scrollRef, scrollToBottom, stopScroll]
  )

  const completeInitialRestore = useCallback(() => {
    restorePendingRef.current = false
    const element = scrollRef.current
    if (element) {
      followsBottomRef.current =
        getDistanceFromBottomPx(element) <= THREAD_SCROLL_BOTTOM_THRESHOLD_PX
    }
    updatePositionState()
    persistState(true)
  }, [persistState, scrollRef, updatePositionState])

  const registerVirtualizer = useCallback((virtualizer: ThreadVirtualizerHandle | null) => {
    virtualizerRef.current = virtualizer
  }, [])

  const saveState = useCallback(() => persistState(true), [persistState])

  const adoptStateKey = useCallback(
    (nextKey: string) => {
      const previousKey = stateKeyRef.current
      if (previousKey === nextKey) return
      persistState(true, nextKey)
      threadScrollStateCache.delete(previousKey)
      stateKeyRef.current = nextKey
    },
    [persistState]
  )

  return {
    adoptStateKey,
    completeInitialRestore,
    conversationInstance,
    initialRestoreState: initialRestoreStateRef.current,
    registerVirtualizer,
    saveState,
    scrollRef,
  }
}
