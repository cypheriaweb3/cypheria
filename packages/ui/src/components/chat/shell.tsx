import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"

import { ResizablePanel, type ResizablePanelHandle } from "#components/resizable"
import { cn } from "#lib/utils"

import { ChatPanelLayout, ChatPanelResizeHandle } from "./panel.js"
import type { ChatPanelVisibility } from "./types.js"

const panelSize = (value: number | string) => (typeof value === "number" ? `${value}px` : value)

type ChatWorkspaceShellProps = HTMLAttributes<HTMLDivElement> & {
  header?: ReactNode
  fixedHeaderActions?: ReactNode
  rightPanel?: ReactNode
  bottomPanel?: ReactNode
  rightPanelVisibility?: ChatPanelVisibility
  bottomPanelVisibility?: ChatPanelVisibility
  rightPanelSize?: number | string
  bottomPanelSize?: number | string
  mainPanelMinSize?: number | string
  workspaceMinSize?: number | string
  rightPanelMinSize?: number | string
  rightPanelMaxSize?: number | string
  bottomPanelMinSize?: number | string
  bottomPanelMaxSize?: number | string
  allowRightPanelFullscreen?: boolean
  rightPanelFullscreen?: boolean
  rightPanelResizeLabel?: string
  bottomPanelResizeLabel?: string
  onRightPanelResize?: (size: number) => void
  onBottomPanelResize?: (size: number) => void
  onBottomPanelVisibilityChange?: (visibility: ChatPanelVisibility) => void
  onRightPanelFullscreenChange?: (fullscreen: boolean) => void
}

const retainedPanelProps = (visibility: ChatPanelVisibility) => ({
  "aria-hidden": visibility === "visible" ? undefined : true,
  hidden: visibility !== "visible",
  inert: visibility === "visible" ? undefined : true,
})

