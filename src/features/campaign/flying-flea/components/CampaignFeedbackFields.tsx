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
 * Extracted from `CampaignFeedbackForm` when Point B gained a second way in.
 * The contact-details path asks the rider for their name, phone and email and
 * then asks exactly these six questions, in one form with one submit button, so
 * it cannot nest the other form's `<form>` element.
 *
 * The alternative was to type the questionnaire out a second time, which is the
 * thing this campaign has been careful to avoid everywhere else: a question
 * that exists in two places is a question that will eventually disagree with
 * itself, and the disagreement is invisible. A rider on the contact path would
 * have been shown a subtly different wording from the rider before them, and
 * both answers would be stored under one form version claiming they were asked
 * the same thing.
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
    <>
      {RATING_QUESTIONS.map((question) => (
        <RatingQuestion
          key={question.key}
          prompt={question.prompt}
          value={draft[question.key]}
          error={errors[question.key]}
          disabled={disabled}
          onChange={(rating: Rating1To7) =>
            onChange({ [question.key]: rating })
          }
        />
      ))}

      {TEXT_QUESTIONS.map((question) => (
        <TextQuestion
          key={question.key}
          prompt={question.prompt}
          value={draft[question.key]}
          disabled={disabled}
          onChange={(value: string) => onChange({ [question.key]: value })}
        />
      ))}
    </>
  )
}
