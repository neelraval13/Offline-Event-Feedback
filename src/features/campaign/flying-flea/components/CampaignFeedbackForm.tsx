import { useState, type FormEvent } from 'react'
import { BrandButton } from '../../../../components/brand/BrandButton'
import { BrandCard } from '../../../../components/brand/BrandCard'
import { BrandSectionHeading } from '../../../../components/brand/BrandSectionHeading'
import type { FlyingFleaFeedbackV1Answers } from '../../../../types'
import {
  EMPTY_CAMPAIGN_DRAFT,
  validateCampaignFeedback,
  type CampaignFeedbackErrors,
  type FlyingFleaFeedbackDraft,
} from '../feedbackForm'
import { CampaignFeedbackFields } from './CampaignFeedbackFields'

/*
 * The Flying Flea questionnaire at Point B.
 *
 * Six questions, in the campaign's own order and wording, rendered from
 * `config.ts` rather than typed out here: a question that exists in two places
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

        <CampaignFeedbackFields
          draft={draft}
          errors={errors}
          disabled={busy}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </BrandCard>

      <BrandButton type="submit" block disabled={busy}>
        {busy ? 'Saving…' : 'Submit Feedback'}
      </BrandButton>
    </form>
  )
}
