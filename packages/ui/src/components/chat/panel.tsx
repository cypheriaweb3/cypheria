import type { ComponentProps, HTMLAttributes, ReactNode } from "react"

import { Button } from "#components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#components/dropdown-menu"
import { ResizableHandle, ResizablePanelGroup } from "#components/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#components/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/tooltip"
import { cn } from "#lib/utils"
import { CloseBoldIcon, DockIcon, PlusComposerIcon, SidebarRightIcon } from "../icons/index.js"

import type {
  ChatPanelLauncherItem,
  ChatPanelPlacement,
  ChatPanelTabDescriptor,
  ChatPanelVisibility,
} from "./types.js"

type ChatPanelLayoutProps = ComponentProps<typeof ResizablePanelGroup>

export function ChatPanelLayout({
  className,
  orientation = "horizontal",
  ...props
}: ChatPanelLayoutProps) {
  return (
    <ResizablePanelGroup
      data-slot="chat-panel-layout"
      className={cn("min-h-0 min-w-0", className)}
      orientation={orientation}
      {...props}
    />
  )
}

export function ChatPanelResizeHandle({
  className,
  ...props
}: ComponentProps<typeof ResizableHandle>) {
  return (
    <ResizableHandle
      data-slot="chat-panel-resize-handle"
      className={cn("z-20 hover:bg-ring/45", className)}
      {...props}
    />
  )
}

export function ChatPanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-panel-header"
      className={cn(
        "flex h-9 min-h-9 min-w-0 items-center gap-1.5 border-b border-border/80 bg-background ps-2 pe-1.5",
        "data-[placement=bottom]:bg-muted/25",
        className
      )}
      {...props}
    />
  )
}

type ChatPanelTabsProps = HTMLAttributes<HTMLDivElement> & {
  tabs: readonly ChatPanelTabDescriptor[]
  activeTabId?: string
  placement: ChatPanelPlacement
  onCloseTab?: (tabId: string) => void
  closeTabLabel?: (tab: ChatPanelTabDescriptor) => string
  label?: string
}

export function ChatPanelTabs({
  className,
  tabs,
  activeTabId,
  placement,
  onCloseTab,
  closeTabLabel,
  label,
  onKeyDown,
  ...props
}: ChatPanelTabsProps) {
  return (
    <div
      data-slot="chat-panel-tabs"
      data-placement={placement}
      className={cn(
        "relative isolate flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    >
      <TabsList
        aria-label={label}
        className="h-full min-w-max justify-start gap-[3px] bg-transparent p-0"
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented || event.key !== "Delete" || !onCloseTab) return
          const trigger = (event.target as HTMLElement).closest<HTMLElement>(
            '[role="tab"][data-tab-id]'
          )
          const tab = tabs.find((item) => item.id === trigger?.dataset.tabId)
          if (!tab?.closable) return
          event.preventDefault()
          onCloseTab(tab.id)
        }}
        variant="line"
      >
        {tabs.map((tab) => (
          <div
            data-slot="chat-panel-tab"
            data-active={tab.id === activeTabId || undefined}
            className={cn(
              "group/chat-panel-tab relative my-auto flex h-7 min-w-20 basis-36 items-center overflow-hidden rounded-lg",
              "max-w-52 flex-1 shrink-0 bg-background/80",
              "after:absolute after:top-1/2 after:-right-0.5 after:h-3 after:w-px after:-translate-y-1/2 after:bg-border/80 after:content-['']",
              "last:after:hidden data-[active=true]:bg-muted data-[active=true]:after:hidden",
              "hover:bg-muted/70 has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
            )}
            key={tab.id}
          >
            <TabsTrigger
              aria-keyshortcuts={tab.closable && onCloseTab ? "Delete" : undefined}
              className={cn(
                "h-7 min-w-0 flex-1 justify-start gap-1.5 rounded-lg border-0 px-2 py-1 text-xs font-normal",
                "after:hidden hover:text-foreground focus-visible:ring-0 focus-visible:outline-none",
                "data-active:bg-transparent data-active:font-medium data-active:shadow-none",
                tab.closable && "pe-5"
              )}
              data-tab-id={tab.id}
              disabled={tab.disabled}
              value={tab.id}
            >
              {tab.icon ? (
                <span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">
                  {tab.icon}
                </span>
              ) : null}
              <span
                className="min-w-0 truncate"
                style={
                  tab.closable
                    ? {
                        maskImage:
                          "linear-gradient(to right, black calc(100% - 0.75rem), transparent)",
                      }
                    : undefined
                }
              >
                {tab.title}
              </span>
              {tab.badge}
            </TabsTrigger>
            {tab.closable && onCloseTab && closeTabLabel ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={closeTabLabel(tab)}
                        className={cn(
                          "absolute top-1/2 right-0.5 z-10 size-5 -translate-y-1/2 rounded-md",
                          tab.id === activeTabId
                            ? "opacity-100"
                            : "pointer-events-none opacity-0 group-focus-within/chat-panel-tab:pointer-events-auto group-focus-within/chat-panel-tab:opacity-100 group-hover/chat-panel-tab:pointer-events-auto group-hover/chat-panel-tab:opacity-100"
                        )}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <CloseBoldIcon />
                      </Button>
                    }
                  />
                  <TooltipContent>{closeTabLabel(tab)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        ))}
      </TabsList>
    </div>
  )
}

