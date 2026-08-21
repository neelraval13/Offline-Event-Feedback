import { LoaderCircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/ui/cn'

/*
 * The button application code uses.
 *
 * A thin layer over the primitive that adds the one thing this product needs
 * everywhere and shadcn's Button does not have: a busy state that is a
 * property of the button rather than something each caller reimplements.
 *
 * Before V2 every screen did this by hand, as `{busy ? 'Saving…' : 'Save'}`
 * plus a `disabled` prop, in about a dozen places. That works until one of
 * them forgets the `disabled`, and then a double tap at a registration desk
 * writes two records. Here the two cannot come apart: `busy` disables.
 */

type AppButtonProps = Omit<ButtonProps, 'children'> & {
  readonly children: ReactNode
  /** An action is in flight. Disables the button and shows a spinner. */
  readonly busy?: boolean
  /** Replaces the label while busy. "Saving…", "Reconciling…". */
  readonly busyLabel?: string
  /** Fills the width. The right default inside a form on a narrow screen. */
  readonly block?: boolean
}

export function AppButton({
  children,
  busy = false,
  busyLabel,
  block = false,
  disabled,
  className,
  ...props
}: AppButtonProps) {
  return (
    <Button
      /*
       * Busy implies disabled, and always. This is the whole reason the
       * component exists: it makes the double-tap guard impossible to forget.
       */
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      className={cn(block && 'w-full', className)}
      {...props}
    >
      {busy && <LoaderCircleIcon aria-hidden="true" className="animate-spin" />}
      {busy && busyLabel !== undefined ? busyLabel : children}
    </Button>
  )
}
