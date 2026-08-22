import { useId } from 'react'
import type { Rating1To7 } from '../../../../types'
import { QuestionBand } from './QuestionBand'
import { SevenPointRating } from './SevenPointRating'

/*
 * One campaign rating question: the wording, the scale, and its error.
 *
 * The prompt carries an id so the scale can point at it with `aria-labelledby`:
 * the question a rider is answering has to be the question a screen reader
 * announces alongside the buttons. That is V1's arrangement and it is right.
 *
 * V2 renders it as an open band rather than a filled, bordered box. Six boxes
 * stacked down a phone is six containers to scroll past for four taps and two
 * optional sentences; a band is a numeral, the prompt, the control and a rule,
 * in roughly half the height, with the eye travelling down one column.
 */

interface RatingQuestionProps {
  /** Position in the campaign's own order. Presentation only. */
  readonly number: number
  readonly prompt: string
  readonly value: Rating1To7 | null
  readonly onChange: (rating: Rating1To7) => void
  readonly error?: string | undefined
  readonly disabled?: boolean
}

export function RatingQuestion({
  number,
  prompt,
  value,
  onChange,
  error,
  disabled = false,
}: RatingQuestionProps) {
  const promptId = useId()

  return (
    <QuestionBand
      number={number}
      prompt={prompt}
      promptId={promptId}
      /* A rating is required, so its prompt carries the reading weight. */
      tone="required"
    >
      <SevenPointRating
        value={value}
        onChange={onChange}
        labelledBy={promptId}
        disabled={disabled}
        invalid={error !== undefined}
      />

      {error !== undefined && (
        <p role="alert" className="pt-2 font-ui text-small font-medium text-danger">
          {error}
        </p>
      )}
    </QuestionBand>
  )
}
