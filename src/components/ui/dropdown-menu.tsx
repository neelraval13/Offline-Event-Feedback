import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The menu primitive.
 *
 * For actions that belong to a row or a record and would otherwise put five
 * buttons in every table row. Rows are 44px, like every other target.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'v2 z-50 min-w-[10rem] overflow-hidden rounded-control border border-line-strong bg-raised p-1',
          'font-ui text-base text-ink shadow-popover',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export type DropdownMenuItemProps = ComponentProps<
  typeof DropdownMenuPrimitive.Item
> & {
  /** Irreversible actions read as destructive here too, not only in buttons. */
  readonly tone?: 'default' | 'danger'
}

export function DropdownMenuItem({
  className,
  tone = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'relative flex min-h-11 cursor-default select-none items-center gap-2.5',
        'rounded-chip px-2.5 py-1.5 outline-none',
        'focus:bg-interactive-soft focus:text-ink',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        tone === 'danger' && 'text-danger focus:bg-danger-soft focus:text-danger',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        'px-2.5 py-1.5 text-label font-semibold uppercase tracking-[0.08em] text-faint',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-line', className)}
      {...props}
    />
  )
}
