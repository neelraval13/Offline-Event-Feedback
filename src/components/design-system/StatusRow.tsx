import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'
import { StatusPill } from './StatusPill'
import type { StatusKey } from './status'

/*
 * A state with its explanation, as a labelled row.
 *
 * The shape Device Admin and any other diagnostics surface should use. A pill
 * alone answers "what state is this in?"; an operator standing at a venue with
 * a device that says `Not ready` also needs "and what do I do about it?", and
 * that sentence has nowhere to live on a pill.
 *
 * `detail` is where the instruction goes, and it is deliberately prose rather
 * than another badge: the answer to a failed state is usually a sentence.
 */

interface StatusRowProps {
  /** What is being described. "Offline readiness", "Central sync". */
  readonly label: string
  readonly status: StatusKey
  /** Overrides the canonical status wording where a screen needs to be specific. */
  readonly value?: string
  /** What this means, or what to do about it. */
  readonly detail?: ReactNode
  readonly className?: string
}

export function StatusRow({
  label,
  status,
  value,
  detail,
  className,
}: StatusRowProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
        {detail !== undefined && (
          <span className="font-body text-small text-muted">{detail}</span>
        )}
      </div>
      <StatusPill status={status} {...(value === undefined ? {} : { label: value })} />
    </div>
  )
}