export function ChatWorkspaceShell({
  className,
  children,
  header,
  fixedHeaderActions,
  rightPanel,
  bottomPanel,
  rightPanelVisibility = rightPanel ? "visible" : "closed",
  bottomPanelVisibility = bottomPanel ? "visible" : "closed",
  rightPanelSize = 420,
  bottomPanelSize = 280,
  mainPanelMinSize = 480,
  workspaceMinSize = 240,
  rightPanelMinSize = 320,
  rightPanelMaxSize = "50%",
  bottomPanelMinSize = 160,
  bottomPanelMaxSize = "50%",
  allowRightPanelFullscreen = false,
  rightPanelFullscreen = false,
  rightPanelResizeLabel,
  bottomPanelResizeLabel,
  onRightPanelResize,
  onBottomPanelResize,
  onBottomPanelVisibilityChange,
  onRightPanelFullscreenChange,
  style,
  ...props
}: ChatWorkspaceShellProps) {
  const shellStyle = {
    "--chat-thread-max-width": "48rem",
    "--chat-fixed-header-actions-width": "4.625rem",
    "--chat-right-panel-size": panelSize(rightPanelSize),
    "--chat-bottom-panel-size": panelSize(bottomPanelSize),
    "--chat-right-panel-current-size": panelSize(rightPanelSize),
    ...style,
  } as CSSProperties

  const hasRightPanel = rightPanel != null
  const hasBottomPanel = bottomPanel != null
  const rightVisible = rightPanelVisibility === "visible" && hasRightPanel
  const bottomVisible = bottomPanelVisibility === "visible" && hasBottomPanel
  const rightMounted = rightPanelVisibility !== "closed" && hasRightPanel
  const bottomMounted = bottomPanelVisibility !== "closed" && hasBottomPanel
  const rightPanelRef = useRef<ResizablePanelHandle>(null)
  const bottomPanelRef = useRef<ResizablePanelHandle>(null)
  const conversationPanelRef = useRef<ResizablePanelHandle>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const workspacePanelElementRef = useRef<HTMLDivElement>(null)
  const conversationPanelElementRef = useRef<HTMLDivElement>(null)
  const rightPanelElementRef = useRef<HTMLDivElement>(null)
  const bottomPanelElementRef = useRef<HTMLDivElement>(null)
  const previousRightVisibility = useRef(rightPanelVisibility)
  const previousBottomVisibility = useRef(bottomPanelVisibility)
  const previousRightFullscreen = useRef(rightPanelFullscreen)
  const rightPanelSizeRef = useRef(rightPanelSize)
  const bottomPanelSizeRef = useRef(bottomPanelSize)
  const transitionFrames = useRef<Record<"horizontal" | "vertical", number | undefined>>({
    horizontal: undefined,
    vertical: undefined,
  })
  const transitionTimers = useRef<Record<"horizontal" | "vertical", number | undefined>>({
    horizontal: undefined,
    vertical: undefined,
  })

  const stopLayoutAnimation = useCallback(
    (axis: "horizontal" | "vertical", elements: Array<HTMLDivElement | null>) => {
      const frame = transitionFrames.current[axis]
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      transitionFrames.current[axis] = undefined
      const timer = transitionTimers.current[axis]
      if (timer !== undefined) window.clearTimeout(timer)
      transitionTimers.current[axis] = undefined
      for (const element of elements) {
        if (element) delete element.dataset.transitioning
      }
    },
    []
  )

  const animateLayout = useCallback(
    (
      axis: "horizontal" | "vertical",
      elements: Array<HTMLDivElement | null>,
      update: () => void
    ) => {
      stopLayoutAnimation(axis, elements)
      for (const element of elements) {
        if (element) element.dataset.transitioning = "true"
      }
      transitionFrames.current[axis] = window.requestAnimationFrame(() => {
        transitionFrames.current[axis] = undefined
        update()
        transitionTimers.current[axis] = window.setTimeout(() => {
          for (const element of elements) {
            if (element) delete element.dataset.transitioning
          }
          transitionTimers.current[axis] = undefined
        }, 220)
      })
    },
    [stopLayoutAnimation]
  )

  useEffect(
    () => () => {
      for (const frame of Object.values(transitionFrames.current)) {
        if (frame !== undefined) window.cancelAnimationFrame(frame)
      }
      for (const timer of Object.values(transitionTimers.current)) {
        if (timer !== undefined) window.clearTimeout(timer)
      }
    },
    []
  )

  useLayoutEffect(() => {
    rightPanelSizeRef.current = rightPanelSize
  }, [rightPanelSize])

  useLayoutEffect(() => {
    bottomPanelSizeRef.current = bottomPanelSize
  }, [bottomPanelSize])

  useLayoutEffect(() => {
    const previousVisibility = previousRightVisibility.current
    if (previousVisibility === rightPanelVisibility) return
    previousRightVisibility.current = rightPanelVisibility
    if (previousVisibility === "closed") return
    const panel = rightPanelRef.current
    if (!panel) return
    if (rightPanelVisibility === "visible") {
      animateLayout(
        "horizontal",
        [conversationPanelElementRef.current, rightPanelElementRef.current],
        () => panel.resize(rightPanelSizeRef.current)
      )
      return
    }
    if (rightPanelVisibility === "hidden") {
      const currentSize = panel.getSize().inPixels
      if (currentSize > 0) rightPanelSizeRef.current = currentSize
      animateLayout(
        "horizontal",
        [conversationPanelElementRef.current, rightPanelElementRef.current],
        () => {
          conversationPanelRef.current?.expand()
          panel.collapse()
        }
      )
    }
  }, [animateLayout, rightPanelVisibility])

  useLayoutEffect(() => {
    const previousVisibility = previousBottomVisibility.current
    if (previousVisibility === bottomPanelVisibility) return
    previousBottomVisibility.current = bottomPanelVisibility
    if (previousVisibility === "closed") return
    const panel = bottomPanelRef.current
    if (!panel) return
    if (bottomPanelVisibility === "visible") {
      animateLayout(
        "vertical",
        [workspacePanelElementRef.current, bottomPanelElementRef.current],
        () => panel.resize(bottomPanelSizeRef.current)
      )
      return
    }
    if (bottomPanelVisibility === "hidden") {
      const currentSize = panel.getSize().inPixels
      if (currentSize > 0) bottomPanelSizeRef.current = currentSize
      animateLayout(
        "vertical",
        [workspacePanelElementRef.current, bottomPanelElementRef.current],
        () => panel.collapse()
      )
    }
  }, [animateLayout, bottomPanelVisibility])

  useLayoutEffect(() => {
    const previousFullscreen = previousRightFullscreen.current
    if (previousFullscreen === rightPanelFullscreen) return
    previousRightFullscreen.current = rightPanelFullscreen
    if (!allowRightPanelFullscreen || !rightVisible) return
    if (conversationPanelRef.current?.isCollapsed() === rightPanelFullscreen) return
    animateLayout(
      "horizontal",
      [conversationPanelElementRef.current, rightPanelElementRef.current],
      () => {
        if (rightPanelFullscreen) conversationPanelRef.current?.collapse()
        else conversationPanelRef.current?.expand()
      }
    )
  }, [allowRightPanelFullscreen, animateLayout, rightPanelFullscreen, rightVisible])

  return (
    <div
      data-slot="chat-workspace-shell"
      data-right-panel={rightPanelVisibility}
      data-bottom-panel={bottomPanelVisibility}
      data-right-panel-fullscreen={rightPanelFullscreen || undefined}
      className={cn("relative size-full min-h-0 min-w-0 overflow-hidden bg-background", className)}
      ref={shellRef}
      style={shellStyle}
      {...props}
    >
      <ChatPanelLayout
        className="size-full min-h-0"
        onLayoutChanged={(_layout, { isUserInteraction }) => {
          if (!isUserInteraction) return
          const inPixels = bottomPanelRef.current?.getSize().inPixels
          if (inPixels == null) return
          if (inPixels > 0) {
            const canRememberSize =
              typeof bottomPanelMinSize !== "number" || inPixels >= bottomPanelMinSize
            if (canRememberSize) {
              bottomPanelSizeRef.current = inPixels
              onBottomPanelResize?.(inPixels)
            }
            return
          }
          if (bottomVisible) onBottomPanelVisibilityChange?.("hidden")
        }}
        orientation="vertical"
      >
        <ResizablePanel
          className="data-[transitioning=true]:transition-[flex-grow] data-[transitioning=true]:duration-200 data-[transitioning=true]:ease-out motion-reduce:transition-none"
          elementRef={workspacePanelElementRef}
          id="chat-workspace"
          minSize={workspaceMinSize}
        >
          <ChatPanelLayout
            onLayoutChanged={(_layout, { isUserInteraction }) => {
              if (!isUserInteraction) return
              const conversationSize = conversationPanelRef.current?.getSize().inPixels
              if (allowRightPanelFullscreen && conversationSize != null) {
                const fullscreen = conversationSize <= 0
                if (fullscreen !== rightPanelFullscreen) {
                  onRightPanelFullscreenChange?.(fullscreen)
                }
                if (fullscreen) return
              }
              const inPixels = rightPanelRef.current?.getSize().inPixels
              if (inPixels == null || inPixels <= 0) return
              rightPanelSizeRef.current = inPixels
              onRightPanelResize?.(inPixels)
            }}
            orientation="horizontal"
          >
            <ResizablePanel
              className="data-[transitioning=true]:transition-[flex-grow] data-[transitioning=true]:duration-200 data-[transitioning=true]:ease-out motion-reduce:transition-none"
              collapsible={allowRightPanelFullscreen && rightVisible}
              collapsedSize={0}
              defaultSize={rightVisible && rightPanelFullscreen ? 0 : undefined}
              elementRef={conversationPanelElementRef}
              id="chat-conversation"
              minSize={mainPanelMinSize}
              panelRef={conversationPanelRef}
            >
              <div
                data-slot="chat-workspace-main-stack"
                className="flex size-full min-h-0 min-w-0 flex-col"
              >
                {header}
                {children}
              </div>
            </ResizablePanel>
            {rightMounted ? (
              <>
                <ChatPanelResizeHandle
                  aria-label={rightPanelResizeLabel}
                  aria-hidden={!rightVisible}
                  className={cn("z-10", !rightVisible && "hidden")}
                  onPointerDown={() =>
                    stopLayoutAnimation("horizontal", [
                      conversationPanelElementRef.current,
                      rightPanelElementRef.current,
                    ])
                  }
                />
                <ResizablePanel
                  className="data-[transitioning=true]:transition-[flex-grow] data-[transitioning=true]:duration-200 data-[transitioning=true]:ease-out motion-reduce:transition-none"
                  collapsible={!rightVisible}
                  collapsedSize={0}
                  defaultSize={rightVisible ? (rightPanelFullscreen ? "100%" : rightPanelSize) : 0}
                  elementRef={rightPanelElementRef}
                  groupResizeBehavior="preserve-pixel-size"
                  id="chat-right-panel"
                  maxSize={allowRightPanelFullscreen ? "100%" : rightPanelMaxSize}
                  minSize={rightPanelMinSize}
                  onResize={({ inPixels }) => {
                    shellRef.current?.style.setProperty(
                      "--chat-right-panel-current-size",
                      `${inPixels}px`
                    )
                  }}
                  panelRef={rightPanelRef}
                >
                  <aside
                    data-slot="chat-right-panel-surface"
                    data-state={rightPanelVisibility}
                    className="size-full min-h-0 min-w-0 bg-background"
                    {...retainedPanelProps(rightPanelVisibility)}
                  >
                    {rightPanel}
                  </aside>
                </ResizablePanel>
              </>
            ) : null}
          </ChatPanelLayout>
        </ResizablePanel>
        {bottomMounted ? (
          <>
            <ChatPanelResizeHandle
              aria-label={bottomPanelResizeLabel}
              aria-hidden={!bottomVisible}
              className={cn(!bottomVisible && "hidden")}
              onPointerDown={() =>
                stopLayoutAnimation("vertical", [
                  workspacePanelElementRef.current,
                  bottomPanelElementRef.current,
                ])
              }
            />
            <ResizablePanel
              className="data-[transitioning=true]:transition-[flex-grow] data-[transitioning=true]:duration-200 data-[transitioning=true]:ease-out motion-reduce:transition-none"
              collapsible
              collapsedSize={0}
              defaultSize={bottomVisible ? bottomPanelSize : 0}
              elementRef={bottomPanelElementRef}
              groupResizeBehavior="preserve-pixel-size"
              id="chat-bottom-panel"
              maxSize={bottomPanelMaxSize}
              minSize={bottomPanelMinSize}
              panelRef={bottomPanelRef}
            >
              <div
                data-slot="chat-bottom-panel-surface"
                data-state={bottomPanelVisibility}
                className="size-full min-h-0 min-w-0 bg-background"
                {...retainedPanelProps(bottomPanelVisibility)}
              >
                {bottomPanel}
              </div>
            </ResizablePanel>
          </>
        ) : null}
      </ChatPanelLayout>
      {fixedHeaderActions ? (
        <div
          data-slot="chat-workspace-fixed-header-actions"
          className={cn(
            "absolute top-0 right-0 z-40 flex h-(--chat-header-height) w-(--chat-fixed-header-actions-width) items-center justify-end gap-1 bg-background pe-1.5 [-webkit-app-region:no-drag]",
            !rightVisible && "border-b"
          )}
        >
          {fixedHeaderActions}
        </div>
      ) : null}
    </div>
  )
}

export function ChatMainColumn({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <main
      data-slot="chat-main-column"
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}
      {...props}
    />
  )
}

export type { ChatWorkspaceShellProps }
