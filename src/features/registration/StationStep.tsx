import type { ReactNode } from 'react'
import { cn } from '../../lib/ui/cn'

/*
 * One step of the registration, as a band rather than a card.
 *
 * V1's form was three `BrandCard`s: three bordered, filled, 22px-cornered
 * surfaces stacked down the page, each with a "Step 01" heading inside it. That
 * reads as three separate things an operator has to deal with, when it is one
 * form with three parts, and the borders were doing no work: nothing sits
 * beside a step that it needs to be told apart from.
 *
 * A step is therefore a rule, a numeral and a title. The numeral is the only
 * ornament and it is the campaign's lime, the one thing on this screen allowed
 * to be brand rather than function. This is Phase 1's open-layout rule applied
 * to the screen that needed it most: the same three steps in roughly half the
 * height, with the borders spent on the two controls that genuinely group, a
 * vehicle plate and a colour swatch.
 *
 * The heading is a real `h2` and the step number is part of its accessible
 * name, so the document outline reads "Step 01: Vehicle" rather than three
 * unnumbered headings. `headingId` exists so a containing region can be
 * labelled by the step without announcing it twice.
 */

interface StationStepProps {
  /** "01", "02", "03". Shown, and also spoken as part of the heading. */
  readonly step: string
  readonly title: string
  /** A short qualifier beside the title. Never a sentence. */
  readonly note?: string
  readonly headingId?: string
  readonly children: ReactNode
  readonly className?: string
}

export function StationStep({
  step,
  title,
  note,
  headingId,
  children,
  className,
}: StationStepProps) {
  return (
    <section className={cn('flex flex-col gap-3.5', className)}>
      <div className="flex items-baseline gap-3 border-b border-line pb-2">
        <span
          aria-hidden="true"
          className="font-display text-lead leading-none tracking-wide text-accent tabular-nums"
        >
          {step}
        </span>
        <h2
          className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-ink"
          {...(headingId === undefined ? {} : { id: headingId })}
        >
          <span className="sr-only">{`Step ${step}: `}</span>
          {title}
        </h2>
        {note !== undefined && (
          <span className="ml-auto font-ui text-caption text-faint">{note}</span>
        )}
      </div>

      {children}
    </section>
  )
}
