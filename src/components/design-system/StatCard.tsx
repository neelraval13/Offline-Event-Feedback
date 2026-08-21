import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * One number, with what it counts.
 *
 * Reporting and Admin are full of figures that currently read as body text in
 * a definition list, which makes "12 of 14 responded" and a device UUID look
 * like the same kind of fact. A statistic is a different kind of fact and gets
 * a different treatment: large, tabular, and captioned.
 *
 * Tabular figures with a slashed zero, always. A count that ticks up while an
 * operator watches it must not change width as it does, and a code containing
 * a zero must not be readable as an O.
 *
 * ## Open by default
 *
 * A row of these used to be a row of bordered, filled tiles, and four of them
 * above a bordered table inside a bordered section is how a dark interface
 * turns into boxes in boxes. The default is now a rule and a figure, the way a
 * specification sheet lists a value: the numbers separate themselves, because
 * they are the largest thing on the row.
 *
 * `variant="card"` is still there for the case that earns it, which is a tile
 * that is genuinely a discrete object: selectable, dismissable, or sitting in a
 * grid of unlike things.
 */

type StatVariant = 'plain' | 'card'

const STAT_VARIANTS: Readonly<Record<StatVariant, string>> = {
  plain: 'border-t border-line pt-3',
  card: 'rounded-card border border-line bg-surface p-4',
}

interface StatCardProps {
  readonly label: ReactNode
  readonly value: ReactNode
  /** Units, a denominator, or a qualifier. "of 14", "out of 7". */
  readonly unit?: ReactNode
  /** One line under the figure. What it means or what it excludes. */
  readonly caption?: ReactNode
  readonly icon?: LucideIcon
  /** A status pill, where the figure has a state. */
  readonly status?: ReactNode
  /** `card` only where the tile is genuinely a discrete object. */
  readonly variant?: StatVariant
  readonly className?: string
}

export function StatCard({
  label,
  value,
  unit,
  caption,
  icon: Icon,
  status,
  variant = 'plain',
  className,
}: StatCardProps) {
  return (
    <div className={cn('flex flex-col gap-2', STAT_VARIANTS[variant], className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
        {Icon !== undefined && (
          <Icon aria-hidden="true" className="size-4 shrink-0 text-faint" />
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-ui text-stat font-semibold leading-none tabular-nums text-ink [font-feature-settings:'zero'_1]">
          {value}
        </span>
        {unit !== undefined && (
          <span className="font-ui text-small text-muted">{unit}</span>
        )}
      </div>

      {caption !== undefined && (
        <p className="font-body text-small text-faint">{caption}</p>
      )}
      {status !== undefined && <div className="pt-0.5">{status}</div>}
    </div>
  )
}
