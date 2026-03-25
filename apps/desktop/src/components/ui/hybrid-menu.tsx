"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { RiArrowRightSLine, RiCheckLine } from "@remixicon/react"

import { cn } from "@/lib/utils"

type HybridMode = "dropdown-menu" | "context-menu"

type HybridMenuRootProps = {
  mode: HybridMode
} & (MenuPrimitive.Root.Props | ContextMenuPrimitive.Root.Props)

type HybridMenuTriggerProps =
  | MenuPrimitive.Trigger.Props
  | ContextMenuPrimitive.Trigger.Props

type HybridMenuContentProps = MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >

const HybridMenuModeContext = React.createContext<{ mode: HybridMode } | null>(
  null
)

function useHybridMode() {
  const context = React.useContext(HybridMenuModeContext)

  if (!context) {
    throw new Error("HybridMenu components must be used within <HybridMenu>")
  }

  return context.mode
}

function HybridMenu({ mode, ...props }: HybridMenuRootProps) {
  return (
    <HybridMenuModeContext.Provider value={{ mode }}>
      {mode === "dropdown-menu" ? (
        <MenuPrimitive.Root
          data-slot="dropdown-menu"
          {...(props as MenuPrimitive.Root.Props)}
        />
      ) : (
        <ContextMenuPrimitive.Root
          data-slot="context-menu"
          {...(props as ContextMenuPrimitive.Root.Props)}
        />
      )}
    </HybridMenuModeContext.Provider>
  )
}

function HybridMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  const mode = useHybridMode()

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  ) : (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  )
}

function HybridMenuTrigger({ ...props }: HybridMenuTriggerProps) {
  const mode = useHybridMode()

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...(props as MenuPrimitive.Trigger.Props)}
    />
  ) : (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      {...(props as ContextMenuPrimitive.Trigger.Props)}
    />
  )
}

function HybridMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  const mode = useHybridMode()

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  ) : (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  )
}

function HybridMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  const mode = useHybridMode()

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
  ) : (
    <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
  )
}

function HybridMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  const mode = useHybridMode()

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
  ) : (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  )
}

function HybridMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  const mode = useHybridMode()
  const slot =
    mode === "dropdown-menu"
      ? "dropdown-menu-sub-trigger"
      : "context-menu-sub-trigger"

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.SubmenuTrigger
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <RiArrowRightSLine className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  ) : (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <RiArrowRightSLine className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  )
}

function HybridMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: HybridMenuContentProps) {
  const mode = useHybridMode()
  const slot =
    mode === "dropdown-menu" ? "dropdown-menu-content" : "context-menu-content"

  return (
    <HybridMenuPortal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot={slot}
          className={cn(
            "z-50 max-h-(--available-height) min-w-32 min-w-(--anchor-width) w-max origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </HybridMenuPortal>
  )
}

function HybridMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  const mode = useHybridMode()
  const slot = mode === "dropdown-menu" ? "dropdown-menu-item" : "context-menu-item"

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.Item
      data-slot={slot}
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/hybrid-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm whitespace-nowrap outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  ) : (
    <ContextMenuPrimitive.Item
      data-slot={slot}
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/hybrid-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm whitespace-nowrap outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function HybridMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  const mode = useHybridMode()
  const slot =
    mode === "dropdown-menu"
      ? "dropdown-menu-checkbox-item"
      : "context-menu-checkbox-item"

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.CheckboxItem
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "group/hybrid-menu-item relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot={`${slot}-indicator`}
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <RiCheckLine />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  ) : (
    <ContextMenuPrimitive.CheckboxItem
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "group/hybrid-menu-item relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot={`${slot}-indicator`}
      >
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <RiCheckLine />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function HybridMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  const mode = useHybridMode()
  const slot =
    mode === "dropdown-menu"
      ? "dropdown-menu-radio-item"
      : "context-menu-radio-item"

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.RadioItem
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "group/hybrid-menu-item relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot={`${slot}-indicator`}
      >
        <MenuPrimitive.RadioItemIndicator>
          <RiCheckLine />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  ) : (
    <ContextMenuPrimitive.RadioItem
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "group/hybrid-menu-item relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot={`${slot}-indicator`}
      >
        <ContextMenuPrimitive.RadioItemIndicator>
          <RiCheckLine />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function HybridMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  const mode = useHybridMode()
  const slot =
    mode === "dropdown-menu" ? "dropdown-menu-label" : "context-menu-label"

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.GroupLabel
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  ) : (
    <ContextMenuPrimitive.GroupLabel
      data-slot={slot}
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function HybridMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  const mode = useHybridMode()

  return mode === "dropdown-menu" ? (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  ) : (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function HybridMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const mode = useHybridMode()

  return (
    <span
      data-slot={
        mode === "dropdown-menu"
          ? "dropdown-menu-shortcut"
          : "context-menu-shortcut"
      }
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/hybrid-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function HybridMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: HybridMenuContentProps) {
  return (
    <HybridMenuContent
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className={cn(
        "w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

export {
  HybridMenu,
  HybridMenuCheckboxItem,
  HybridMenuContent,
  HybridMenuGroup,
  HybridMenuItem,
  HybridMenuLabel,
  HybridMenuPortal,
  HybridMenuRadioGroup,
  HybridMenuRadioItem,
  HybridMenuSeparator,
  HybridMenuShortcut,
  HybridMenuSub,
  HybridMenuSubContent,
  HybridMenuSubTrigger,
  HybridMenuTrigger,
}
