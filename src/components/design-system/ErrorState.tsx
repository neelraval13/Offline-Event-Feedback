import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/ui/cn'

/*
 * Something failed, and what the operator can do next.
 *
 * Two rules, both learned from the existing screens, which already get this
 * right and which V2 must not regress:
 *
 *   - Say what is still true. "Feedback was not saved. The answers below are
 *     still here." The second sentence is the one that stops somebody walking
 *     away from a form they could still submit.
 *   - Offer the retry. An error with no way forward makes an operator reload
 *     the page, and on this product a reload during capture is how a response
 *     gets lost.
 *
 * Never a stack trace, never a raw exception message where a human sentence
 * would do.
 */

interface ErrorStateProps {
  readonly title?: ReactNode
  /** What happened, in plain words, and what is still safe. */
  readonly children: ReactNode
  readonly onRetry?: () => void
  readonly retryLabel?: string
  /** Set while a retry is in flight, so the button cannot be pressed twice. */
  readonly retrying?: boolean
  readonly className?: string
}

export function ErrorState({
  title = 'That did not work',
  children,
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <Alert tone="danger" className={cn(className)}>
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      {onRetry !== undefined && (
        <div className="col-start-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
            <RotateCcwIcon aria-hidden="true" />
            {retrying ? 'Retrying…' : retryLabel}
          </Button>
        </div>
      )}
    </Alert>
  )
}
