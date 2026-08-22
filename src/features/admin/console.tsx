import type { ReactNode } from 'react'
import { cn } from '../../lib/ui/cn'

/*
 * The console's two building blocks.
 *
 * Device Admin is a screen of facts, and V1 rendered every one of them the same
 * way: `<dl class="station-badge">` blocks of monospace label/value pairs, in
 * which "Ready for offline use" and a device UUID looked identical. Five of
 * those stacked is not a hierarchy, it is a list.
 *
 * A fact is a label on the left, a value on the right, and a rule above. A
 * section is a small uppercase heading with an optional note. Everything on the
 * screen is built from those two, which is what lets the *content* carry the
 * weight: a status pill, a figure at statistic size, or a quiet timestamp.
 */

interface FactRowProps {
  readonly label: string
  readonly children: ReactNode
  readonly className?: string
}

export function FactRow({ label, children, className }: FactRowProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-line py-3',
        className,
      )}
    >
      <span className="font-ui text-small font-medium text-muted">{label}</span>
      <span className="flex items-center gap-3 font-ui text-base text-ink">
        {children}
      </span>
    </div>
  )
}

interface SectionHeadProps {
  readonly title: string
  readonly note?: string
}

export function SectionHead({ title, note }: SectionHeadProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-1">
      <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-ink">
        {title}
      </span>
      {note !== undefined && (
        <span className="font-ui text-small text-faint">{note}</span>
      )}
    </div>
  )
}

/**
 * A count, at statistic weight.
 *
 * Zero is a good answer on this screen rather than an empty one, so it is set
 * in the ink colour and only rises to amber or red when the number itself is
 * the problem. No slashed zero: a lone `0` in that face reads as the empty-set
 * glyph, and `Errors 0` is the most common value here.
 */
export function Figure({
  value,
  tone = 'plain',
}: {
  readonly value: number
  readonly tone?: 'plain' | 'warn' | 'danger'
}) {
  return (
    <span
      className={cn(
        'font-ui text-stat font-semibold leading-none tabular-nums',
        tone === 'plain' && 'text-ink',
        tone === 'warn' && 'text-warn',
        tone === 'danger' && 'text-danger',
      )}
    >
      {value.toLocaleString()}
    </span>
  )
}

/** A timestamp an operator reads, or "Never". Never a raw ISO string. */
export function formatMoment(value: string | null | undefined): string {
  return value === null || value === undefined
    ? 'Never'
    : new Date(value).toLocaleString()
}
