import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/ui/cn'

/*
 * Content on its way.
 *
 * Shaped like what is coming, so the layout does not jump when it arrives and
 * the operator can already see how much of it there will be. A centred spinner
 * would be less code and would communicate nothing beyond "wait".
 *
 * `aria-busy` and a live region carry the same information to a screen reader,
 * which cannot see a skeleton at all.
 */

interface LoadingStateProps {
  /** What is loading. Announced, and shown to sighted users as quiet text. */
  readonly label?: string
  /** Roughly how many rows to expect. */
  readonly rows?: number
  readonly className?: string
}

export function LoadingState({
  label = 'Loading',
  rows = 3,
  className,
}: LoadingStateProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn('flex flex-col gap-3', className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className="h-11 w-full"
          /* Slight stagger, so the block reads as several items rather than
             one large shape pulsing in unison. */
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </div>
  )
}
