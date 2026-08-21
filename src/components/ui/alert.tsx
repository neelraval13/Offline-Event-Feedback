import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The inline message primitive.
 *
 * Inline, never a toast. A toast that disappears after four seconds is the
 * wrong shape for this product: an operator who looks up at the moment a
 * record fails to save has no way to get the message back, and the message is
 * often the only thing standing between them and a lost response.
 *
 * The grid puts an icon in a fixed first column so a stack of alerts aligns
 * whether or not each one has an icon.
 */
const alertVariants = cva(
  cn(
    'relative grid w-full gap-x-3 gap-y-1 rounded-control border px-4 py-3',
    'grid-cols-[auto_1fr] items-start',
    'font-body text-base',
    "[&>svg]:size-5 [&>svg]:translate-y-0.5",
  ),
  {
    variants: {
      tone: {
        neutral: 'bg-surface text-ink border-line [&>svg]:text-muted',
        ok: 'bg-ok-soft text-ink border-ok-line [&>svg]:text-ok',
        busy: 'bg-busy-soft text-ink border-busy-line [&>svg]:text-busy',
        warn: 'bg-warn-soft text-ink border-warn-line [&>svg]:text-warn',
        danger: 'bg-danger-soft text-ink border-danger-line [&>svg]:text-danger',
        info: 'bg-info-soft text-ink border-info-line [&>svg]:text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>

export function Alert({ className, tone, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'col-start-2 font-ui text-base font-semibold text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 text-small text-muted [&_p]:leading-relaxed', className)}
      {...props}
    />
  )
}
