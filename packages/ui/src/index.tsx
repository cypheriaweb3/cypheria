import { Dialog } from "@base-ui/react/dialog"
import { Toast } from "@base-ui/react/toast"
import { Tooltip } from "@base-ui/react/tooltip"
import { cva, type VariantProps } from "class-variance-authority"
import { type ClassValue, clsx } from "clsx"
import { X } from "lucide-react"
import * as React from "react"
import { twMerge } from "tailwind-merge"

export type ComponentTone = "default" | "muted" | "danger"

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))

const buttonVariants = cva("cy-button", {
  defaultVariants: {
    size: "md",
    variant: "default",
  },
  variants: {
    size: {
      icon: "cy-button--icon",
      md: "cy-button--md",
      sm: "cy-button--sm",
    },
    variant: {
      default: "cy-button--default",
      destructive: "cy-button--destructive",
      ghost: "cy-button--ghost",
      secondary: "cy-button--secondary",
    },
  },
})

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, type = "button", ...props }, ref) => (
    <button
      className={cn(buttonVariants({ size, variant }), className)}
      ref={ref}
      type={type}
      {...props}
    />
  )
)
Button.displayName = "Button"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input className={cn("cy-input", className)} ref={ref} {...props} />
  )
)
Input.displayName = "Input"

const badgeVariants = cva("cy-badge", {
  defaultVariants: {
    tone: "default",
  },
  variants: {
    tone: {
      danger: "cy-badge--danger",
      default: "cy-badge--default",
      muted: "cy-badge--muted",
      success: "cy-badge--success",
      warning: "cy-badge--warning",
    },
  },
})

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span className={cn(badgeVariants({ tone }), className)} ref={ref} {...props} />
  )
)
Badge.displayName = "Badge"

export const DialogRoot = Dialog.Root
export const DialogTrigger = Dialog.Trigger
export const DialogClose = Dialog.Close
export const DialogTitle = Dialog.Title
export const DialogDescription = Dialog.Description

export type DialogContentProps = React.ComponentProps<typeof Dialog.Popup>

export const DialogContent = ({ children, className, ...props }: DialogContentProps) => (
  <Dialog.Portal>
    <Dialog.Backdrop className="cy-dialog-backdrop" />
    <Dialog.Popup className={cn("cy-dialog-content", className)} {...props}>
      {children}
    </Dialog.Popup>
  </Dialog.Portal>
)

export type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement>

export const DialogHeader = ({ className, ...props }: DialogHeaderProps) => (
  <div className={cn("cy-dialog-header", className)} {...props} />
)

export type DialogFooterProps = React.HTMLAttributes<HTMLDivElement>

export const DialogFooter = ({ className, ...props }: DialogFooterProps) => (
  <div className={cn("cy-dialog-footer", className)} {...props} />
)

export type DialogCloseButtonProps = React.ComponentProps<typeof Dialog.Close>

export const DialogCloseButton = ({ className, children, ...props }: DialogCloseButtonProps) => (
  <Dialog.Close aria-label="Close" className={cn("cy-dialog-close", className)} {...props}>
    {children ?? <X aria-hidden="true" size={15} strokeWidth={2} />}
  </Dialog.Close>
)

export const SheetRoot = Dialog.Root
export const SheetTrigger = Dialog.Trigger
export const SheetClose = Dialog.Close
export const SheetTitle = Dialog.Title
export const SheetDescription = Dialog.Description

export type SheetSide = "bottom" | "left" | "right" | "top"

export type SheetContentProps = React.ComponentProps<typeof Dialog.Popup> & {
  readonly side?: SheetSide
}

export const SheetContent = ({
  children,
  className,
  side = "right",
  ...props
}: SheetContentProps) => (
  <Dialog.Portal>
    <Dialog.Backdrop className="cy-dialog-backdrop" />
    <Dialog.Popup className={cn("cy-sheet", `cy-sheet--${side}`, className)} {...props}>
      {children}
    </Dialog.Popup>
  </Dialog.Portal>
)

export const TooltipProvider = Tooltip.Provider
export const TooltipRoot = Tooltip.Root
export const TooltipTrigger = Tooltip.Trigger

export type TooltipContentProps = React.ComponentProps<typeof Tooltip.Popup> & {
  readonly sideOffset?: number
}

export const TooltipContent = ({
  children,
  className,
  sideOffset = 8,
  ...props
}: TooltipContentProps) => (
  <Tooltip.Portal>
    <Tooltip.Positioner sideOffset={sideOffset}>
      <Tooltip.Popup className={cn("cy-tooltip", className)} {...props}>
        <Tooltip.Arrow className="cy-tooltip-arrow" />
        {children}
      </Tooltip.Popup>
    </Tooltip.Positioner>
  </Tooltip.Portal>
)

export const ToastProvider = Toast.Provider
export const ToastViewport = Toast.Viewport
export const toastManager = Toast.createToastManager()
export const useToastManager = Toast.useToastManager

export type ToasterProps = React.ComponentProps<typeof Toast.Viewport>

export const Toaster = ({ className, ...props }: ToasterProps) => {
  const { toasts } = Toast.useToastManager()

  return (
    <Toast.Portal>
      <Toast.Viewport className={cn("cy-toast-viewport", className)} {...props}>
        {toasts.map((toast) => (
          <Toast.Root className="cy-toast" key={toast.id} toast={toast}>
            <Toast.Content className="cy-toast-content">
              <div className="cy-toast-copy">
                <Toast.Title className="cy-toast-title" />
                <Toast.Description className="cy-toast-description" />
              </div>
              <Toast.Close className="cy-toast-close">Dismiss</Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

export type SidebarProps = React.HTMLAttributes<HTMLElement>

export const Sidebar = ({ className, ...props }: SidebarProps) => (
  <aside className={cn("cy-sidebar", className)} {...props} />
)

export type SidebarHeaderProps = React.HTMLAttributes<HTMLDivElement>

export const SidebarHeader = ({ className, ...props }: SidebarHeaderProps) => (
  <div className={cn("cy-sidebar-header", className)} {...props} />
)

export type SidebarContentProps = React.HTMLAttributes<HTMLDivElement>

export const SidebarContent = ({ className, ...props }: SidebarContentProps) => (
  <div className={cn("cy-sidebar-content", className)} {...props} />
)

export type SidebarFooterProps = React.HTMLAttributes<HTMLDivElement>

export const SidebarFooter = ({ className, ...props }: SidebarFooterProps) => (
  <div className={cn("cy-sidebar-footer", className)} {...props} />
)

export type SidebarNavProps = React.HTMLAttributes<HTMLElement>

export const SidebarNav = ({ className, ...props }: SidebarNavProps) => (
  <nav className={cn("cy-sidebar-nav", className)} {...props} />
)

export type SidebarNavItemProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly active?: boolean
  readonly icon?: React.ReactNode
}

export const SidebarNavItem = ({
  active = false,
  children,
  className,
  icon,
  ...props
}: SidebarNavItemProps) => (
  <a
    aria-current={active ? "page" : undefined}
    className={cn("cy-sidebar-nav-item", className)}
    {...props}
  >
    {icon ? <span className="cy-sidebar-nav-icon">{icon}</span> : null}
    <span className="cy-sidebar-nav-label">{children}</span>
  </a>
)
