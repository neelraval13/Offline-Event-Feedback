import { useState, type FormEvent } from 'react'
import { BrandButton } from '../../../../components/brand/BrandButton'
import { BrandCard } from '../../../../components/brand/BrandCard'
import { BrandSectionHeading } from '../../../../components/brand/BrandSectionHeading'
import type { FlyingFleaFeedbackV1Answers, Rating1To7 } from '../../../../types'
import {
  EMPTY_CAMPAIGN_DRAFT,
  RATING_QUESTIONS,
  TEXT_QUESTIONS,
  validateCampaignFeedback,
  type CampaignFeedbackErrors,
  type FlyingFleaFeedbackDraft,
} from '../feedbackForm'
import { RatingQuestion } from './RatingQuestion'
import { TextQuestion } from './TextQuestion'

/*
 * The Flying Flea questionnaire at Point B.
 *
 * Six questions, in the campaign's own order and wording, rendered from
 * `config.ts` rather than typed out here — a question that exists in two places
 * is a question that will eventually disagree with itself, and the wording is
 * what an export has to quote back.
 *
 * Answered by a rider standing up, on someone else's tablet, having just handed
 * back a helmet. So the ratings are large tap targets and the text answers are
 * optional.
 */

interface CampaignFeedbackFormProps {
  readonly busy: boolean
  readonly onSubmit: (answers: FlyingFleaFeedbackV1Answers) => void
}

export function CampaignFeedbackForm({
  busy,
  onSubmit,
}: CampaignFeedbackFormProps) {
  const [draft, setDraft] = useState<FlyingFleaFeedbackDraft>(
    EMPTY_CAMPAIGN_DRAFT,
  )
  const [errors, setErrors] = useState<CampaignFeedbackErrors>({})

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) {
      return
    }

    const result = validateCampaignFeedback(draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    onSubmit(result.answers)
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <BrandCard labelledBy="ff-feedback-heading">
        <BrandSectionHeading
          id="ff-feedback-heading"
          step="Step 04"
          title="Feedback"
        />

        {RATING_QUESTIONS.map((question) => (
          <RatingQuestion
            key={question.key}
            prompt={question.prompt}
            value={draft[question.key]}
            error={errors[question.key]}
            disabled={busy}
            onChange={(rating: Rating1To7) =>
              setDraft((current) => ({ ...current, [question.key]: rating }))
            }
          />
        ))}

        {TEXT_QUESTIONS.map((question) => (
          <TextQuestion
            key={question.key}
            prompt={question.prompt}
            value={draft[question.key]}
            disabled={busy}
            onChange={(value: string) =>
              setDraft((current) => ({ ...current, [question.key]: value }))
            }
          />
        ))}
      </BrandCard>

      <BrandButton type="submit" block disabled={busy}>
        {busy ? 'Saving…' : 'Submit Feedback'}
      </BrandButton>
    </form>
  )
}
