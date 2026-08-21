import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The tooltip primitive.
 *
 * Explicitly a progressive enhancement. A tooltip does not appear on touch,
 * and much of this product runs on tablets, so nothing an operator needs may
 * live only in one: tooltips carry the expansion of an abbreviation or the
 * definition of a column, never an instruction or a state.
 */
export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'v2 z-50 max-w-xs rounded-control border border-line-strong bg-raised px-3 py-2',
          'font-ui text-small text-ink shadow-popover',
          'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}
