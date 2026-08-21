import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The loading placeholder.
 *
 * Shaped like the content it stands in for, so the layout does not jump when
 * the real thing arrives. A spinner would be less work and would tell the
 * operator less: a skeleton says "four rows are coming", a spinner says
 * "something is happening".
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-chip bg-raised', className)}
      {...props}
    />
  )
}
