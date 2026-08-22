import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The side panel primitive.
 *
 * Radix's Dialog, anchored to an edge. This is the right shape for reporting's
 * record detail: an operator opens a participant, reads it against the list
 * still visible beside them, and closes it. A centred modal would hide the row
 * they are checking it against.
 *
 * Also the shell's navigation on a narrow viewport.
 */
export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close

type SheetSide = 'top' | 'right' | 'bottom' | 'left'

const SIDE_CLASSES: Readonly<Record<SheetSide, string>> = {
  right:
    'inset-y-0 right-0 h-full w-full max-w-md border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  left: 'inset-y-0 left-0 h-full w-full max-w-xs border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
  top: 'inset-x-0 top-0 h-auto border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
  bottom:
    'inset-x-0 bottom-0 h-auto border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
}

export type SheetContentProps = ComponentProps<typeof SheetPrimitive.Content> & {
  readonly side?: SheetSide
  /**
   * Set false while an operation the sheet started is still running.
   *
   * Radix dismisses on Escape, on a click outside, and on the close control.
   * For a sheet that is only collecting input that is exactly right. For one
   * that is midway through encrypting a backup or merging a restore it is a
   * lie: the work carries on regardless, and a sheet that vanished when the
   * operator pressed Escape would have told them it stopped.
   *
   * So this closes all three routes at once rather than leaving the close
   * button live while the other two are blocked, which would be the same lie
   * with an extra step. Normal dismissal returns the moment the work finishes.
   */
  readonly dismissible?: boolean
}

export function SheetContent({
  className,
  children,
  side = 'right',
  dismissible = true,
  ...props
}: SheetContentProps) {
  /*
   * Spread after `props` at the call site below, not before: this is a safety
   * guarantee rather than a default, and a caller passing its own dismissal
   * handler must not be able to reopen a route out of a running operation.
   */
  const block = dismissible
    ? {}
    : {
        onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
        onPointerDownOutside: (event: Event) => event.preventDefault(),
        onInteractOutside: (event: Event) => event.preventDefault(),
      }

  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        )}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'v2 fixed z-50 flex flex-col gap-5 overflow-y-auto bg-raised p-5',
          'border-line-strong font-ui text-base text-ink shadow-dialog',
          'data-[state=open]:animate-in data-[state=closed]:animate-out duration-200',
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
        {...block}
      >
        {children}
        <SheetPrimitive.Close
          disabled={!dismissible}
          className={cn(
            'absolute top-4 right-4 inline-flex size-touch items-center justify-center',
            'rounded-control text-muted transition-colors',
            'hover:bg-surface hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <XIcon className="size-5" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 pr-10', className)}
      {...props}
    />
  )
}

export function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-display text-title tracking-wide text-ink', className)}
      {...props}
    />
  )
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('font-body text-small text-muted', className)}
      {...props}
    />
  )
}
