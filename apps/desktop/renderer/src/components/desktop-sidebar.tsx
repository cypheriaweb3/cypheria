import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@cypheria/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@cypheria/ui/components/tooltip"
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type MouseEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import "./desktop-sidebar.css"

const PreviewContext = createContext({
  preview: false,
  enter: () => {},
  requestPreview: () => {},
  toggle: (_event: MouseEvent<HTMLElement>) => {},
  leave: () => {},
  dismiss: () => {},
})

export function DesktopSidebarProvider({
  children,
  ...props
}: ComponentProps<typeof SidebarProvider>) {
  return (
    <SidebarProvider {...props}>
      <DesktopSidebarLayout>{children}</DesktopSidebarLayout>
    </SidebarProvider>
  )
}

function DesktopSidebarLayout({ children }: ComponentProps<"div">) {
  const { open, isMobile, setOpen } = useSidebar()
  const [preview, setPreview] = useState(false)
  const [width, setWidth] = useState(288)
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef<{ x: number; width: number } | null>(null)
  const blockedTrigger = useRef<DOMRect | null>(null)
  const clampWidth = (value: number) => Math.max(240, Math.min(value, 480, window.innerWidth - 520))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clear = () => clearTimeout(timer.current)
  const dismiss = () => {
    clear()
    setPreview(false)
  }
  useEffect(() => {
    if (open || isMobile) setPreview(false)
    return () => clearTimeout(timer.current)
  }, [open, isMobile])
  useEffect(() => {
    // Layout changes can synthesize pointerenter on the replacement toggle.
    // Only a real pointer move outside the clicked button rearms its preview.
    const onMove = (event: PointerEvent) => {
      const rect = blockedTrigger.current
      if (
        rect &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        blockedTrigger.current = null
    }
    const onResize = () =>
      setWidth((value) => Math.max(240, Math.min(value, 480, window.innerWidth - 520)))
    window.addEventListener("pointermove", onMove)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("resize", onResize)
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearTimeout(timer.current)
        setPreview(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <PreviewContext.Provider
      value={{
        preview,
        dismiss,
        toggle: (event) => {
          blockedTrigger.current = event.currentTarget.getBoundingClientRect()
          dismiss()
        },
        enter: clear,
        requestPreview: () => {
          clear()
          if (!open && !isMobile && !blockedTrigger.current)
            timer.current = setTimeout(() => setPreview(true), 180)
        },
        leave: () => {
          clear()
          if (!dragStart.current) timer.current = setTimeout(() => setPreview(false), 220)
        },
      }}
    >
      <div
        className="desktop-shell"
        data-open={open}
        data-preview={preview && !open}
        data-resizing={resizing}
        style={{ "--sidebar-width": `${width}px` } as CSSProperties}
      >
        {children}
        {!isMobile && (open || preview) ? (
          // biome-ignore lint/a11y/useSemanticElements: This focusable separator is an interactive window splitter, not a thematic break.
          <div
            className="desktop-sidebar-resizer"
            role="separator"
            aria-label="Sidebar width"
            aria-orientation="vertical"
            aria-valuemin={240}
            aria-valuemax={480}
            aria-valuenow={width}
            tabIndex={0}
            onPointerEnter={clear}
            onPointerLeave={() => {
              if (!dragStart.current) timer.current = setTimeout(() => setPreview(false), 220)
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              clear()
              dragStart.current = { x: event.clientX, width }
              event.currentTarget.setPointerCapture(event.pointerId)
              setResizing(true)
            }}
            onPointerMove={(event) => {
              if (!dragStart.current) return
              const requestedWidth = dragStart.current.width + event.clientX - dragStart.current.x
              // Collapse only after dragging past half of the minimum sidebar width.
              if (requestedWidth < 240 / 2) {
                dragStart.current = null
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId)
                setWidth(240)
                setResizing(false)
                dismiss()
                setOpen(false)
                return
              }
              setWidth(clampWidth(requestedWidth))
            }}
            onPointerUp={(event) => {
              dragStart.current = null
              setResizing(false)
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onLostPointerCapture={() => {
              dragStart.current = null
              setResizing(false)
            }}
            onPointerCancel={() => {
              dragStart.current = null
              setResizing(false)
            }}
            onDoubleClick={() => setWidth(288)}
            onKeyDown={(event) => {
              if (
                event.key !== "ArrowLeft" &&
                event.key !== "ArrowRight" &&
                event.key !== "Home" &&
                event.key !== "End"
              )
                return
              event.preventDefault()
              setWidth(
                clampWidth(
                  event.key === "Home"
                    ? 240
                    : event.key === "End"
                      ? 480
                      : width + (event.key === "ArrowLeft" ? -16 : 16)
                )
              )
            }}
          />
        ) : null}
      </div>
    </PreviewContext.Provider>
  )
}

export function DesktopSidebar(props: ComponentProps<typeof Sidebar>) {
  const { open, isMobile } = useSidebar()
  const { preview, enter, leave, dismiss } = useContext(PreviewContext)
  return (
    <Sidebar
      {...props}
      collapsible="offcanvas"
      inert={!isMobile && !open && !preview}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocusCapture={enter}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) leave()
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) dismiss()
      }}
    />
  )
}

export function DesktopSidebarTrigger(props: ComponentProps<typeof SidebarTrigger>) {
  const { requestPreview, leave, toggle } = useContext(PreviewContext)
  const { open } = useSidebar()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarTrigger
            {...props}
            aria-expanded={open}
            onClick={toggle}
            onPointerEnter={requestPreview}
            onPointerLeave={leave}
          />
        }
      />
      <TooltipContent side="bottom" className="pointer-events-none">
        Toggle sidebar <kbd>⌘B / Ctrl+B</kbd>
      </TooltipContent>
    </Tooltip>
  )
}

export function DesktopCollapsedToolbar({ children }: ComponentProps<"div">) {
  const { open } = useSidebar()
  return (
    <div className="desktop-collapsed-tools" inert={open}>
      {children}
    </div>
  )
}
