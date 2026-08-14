import { HeadlampMark } from '../../../../components/brand/marks/HeadlampMark'
import { RATINGS_1_TO_7, type Rating1To7 } from '../../../../types'

/*
 * The 1-7 rating scale, once.
 *
 * All four campaign rating questions use this component. Four separate
 * implementations would be four places for the scale to drift, and a rating
 * question that quietly offers six lamps is a question whose answers cannot be
 * compared with the others.
 *
 * The headlamps light cumulatively — tapping 5 lights 1 through 5 — which is the
 * supplied behaviour and the one riders expect from a rating.
 *
 * Accessibility is the reason this is a `radiogroup` of real buttons rather than
 * seven decorative SVGs: each option is individually labelled ("Rate 5 out of
 * 7"), reachable by keyboard, and reports its own selected state. The chosen
 * value is also printed as text beside the lamps, so the answer is never carried
 * by colour alone.
 */

interface SevenPointRatingProps {
  readonly value: Rating1To7 | null
  readonly onChange: (rating: Rating1To7) => void
  /** Id of the element labelling this scale — usually the question prompt. */
  readonly labelledBy: string
  readonly disabled?: boolean
}

export function SevenPointRating({
  value,
  onChange,
  labelledBy,
  disabled = false,
}: SevenPointRatingProps) {
  return (
    <div className="ff-rating" role="radiogroup" aria-labelledby={labelledBy}>
      {RATINGS_1_TO_7.map((rating) => {
        const lit = value !== null && rating <= value

        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={value === rating}
            aria-label={`Rate ${rating} out of 7`}
            className={`ff-rating__button${lit ? ' ff-rating__button--lit' : ''}`}
            disabled={disabled}
            onClick={() => onChange(rating)}
          >
            <HeadlampMark />
          </button>
        )
      })}

      <span className="ff-rating__value" aria-hidden="true">
        {value === null ? 'Not rated' : `${value} / 7`}
      </span>
    </div>
  )
}
