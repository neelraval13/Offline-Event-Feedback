import { useId } from 'react'
import {
  RATING_QUESTIONS,
  TEXT_QUESTIONS,
  type CampaignFeedbackErrors,
  type FlyingFleaFeedbackDraft,
} from '@/features/campaign/flying-flea/feedbackForm'
import { MAX_CAMPAIGN_TEXT_LENGTH, type Rating1To7 } from '@/types'
import { cn } from '@/lib/ui/cn'
import { RatingScale } from './RatingScale'

/*
 * The six questions, as open bands.
 *
 * ## One source of truth, still
 *
 * `RATING_QUESTIONS` and `TEXT_QUESTIONS` are read from the campaign, exactly as
 * `CampaignFeedbackFields` reads them. Nothing here retypes a prompt, reorders
 * the questions, or invents a seventh. A question that exists in two places is a
 * question that will eventually disagree with itself, and the disagreement is
 * invisible: one rider would be shown a subtly different wording from the rider
 * before them, and both answers stored under one form version claiming they were
 * asked the same thing.
 *
 * The numbering is presentation. It comes from the position in the campaign's
 * own arrays, so adding a question renumbers the list rather than stranding it.
 *
 * ## Why bands and not cards
 *
 * V1 renders each question inside a filled, bordered `.ff-question` box, six of
 * them stacked. On a phone that is six boxes to scroll past for four taps and
 * two optional sentences. A band is a numeral, the prompt, the control, and a
 * rule: the same information, roughly half the height, and the eye travels down
 * one column instead of in and out of six containers.
 *
 * ## The optional half is visibly optional
 *
 * The two free-text questions come after the four ratings, carry an "Optional"
 * tag, and sit under a quieter heading. A rider who has answered the required
 * part can see they are finished without reading two prompts to find out.
 * Nothing is truncated: the prompt is rendered exactly as the campaign asks it.
 *
 * Controlled, with no state of its own. The owning form holds the draft, because
 * the owning form is what has to survive a failed save with every answer intact.
 */

interface QuestionnaireFieldsProps {
  readonly draft: FlyingFleaFeedbackDraft
  readonly errors: CampaignFeedbackErrors
  readonly disabled: boolean
  readonly onChange: (patch: Partial<FlyingFleaFeedbackDraft>) => void
  /** Where the numbering starts. The contact path counts from its own step. */
  readonly startAt?: number
}

export function QuestionnaireFields({
  draft,
  errors,
  disabled,
  onChange,
  startAt = 1,
}: QuestionnaireFieldsProps) {
  return (
    <div className="flex flex-col">
      {RATING_QUESTIONS.map((question, index) => (
        <RatingBand
          key={question.key}
          number={startAt + index}
          prompt={question.prompt}
          value={draft[question.key]}
          error={errors[question.key]}
          disabled={disabled}
          onChange={(rating) => onChange({ [question.key]: rating })}
        />
      ))}

      <p className="border-t border-line pt-5 pb-1 font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
        In your own words
        <span className="ml-2 font-normal normal-case tracking-normal text-faint">
          Optional
        </span>
      </p>

      {TEXT_QUESTIONS.map((question, index) => (
        <TextBand
          key={question.key}
          number={startAt + RATING_QUESTIONS.length + index}
          prompt={question.prompt}
          value={draft[question.key]}
          disabled={disabled}
          onChange={(value) => onChange({ [question.key]: value })}
        />
      ))}
    </div>
  )
}

/** The numeral. Lime, because it is the one ornament a question band gets. */
function BandNumber({ number }: { readonly number: number }) {
  return (
    <span
      aria-hidden="true"
      className="font-display text-lead leading-none tracking-wide text-accent tabular-nums"
    >
      {String(number).padStart(2, '0')}
    </span>
  )
}

interface RatingBandProps {
  readonly number: number
  readonly prompt: string
  readonly value: Rating1To7 | null
  readonly error?: string | undefined
  readonly disabled: boolean
  readonly onChange: (rating: Rating1To7) => void
}

function RatingBand({
  number,
  prompt,
  value,
  error,
  disabled,
  onChange,
}: RatingBandProps) {
  const promptId = useId()

  return (
    <div className="flex flex-col gap-3 border-t border-line py-5">
      <div className="flex items-baseline gap-3">
        <BandNumber number={number} />
        {/*
          The prompt carries the id the scale points at, so the question a rider
          is answering is the question a screen reader announces with the
          buttons. Preserved from V1's `RatingQuestion`.
        */}
        <p id={promptId} className="min-w-0 font-body text-lead text-ink">
          {prompt}
        </p>
      </div>

      <div className="sm:pl-9">
        <RatingScale
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
      </div>
    </div>
  )
}

interface TextBandProps {
  readonly number: number
  readonly prompt: string
  readonly value: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}

function TextBand({ number, prompt, value, disabled, onChange }: TextBandProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-3 border-t border-line py-5">
      <div className="flex items-baseline gap-3">
        <BandNumber number={number} />
        <label htmlFor={id} className="min-w-0 font-body text-lead text-muted">
          {prompt}
        </label>
      </div>

      <div className="sm:pl-9">
        <textarea
          id={id}
          rows={3}
          maxLength={MAX_CAMPAIGN_TEXT_LENGTH}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'w-full rounded-control border border-line bg-field px-3.5 py-2.5',
            'font-body text-base text-ink',
            'transition-[border-color,box-shadow] duration-150',
            'placeholder:text-faint hover:border-line-strong',
            'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      </div>
    </div>
  )
}
