import type { LucideIcon } from 'lucide-react'
import { InboxIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * Nothing here, and what to do about it.
 *
 * An empty table that just says "No results" leaves an operator unsure whether
 * they filtered everything out, whether the data has not synced, or whether
 * something is broken. Every empty state in this product says which of those
 * it is and offers the next action, because at an event the difference between
 * "no responses yet" and "reconciliation has not been run" is several minutes
 * of somebody's afternoon.
 *
 * The dashed box it used to draw around itself is now opt-in. Emptiness is
 * already conspicuous: a wide expanse of nothing with a sentence in the middle
 * of it reads as empty without being fenced off, and the fence was one more
 * bordered rectangle in a stack of them. `bordered` is for the case where the
 * empty region genuinely needs an edge to be legible, such as a drop target or
 * a column in a multi-pane layout.
 */

interface EmptyStateProps {
  readonly icon?: LucideIcon
  readonly title: ReactNode
  /** Why it is empty. Not a restatement of the title. */
  readonly description?: ReactNode
  /** The next useful thing to do, when there is one. */
  readonly action?: ReactNode
  /** Draws an edge, where the empty region needs one to be legible. */
  readonly bordered?: boolean
  readonly className?: string
}

export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  bordered = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 px-6 py-12 text-center',
        bordered === true && 'rounded-card border border-dashed border-line',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-7 text-faint" />
      <p className="font-ui text-lead font-semibold text-ink">{title}</p>
      {description !== undefined && (
        <p className="max-w-md font-body text-base text-muted">{description}</p>
      )}
      {action !== undefined && <div className="pt-1">{action}</div>}
    </div>
  )
}
