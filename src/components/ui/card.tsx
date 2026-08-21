import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The card primitive.
 *
 * A border and a surface step, and no shadow. On a near-black interface a drop
 * shadow is almost invisible and mostly adds noise; a one-pixel border reads
 * instantly and costs nothing. Shadows are reserved for the two things that
 * genuinely float above the page, popovers and dialogs.
 *
 * Cards do not nest. A card inside a card is the most common way a dark
 * interface turns into visual mush, so a card that needs internal structure
 * uses `Section` and separators rather than more cards.
 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col rounded-card border border-line bg-surface',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4',
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('font-display text-title tracking-wide text-ink', className)}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('font-body text-small text-muted', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('px-5 pb-5', className)} {...props} />
  )
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-line px-5 py-4',
        className,
      )}
      {...props}
    />
  )
}
