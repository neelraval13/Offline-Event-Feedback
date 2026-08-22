import { useState, type FormEvent } from 'react'
import type { FlyingFleaFeedbackV1Answers } from '../../../../types'
import {
  EMPTY_CAMPAIGN_DRAFT,
  validateCampaignFeedback,
  type CampaignFeedbackErrors,
  type FlyingFleaFeedbackDraft,
} from '../feedbackForm'
import { CampaignFeedbackFields } from './CampaignFeedbackFields'
import { FeedbackSubmitRow } from './FeedbackSubmitRow'

/*
 * The Flying Flea questionnaire on Point B's sticker paths.
 *
 * Six questions, in the campaign's own order and wording, rendered from
 * configuration rather than typed out here: a question that exists in two
 * places is a question that will eventually disagree with itself, and the
 * wording is what an export has to quote back.
 *
 * Answered by a rider standing up, on someone else's tablet, having just handed
 * back a helmet. So the ratings are large tap targets and the text answers are
 * optional.
 *
 * ## What the V2 migration changed
 *
 * Presentation only. `validateCampaignFeedback` is still the sole rule, it
 * still runs on submit rather than per keystroke, a failed validation still
 * keeps every other answer, and the values handed to `onSubmit` are unchanged.
 * What went is the `BrandCard` around the six questions: on a phone that was a
 * filled, bordered box wrapping six more, and the border was doing no work.
 *
 * The draft lives here and this component stays mounted through the save, so a
 * failed write leaves every answer exactly where the rider left it.
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
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-1">
      <h2
        id="ff-feedback-heading"
        className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-ink"
      >
        Feedback
      </h2>

      <CampaignFeedbackFields
        draft={draft}
        errors={errors}
        disabled={busy}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      />

      <FeedbackSubmitRow busy={busy} />
    </form>
  )
}
