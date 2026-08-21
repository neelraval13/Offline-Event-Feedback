import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The top of a screen.
 *
 * Title, context, status, action, in that reading order and always in the same
 * place. An operator arriving at a screen should learn what it is, whether
 * anything is wrong, and what the one obvious thing to do is, without moving
 * their eyes around looking for it.
 *
 * `action` is singular on purpose. A screen with four equally weighted buttons
 * at the top has no primary action, and this product is used by people who are
 * mid-task and need one obvious next step. Secondary actions belong beside the
 * content they act on.
 */

interface PageHeaderProps {
  /** A short line above the title: which station, which part of the product. */
  readonly eyebrow?: string
  readonly title: ReactNode
  /** One or two sentences. What this screen is for, in plain words. */
  readonly description?: ReactNode
  /** Status pills. Read before the description, so keep them to a few. */
  readonly status?: ReactNode
  /** The one obvious action. */
  readonly action?: ReactNode
  readonly className?: string
}

export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  action,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 pb-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          {eyebrow !== undefined && (
            <span className="font-ui text-label font-semibold uppercase tracking-[0.14em] text-accent">
              {eyebrow}
            </span>
          )}
          <h1 className="font-display text-page leading-tight tracking-wide text-ink">
            {title}
          </h1>
          {description !== undefined && (
            <p className="max-w-measure font-body text-lead text-muted">
              {description}
            </p>
          )}
        </div>

        {action !== undefined && <div className="shrink-0">{action}</div>}
      </div>

      {status !== undefined && (
        <div className="flex flex-wrap items-center gap-2">{status}</div>
      )}
    </header>
  )
}
