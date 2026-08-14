import { useId } from 'react'
import type { Rating1To7 } from '../../../../types'
import { SevenPointRating } from './SevenPointRating'

/*
 * One campaign rating question: the wording, the scale, and its error.
 *
 * The prompt carries an id so the scale can point at it with `aria-labelledby` —
 * the question a rider is answering has to be the question a screen reader
 * announces alongside the lamps.
 */

interface RatingQuestionProps {
  readonly prompt: string
  readonly value: Rating1To7 | null
  readonly onChange: (rating: Rating1To7) => void
  readonly error?: string | undefined
  readonly disabled?: boolean
}

export function RatingQuestion({
  prompt,
  value,
  onChange,
  error,
  disabled = false,
}: RatingQuestionProps) {
  const promptId = useId()

  return (
    <div className="ff-question">
      <p className="ff-question__prompt" id={promptId}>
        {prompt}
      </p>
      <SevenPointRating
        value={value}
        onChange={onChange}
        labelledBy={promptId}
        disabled={disabled}
      />
      {error !== undefined && (
        <p className="ff-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
