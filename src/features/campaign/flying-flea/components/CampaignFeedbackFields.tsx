import type { Rating1To7 } from '../../../../types'
import {
  RATING_QUESTIONS,
  TEXT_QUESTIONS,
  type CampaignFeedbackErrors,
  type FlyingFleaFeedbackDraft,
} from '../feedbackForm'
import { RatingQuestion } from './RatingQuestion'
import { TextQuestion } from './TextQuestion'

/*
 * The six questions, as controls.
 *
 * Both Point B paths render this, and that is the whole reason it exists. The
 * contact-details path asks a rider for their name, phone and email and then
 * asks exactly these six questions, in one form with one submit button, so it
 * cannot nest the other form's `<form>` element.
 *
 * The alternative was to type the questionnaire out a second time, which is the
 * thing this campaign has been careful to avoid everywhere else: a question
 * that exists in two places is a question that will eventually disagree with
 * itself, and the disagreement is invisible. A rider on the contact path would
 * have been shown a subtly different wording from the rider before them, and
 * both answers would be stored under one form version claiming they were asked
 * the same thing.
 *
 * `RATING_QUESTIONS` and `TEXT_QUESTIONS` are read from the campaign. Nothing
 * here retypes a prompt, reorders the questions, or invents a seventh, and a
 * test fails if any prompt string appears literally in this directory.
 *
 * ## The optional half is visibly optional
 *
 * V1 rendered all six alike, so a rider met two free-text boxes with no signal
 * that they could stop. The divider says it once, for both, and the two prompts
 * below it are rendered a step quieter. Nothing says "required" on the four
 * above, because three quarters of the questions are and a badge on each would
 * be noise.
 *
 * Controlled, with no state of its own. The owning form holds the draft,
 * because the owning form is what has to survive a failed save with every
 * answer intact.
 */

interface CampaignFeedbackFieldsProps {
  readonly draft: FlyingFleaFeedbackDraft
  readonly errors: CampaignFeedbackErrors
  readonly disabled: boolean
  readonly onChange: (patch: Partial<FlyingFleaFeedbackDraft>) => void
}

export function CampaignFeedbackFields({
  draft,
  errors,
  disabled,
  onChange,
}: CampaignFeedbackFieldsProps) {
  return (
    <div className="flex flex-col">
      {RATING_QUESTIONS.map((question, index) => (
        <RatingQuestion
          key={question.key}
          number={index + 1}
          prompt={question.prompt}
          value={draft[question.key]}
          error={errors[question.key]}
          disabled={disabled}
          onChange={(rating: Rating1To7) => onChange({ [question.key]: rating })}
        />
      ))}

      <p className="border-t border-line pt-5 pb-1 font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
        In your own words
        <span className="ml-2 font-normal normal-case tracking-normal text-faint">
          Optional
        </span>
      </p>

      {TEXT_QUESTIONS.map((question, index) => (
        <TextQuestion
          key={question.key}
          number={RATING_QUESTIONS.length + index + 1}
          prompt={question.prompt}
          value={draft[question.key]}
          disabled={disabled}
          onChange={(value: string) => onChange({ [question.key]: value })}
        />
      ))}
    </div>
  )
}
