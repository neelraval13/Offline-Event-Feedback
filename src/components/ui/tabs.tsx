import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The tab primitive.
 *
 * Underlined rather than a filled segmented control. Reporting has tab sets
 * with five or six members and long labels ("Codes that matched no
 * registration"); a segmented control would either truncate them or wrap into
 * a shape that stops looking like one control.
 *
 * The list scrolls horizontally rather than wrapping, so the tab row stays one
 * row on a tablet held in portrait.
 */
export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'flex items-stretch gap-1 overflow-x-auto border-b border-line',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3.5',
        'font-ui text-base font-medium text-muted',
        'border-b-2 border-transparent -mb-px',
        'transition-colors duration-150',
        'hover:text-ink',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-inset',
        'data-[state=active]:border-interactive data-[state=active]:text-ink',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
        className,
      )}
      {...props}
    />
  )
}
