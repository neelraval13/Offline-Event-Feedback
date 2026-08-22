import { RATINGS_1_TO_7, type Rating1To7 } from '../../../../types'
import { cn } from '../../../../lib/ui/cn'

/*
 * The 1 to 7 rating scale, once.
 *
 * All four campaign rating questions use this component. Four separate
 * implementations would be four places for the scale to drift, and a rating
 * question that quietly offers six options is a question whose answers cannot
 * be compared with the others.
 *
 * ## What V2 changed, and why
 *
 * V1 rendered seven headlamp SVGs that lit **cumulatively**: tapping 5 lit
 * lamps 1 through 5. That is the supplied campaign behaviour and it reads well
 * as a picture of "how much", but it had two costs on a rider-facing tablet.
 * The answer was never shown, so a rider looking at five lit lamps had to count
 * them to know what they had chosen. And with a cumulative fill there is no
 * single element that means "this is my answer": the selection is carried by
 * the boundary between lit and unlit, which is the hardest thing on the control
 * to see.
 *
 * V2 shows the numerals, because the numerals are the answer: 1 to 7 is what is
 * stored, exported, and averaged. The chosen one is filled with a ring and a
 * weight change; the ones below it carry a quiet trail, so the "how much"
 * reading the lamps gave survives without five things appearing selected.
 *
 * ## Selected state, four ways over
 *
 * Fill, ring, font weight, and the `n / 7` readout printed beside the scale. A
 * rider with a colour vision deficiency reading a glossy tablet in daylight has
 * the numeral, the ring and the printed value; colour is the last of four
 * signals rather than the only one.
 *
 * ## Structure, unchanged from V1
 *
 * A `radiogroup` of real buttons, each labelled "Rate n out of 7", keyboard
 * reachable, each reporting `aria-checked`. Seven equal columns rather than a
 * flex row, so the buttons are the same width at every viewport and the row
 * never becomes six-and-a-bit. At 440px each column is about 52px, above the
 * touch floor, so the scale still fits one line on a phone.
 */

interface SevenPointRatingProps {
  readonly value: Rating1To7 | null
  readonly onChange: (rating: Rating1To7) => void
  /** Id of the element labelling this scale: usually the question prompt. */
  readonly labelledBy: string
  readonly disabled?: boolean
  /** Marks the scale when the question was left unanswered on submit. */
  readonly invalid?: boolean
}

export function SevenPointRating({
  value,
  onChange,
  labelledBy,
  disabled = false,
  invalid = false,
}: SevenPointRatingProps) {
  return (
    <div className="flex flex-col gap-2">
      <div
        data-slot="rating-scale"
        role="radiogroup"
        aria-labelledby={labelledBy}
        className="grid max-w-md grid-cols-7 gap-1.5 sm:gap-2"
      >
        {RATINGS_1_TO_7.map((rating) => {
          const chosen = value === rating
          /* The trail: below the answer, not part of it. */
          const under = value !== null && rating < value

          return (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={`Rate ${rating} out of 7`}
              disabled={disabled}
              onClick={() => onChange(rating)}
              className={cn(
                'flex min-h-12 items-center justify-center rounded-control border',
                'font-ui text-lead tabular-nums transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                'disabled:cursor-not-allowed disabled:opacity-45',
                chosen &&
                  'border-interactive bg-interactive font-semibold text-on-interactive ring-2 ring-interactive/40',
                !chosen &&
                  under &&
                  'border-interactive-line bg-interactive-soft text-ink',
                !chosen &&
                  !under &&
                  'border-line bg-surface text-muted hover:border-line-strong hover:bg-raised hover:text-ink',
                invalid && value === null && 'border-danger-line',
              )}
            >
              {rating}
            </button>
          )
        })}
      </div>

      {/*
        The answer, in words. V1 printed this too, and it is the reason the
        scale never depends on colour: whatever the fills are doing, the chosen
        number is written down.
      */}
      <p
        className={cn(
          'font-ui text-small tabular-nums',
          value === null ? 'text-faint' : 'text-muted',
        )}
      >
        {value === null ? 'Not rated' : `${value} / 7`}
      </p>
    </div>
  )
}
