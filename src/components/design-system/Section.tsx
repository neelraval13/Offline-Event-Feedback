import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * A titled block of content.
 *
 * The unit a screen is built from, and deliberately not a card. Wrapping every
 * group in a bordered surface is how a dark interface becomes cards inside
 * cards inside cards, at which point the borders stop meaning anything. A
 * section is a heading, an optional sentence, and its content; it borrows the
 * page's surface.
 *
 * Reach for `Card` instead when a group genuinely needs to read as a separate
 * object: something selectable, dismissable, or repeated in a grid.
 */

interface SectionProps {
  readonly title: ReactNode
  readonly description?: ReactNode
  /** Controls or filters belonging to this section, placed beside the title. */
  readonly action?: ReactNode
  readonly children: ReactNode
  readonly className?: string
  /** Set when the heading is announced elsewhere, to avoid announcing twice. */
  readonly headingId?: string
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  headingId,
}: SectionProps) {
  return (
    <section
      className={cn('flex flex-col gap-4', className)}
      {...(headingId === undefined ? {} : { 'aria-labelledby': headingId })}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            className="font-display text-title tracking-wide text-ink"
            {...(headingId === undefined ? {} : { id: headingId })}
          >
            {title}
          </h2>
          {description !== undefined && (
            <p className="max-w-measure font-body text-small text-muted">
              {description}
            </p>
          )}
        </div>
        {action !== undefined && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}
