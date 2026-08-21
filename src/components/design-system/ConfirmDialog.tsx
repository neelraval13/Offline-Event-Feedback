import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AppButton } from './AppButton'

/*
 * The one place a modal is justified.
 *
 * A dialog stops an operator mid-queue, so it earns its place only when it is
 * protecting them from something they cannot undo: deleting local records,
 * discarding a capture, applying an update that reloads the terminal.
 * Everything that merely needs acknowledging is an inline `Alert`.
 *
 * The confirm button says what will happen, not "OK". A dialog whose buttons
 * are "OK" and "Cancel" makes an operator re-read the question to work out
 * which one does the thing; a button that says "Delete 214 records" does not.
 */

interface ConfirmDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  /** What will happen, and what cannot be undone. */
  readonly description: ReactNode
  /** Names the action: "Delete 214 records", not "OK". */
  readonly confirmLabel: string
  readonly cancelLabel?: string
  /** Marks the action irreversible, which most confirmations are. */
  readonly destructive?: boolean
  readonly busy?: boolean
  readonly onConfirm: () => void
  /** Extra context: a count, a list of what is about to go. */
  readonly children?: ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {children}

        <DialogFooter>
          {/* Cancel first in the DOM so it is the first tab stop, and the
              safe choice is the one a keyboard reaches without aiming. */}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <AppButton
            variant={destructive ? 'destructive' : 'default'}
            busy={busy}
            busyLabel="Working…"
            onClick={onConfirm}
          >
            {confirmLabel}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
