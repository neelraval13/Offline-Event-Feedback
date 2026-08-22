import { useId } from 'react'
import { MAX_CAMPAIGN_TEXT_LENGTH } from '../../../../types'
import { cn } from '../../../../lib/ui/cn'
import { CONTROL_TEXT } from '../../../../lib/ui/controlText'
import { QuestionBand } from './QuestionBand'

/*
 * One campaign free-text question.
 *
 * The wording is rendered exactly as the campaign asks it; this component never
 * abbreviates a prompt to fit a layout. The character limit is a storage bound
 * rather than part of the question, so it is enforced by `maxLength` and not by
 * refusing a submission. `MAX_CAMPAIGN_TEXT_LENGTH` is unchanged.
 *
 * Optional, and visibly so: the prompt sits a step quieter than a rating's, and
 * these two bands come after the four ratings under a divider that says
 * "Optional" once for both. A rider who has answered the required part can see
 * they have finished without reading two more prompts to find out.
 */

interface TextQuestionProps {
  /** Position in the campaign's own order. Presentation only. */
  readonly number: number
  readonly prompt: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

export function TextQuestion({
  number,
  prompt,
  value,
  onChange,
  disabled = false,
}: TextQuestionProps) {
  const id = useId()

  return (
    <QuestionBand number={number} prompt={prompt} htmlFor={id} tone="optional">
      <textarea
        id={id}
        rows={3}
        maxLength={MAX_CAMPAIGN_TEXT_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full rounded-control border border-line bg-field px-3.5 py-2.5',
          'font-body text-ink',
          CONTROL_TEXT,
          'transition-[border-color,box-shadow] duration-150',
          'placeholder:text-faint hover:border-line-strong',
          'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
    </QuestionBand>
  )
}
