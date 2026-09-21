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
      className={cn("bg-transparent hover:bg-border focus-visible:bg-border", className)}
      {...props}
    />
  )
}

export function ChatPanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-panel-header"
      className={cn("flex h-11 min-h-11 min-w-0 items-center gap-1 border-b px-2", className)}
      {...props}
    />
  )
}

type ChatPanelTabsProps = HTMLAttributes<HTMLDivElement> & {
  tabs: readonly ChatPanelTabDescriptor[]
  activeTabId?: string
  placement: ChatPanelPlacement
  onCloseTab?: (tabId: string) => void
  onMoveTab?: (tabId: string, placement: ChatPanelPlacement) => void
  closeTabLabel?: (tab: ChatPanelTabDescriptor) => string
  moveTabLabel?: (tab: ChatPanelTabDescriptor, placement: ChatPanelPlacement) => string
}

export function ChatPanelTabs({
  className,
  tabs,
  activeTabId,
  placement,
  onCloseTab,
  onMoveTab,
  closeTabLabel,
  moveTabLabel,
  ...props
}: ChatPanelTabsProps) {
  const destination: ChatPanelPlacement = placement === "right" ? "bottom" : "right"
  return (
    <div
      data-slot="chat-panel-tabs"
      className={cn("min-w-0 flex-1 overflow-x-auto", className)}
      {...props}
    >
      <TabsList className="h-10 max-w-full justify-start gap-0 bg-transparent p-0" variant="line">
        {tabs.map((tab) => (
          <div
            data-slot="chat-panel-tab"
            data-active={tab.id === activeTabId || undefined}
            className="group/chat-panel-tab flex min-w-0 shrink-0 items-center"
            key={tab.id}
          >
            <TabsTrigger
              className="h-10 min-w-0 max-w-48 gap-1 rounded-none px-2 text-xs"
              disabled={tab.disabled}
              value={tab.id}
            >
              {tab.icon}
              <span className="truncate">{tab.title}</span>
              {tab.badge}
            </TabsTrigger>
            {tab.movable && onMoveTab && moveTabLabel && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={moveTabLabel(tab, destination)}
                        className="size-6 opacity-0 group-focus-within/chat-panel-tab:opacity-100 group-hover/chat-panel-tab:opacity-100"
                        onClick={() => onMoveTab(tab.id, destination)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        {destination === "bottom" ? <DockIcon /> : <SidebarRightIcon />}
                      </Button>
                    }
                  />
                  <TooltipContent>{moveTabLabel(tab, destination)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {tab.closable && onCloseTab && closeTabLabel && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={closeTabLabel(tab)}
                        className="size-6 opacity-0 group-focus-within/chat-panel-tab:opacity-100 group-hover/chat-panel-tab:opacity-100"
                        onClick={() => onCloseTab(tab.id)}
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
            )}
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
  ...props
}: ChatPanelProps) {
  if (visibility === "closed") return null

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
      {tabs.length === 0 ? (
        emptyState
      ) : (
        <Tabs
          className="size-full min-h-0 gap-0"
          onValueChange={onActiveTabChange}
          value={activeTabId ?? tabs[0]?.id}
        >
          <ChatPanelHeader>
            <ChatPanelTabs
              activeTabId={activeTabId ?? tabs[0]?.id}
              closeTabLabel={closeTabLabel}
              moveTabLabel={moveTabLabel}
              onCloseTab={onCloseTab}
              onMoveTab={onMoveTab}
              placement={placement}
              tabs={tabs}
            />
            {actions}
            {onVisibilityChange && hideLabel && (
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
                        {placement === "right" ? <SidebarRightIcon /> : <DockIcon />}
                      </Button>
                    }
                  />
                  <TooltipContent>{hideLabel}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {launcher}
          </ChatPanelHeader>
          {tabs.map((tab) => (
            <TabsContent className="m-0 min-h-0 overflow-hidden" key={tab.id} value={tab.id}>
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      )}
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
