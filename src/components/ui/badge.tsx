import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The badge primitive.
 *
 * The variants are the status family from the theme, one each, because a badge
 * in this product almost always means a state. `StatusPill` is the component
 * application code should use: it pairs one of these with a mandatory icon and
 * word so the meaning never rests on colour alone.
 */
const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap',
    'rounded-chip border px-2 py-0.5',
    'font-ui text-label font-semibold uppercase tracking-[0.07em]',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
  ),
  {
    variants: {
      tone: {
        neutral: 'bg-idle-soft text-muted border-idle-line',
        ok: 'bg-ok-soft text-ok border-ok-line',
        busy: 'bg-busy-soft text-busy border-busy-line',
        warn: 'bg-warn-soft text-warn border-warn-line',
        danger: 'bg-danger-soft text-danger border-danger-line',
        info: 'bg-info-soft text-info border-info-line',
        /* Brand, for a campaign moment. Never for a state. */
        accent: 'bg-transparent text-accent border-accent/40',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    readonly asChild?: boolean
  }

export function Badge({ className, tone, asChild = false, ...props }: BadgeProps) {
  const Component = asChild ? Slot : 'span'

  return (
    <Component
      data-slot="badge"
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  )
}

export { badgeVariants }