type ChatPanelLauncherProps = Omit<ComponentProps<typeof DropdownMenu>, "children"> & {
  label: string
  items: readonly ChatPanelLauncherItem[]
  onLaunch: (itemId: string) => void
  children?: ReactNode
  className?: string
}

export function ChatPanelLauncher({
  label,
  items,
  onLaunch,
  children,
  className,
  ...menuProps
}: ChatPanelLauncherProps) {
  return (
    <DropdownMenu {...menuProps}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={label}
            data-slot="chat-panel-launcher"
            className={className}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        {children ?? <PlusComposerIcon />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {items.map((item) => (
          <DropdownMenuItem
            disabled={item.disabled}
            key={item.id}
            onClick={() => onLaunch(item.id)}
          >
            {item.icon}
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{item.label}</span>
              {item.description && (
                <span className="truncate text-xs text-muted-foreground">{item.description}</span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type ChatPanelProps = HTMLAttributes<HTMLDivElement> & {
  tabs: readonly ChatPanelTabDescriptor[]
  activeTabId?: string
  placement: ChatPanelPlacement
  visibility?: ChatPanelVisibility
  actions?: ReactNode
  launcher?: ReactNode
  emptyState?: ReactNode
  onActiveTabChange?: (tabId: string) => void
  onCloseTab?: (tabId: string) => void
  onMoveTab?: (tabId: string, placement: ChatPanelPlacement) => void
  onVisibilityChange?: (visibility: ChatPanelVisibility) => void
  hideLabel?: string
  closeTabLabel?: (tab: ChatPanelTabDescriptor) => string
  moveTabLabel?: (tab: ChatPanelTabDescriptor, placement: ChatPanelPlacement) => string
  tabsLabel?: string
  headerVisible?: boolean
  headerClassName?: string
  workspaceHeader?: boolean
}

export function ChatPanel({
  className,
  tabs,
  activeTabId,
  placement,
  visibility = "visible",
  actions,
  launcher,
  emptyState,
  onActiveTabChange,
  onCloseTab,
  onMoveTab,
  onVisibilityChange,
  hideLabel,
  closeTabLabel,
  moveTabLabel,
  tabsLabel,
  headerVisible = true,
  headerClassName,
  workspaceHeader = false,
  ...props
}: ChatPanelProps) {
  if (visibility === "closed") return null

  const selectedTabId = activeTabId ?? tabs[0]?.id
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId)
  const destination: ChatPanelPlacement = placement === "right" ? "bottom" : "right"

  return (
    <div
      aria-hidden={visibility === "visible" ? undefined : true}
      data-slot="chat-panel"
      data-placement={placement}
      data-state={visibility}
      hidden={visibility !== "visible"}
      inert={visibility === "visible" ? undefined : true}
      className={cn("flex size-full min-h-0 min-w-0 flex-col bg-background", className)}
      {...props}
    >
      <Tabs
        className="size-full min-h-0 gap-0"
        onValueChange={onActiveTabChange}
        value={selectedTabId}
      >
        {headerVisible ? (
          <ChatPanelHeader
            className={cn(
              workspaceHeader &&
                placement === "right" &&
                "relative z-30 h-(--chat-header-height) min-h-(--chat-header-height) border-b-0 pe-[calc(var(--chat-fixed-header-actions-width,4.625rem)+0.25rem)]",
              headerClassName
            )}
            data-placement={placement}
            data-workspace-header={workspaceHeader || undefined}
          >
            <div className="flex min-w-0 flex-1 items-center gap-0.5">
              {tabs.length ? (
                <ChatPanelTabs
                  activeTabId={selectedTabId}
                  className="flex-[0_1_auto]"
                  closeTabLabel={closeTabLabel}
                  label={tabsLabel}
                  onCloseTab={onCloseTab}
                  placement={placement}
                  tabs={tabs}
                />
              ) : (
                <div className="min-w-0 flex-1" />
              )}
              {launcher}
            </div>
            <div
              data-slot="chat-panel-header-actions"
              className="ml-auto flex shrink-0 items-center gap-1"
            >
              {actions}
              {selectedTab?.movable && onMoveTab && moveTabLabel ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label={moveTabLabel(selectedTab, destination)}
                          onClick={() => onMoveTab(selectedTab.id, destination)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          {destination === "bottom" ? <DockIcon /> : <SidebarRightIcon />}
                        </Button>
                      }
                    />
                    <TooltipContent>{moveTabLabel(selectedTab, destination)}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              {onVisibilityChange && hideLabel ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label={hideLabel}
                          onClick={() => onVisibilityChange("hidden")}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <CloseBoldIcon />
                        </Button>
                      }
                    />
                    <TooltipContent>{hideLabel}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
          </ChatPanelHeader>
        ) : null}
        {tabs.length ? (
          tabs.map((tab) => (
            <TabsContent className="m-0 min-h-0 overflow-hidden" key={tab.id} value={tab.id}>
              {tab.content}
            </TabsContent>
          ))
        ) : (
          <div className="min-h-0 flex-1">{emptyState}</div>
        )}
      </Tabs>
    </div>
  )
}

export function ChatPanelContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-panel-content"
      className={cn("cypheria-scrollbar size-full min-h-0 overflow-auto p-3", className)}
      {...props}
    />
  )
}

export function ChatPanelSection({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-slot="chat-panel-section"
      className={cn("flex min-w-0 flex-col gap-2 py-2", className)}
      {...props}
    />
  )
}

export function ChatPanelList({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      data-slot="chat-panel-list"
      className={cn("flex min-w-0 flex-col gap-0.5", className)}
      {...props}
    />
  )
}

export function ChatPanelListItem({ className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      data-slot="chat-panel-list-item"
      className={cn("min-w-0 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/70", className)}
      {...props}
    />
  )
}

type ChatPanelStateProps = HTMLAttributes<HTMLDivElement> & {
  icon?: ReactNode
}

export function ChatPanelEmptyState({ className, icon, children, ...props }: ChatPanelStateProps) {
  return (
    <div
      data-slot="chat-panel-empty-state"
      className={cn(
        "flex size-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </div>
  )
}

export function ChatPanelErrorState({ className, icon, children, ...props }: ChatPanelStateProps) {
  return (
    <div
      data-slot="chat-panel-error-state"
      className={cn(
        "flex size-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive",
        className
      )}
      role="alert"
      {...props}
    >
      {icon}
      {children}
    </div>
  )
}

export function ChatPanelLoadingState({
  className,
  icon,
  children,
  ...props
}: ChatPanelStateProps) {
  return (
    <div
      data-slot="chat-panel-loading-state"
      className={cn(
        "flex size-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground",
        className
      )}
      role="status"
      {...props}
    >
      {icon}
      {children}
    </div>
  )
}

export type {
  ChatPanelLauncherProps,
  ChatPanelLayoutProps,
  ChatPanelProps,
  ChatPanelStateProps,
  ChatPanelTabsProps,
}
