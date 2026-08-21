import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The button primitive.
 *
 * shadcn's Button, with the variants and sizes this product actually has. Two
 * departures from the stock component, both because of where this runs:
 *
 *   - `size` starts at the 44px touch target rather than at 36px. Operators
 *     work these screens standing up, on tablets, with gloves in the rain, for
 *     several hundred participants. A comfortable default costs a desktop
 *     nothing and a `sm` exists for genuinely dense contexts.
 *   - `destructive` is visually distinct from `default` in shape as well as
 *     colour: it carries a border where the primary button carries a fill, so
 *     "delete everything" and "save" never look like near neighbours.
 *
 * Application code should reach for `AppButton` instead. This is the
 * primitive it is built from.
 */
const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    'font-ui font-semibold rounded-control',
    'transition-[background-color,border-color,color,opacity] duration-150',
    'outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
    'disabled:pointer-events-none disabled:opacity-45',
    // Icons inside a label should never be tab stops or grow with the text.
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        /* The one obvious action on a screen. At most one. */
        default:
          'bg-interactive text-on-interactive hover:bg-interactive/90 active:bg-interactive/80',
        /* Everything else that is safe to press. */
        secondary:
          'bg-surface text-ink border border-line hover:bg-raised hover:border-line-strong',
        /* Irreversible. Bordered rather than filled: see the note above. */
        destructive:
          'bg-danger-soft text-danger border border-danger-line hover:bg-danger/20 hover:border-danger',
        /* Tertiary: present, but not competing for attention. */
        ghost: 'text-muted hover:bg-surface hover:text-ink',
        link: 'text-interactive underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        /* The default. A finger-sized target. */
        default: 'min-h-touch px-5 text-base',
        sm: 'min-h-9 px-3 text-small',
        lg: 'min-h-12 px-7 text-lead',
        /* Square, for a lone icon. Still 44px. */
        icon: 'size-touch p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render as the child element, so a link can look like a button. */
    readonly asChild?: boolean
  }

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button'

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { buttonVariants }
