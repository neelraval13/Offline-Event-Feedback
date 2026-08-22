import { RATINGS_1_TO_7, type Rating1To7 } from '@/types'
import { cn } from '@/lib/ui/cn'

/*
 * The 1 to 7 scale, redesigned for V2.
 *
 * ## What V1 does, and why it changes
 *
 * V1 renders seven headlamp SVGs that light **cumulatively**: tapping 5 lights
 * lamps 1 through 5. That is the supplied campaign behaviour and it reads well
 * as a picture of "how much", but it has two costs on a rider-facing tablet.
 * The answer is not shown: a rider looking at five lit lamps has to count them
 * to know what they chose, and a rider who meant 6 and hit 5 sees a difference
 * of one lamp in seven. And with a cumulative fill there is no single element
 * that means "this is my answer", so the selected state has nothing to attach
 * to but the boundary between lit and unlit.
 *
 * V2 shows the numerals, because the numerals are the answer. §16 is explicit
 * about that: 1 to 7 is what is stored, what is exported and what an analyst
 * averages. The chosen one is filled; the ones below it carry a quiet trail, so
 * the "how much" reading the lamps gave is kept without pretending five things
 * are selected.
 *
 * ## Selected state, three ways over
 *
 * Fill, a ring, and a weight change, plus the `n / 7` readout in text beside
 * the scale. A rider with a colour vision deficiency reading a glossy tablet in
 * daylight has the numeral itself, the ring and the printed value; the colour is
 * the last of four signals rather than the only one.
 *
 * ## Structure
 *
 * A `radiogroup` of real buttons, labelled `Rate n out of 7`, keyboard
 * reachable, each reporting `aria-checked`. That is V1's structure exactly and
 * it is the right one; only the paint changed.
 *
 * Seven equal columns rather than a flex row, so the buttons are the same width
 * at every viewport and the row never becomes six-and-a-bit. At 440px each
 * column is about 48px, above the touch floor, so the scale still fits one line
 * on a phone without shrinking to the point of mis-taps.
 */

interface RatingScaleProps {
  readonly value: Rating1To7 | null
  readonly onChange: (rating: Rating1To7) => void
  /** Id of the element labelling this scale: the question prompt. */
  readonly labelledBy: string
  readonly disabled?: boolean
  readonly invalid?: boolean
}

export function RatingScale({
  value,
  onChange,
  labelledBy,
  disabled = false,
  invalid = false,
}: RatingScaleProps) {
  return (
    <div className="flex flex-col gap-2">
      <div
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
        The answer, in words. V1 printed this too and it is the reason the scale
        never depends on colour: whatever the lamps or the fills are doing, the
        chosen number is written down.
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
