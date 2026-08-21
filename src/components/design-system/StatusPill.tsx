import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/ui/cn'
import { describeStatus, type StatusKey } from './status'

/*
 * One operational state, rendered.
 *
 * The only way a status should reach the screen. Everything about how a state
 * looks is decided in `status.ts` and applied here, so a state cannot be given
 * one treatment on Device Admin and a different one in Reporting, which is
 * precisely what happened before this existed.
 *
 * Three signals every time, in this order of reliability: an icon, a word, and
 * a colour. See the note in `status.ts` for why the colour is last.
 */

interface StatusPillProps {
  readonly status: StatusKey
  /**
   * Replaces the canonical label.
   *
   * For the rare case where a screen has genuinely more specific wording, such
   * as naming the count of records that are pending. The tone and the icon are
   * not overridable: those are what keep the vocabulary consistent.
   */
  readonly label?: string
  /** Hides the label, for a table cell too narrow to carry one. */
  readonly iconOnly?: boolean
  /**
   * A fuller explanation, for a pointer.
   *
   * Additional only. Tooltips do not appear on touch and are not read aloud
   * reliably, so nothing may live here that an operator needs.
   */
  readonly title?: string
  readonly className?: string
}

export function StatusPill({
  status,
  label,
  iconOnly = false,
  title,
  className,
}: StatusPillProps) {
  const descriptor = describeStatus(status)
  const Icon = descriptor.icon
  const text = label ?? descriptor.label

  return (
    <Badge
      tone={descriptor.tone}
      className={cn(iconOnly && 'px-1.5', className)}
      {...(title === undefined ? {} : { title })}
      /*
       * The label is announced even when it is visually hidden, so an icon-only
       * pill in a dense table is still a readable state to a screen reader
       * rather than an unlabelled decoration.
       */
      {...(iconOnly ? { 'aria-label': text } : {})}
    >
      <Icon
        aria-hidden="true"
        className={cn(descriptor.inProgress && 'animate-spin')}
      />
      {!iconOnly && <span>{text}</span>}
    </Badge>
  )
}
