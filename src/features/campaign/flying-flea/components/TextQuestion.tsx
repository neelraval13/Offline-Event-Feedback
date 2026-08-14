import { useId } from 'react'
import { MAX_CAMPAIGN_TEXT_LENGTH } from '../../../../types'

/*
 * One campaign free-text question.
 *
 * The wording is rendered exactly as the campaign asks it; this component
 * never abbreviates a prompt to fit a layout. The character limit is a storage
 * bound rather than part of the question, so it is shown as a quiet hint and
 * enforced by `maxLength`, not by refusing a submission.
 */

interface TextQuestionProps {
  readonly prompt: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

export function TextQuestion({
  prompt,
  value,
  onChange,
  disabled = false,
}: TextQuestionProps) {
  const id = useId()

  return (
    <div className="ff-question">
      <label className="ff-question__prompt" htmlFor={id}>
        {prompt}
      </label>
      <textarea
        id={id}
        className="ff-field__control"
        rows={3}
        maxLength={MAX_CAMPAIGN_TEXT_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
