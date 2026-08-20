import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BrandButton } from '../../components/brand/BrandButton'
import { BrandCard } from '../../components/brand/BrandCard'
import { BrandField } from '../../components/brand/BrandField'
import { BrandSectionHeading } from '../../components/brand/BrandSectionHeading'
import { CampaignFeedbackFields } from '../campaign/flying-flea/components/CampaignFeedbackFields'
import { ClusteredNumericInput } from '../campaign/flying-flea/components/ClusteredNumericInput'
import {
  EMPTY_CAMPAIGN_DRAFT,
  validateCampaignFeedback,
  type CampaignFeedbackErrors,
  type FlyingFleaFeedbackDraft,
} from '../campaign/flying-flea/feedbackForm'
import { normalisePastedPhone } from '../campaign/flying-flea/registrationForm'
import type { CapturedParticipantIdentity, FlyingFleaFeedbackV1Answers } from '../../types'
import {
  EMPTY_CONTACT_DRAFT,
  validateContactCapture,
  type ContactDraft,
  type ContactFieldErrors,
} from './contactCapture'

/*
 * Point B for a rider with no QR and no code.
 *
 * One form, one submit button, one save. Deliberately not a two-step wizard
 * that collects contact details and then hands the rider to the questionnaire:
 * this is a rider standing at a tablet having just got off a motorcycle, and
 * a second screen is a second chance to walk away.
 *
 * It is also not Point A. Nothing here asks for a vehicle, a colour, a licence
 * or a pincode, nothing prints a sticker, and no registration is created. Three
 * fields, then the same six questions everybody else answers.
 *
 * ## Everything is kept when a save fails
 *
 * The draft lives here, and this component stays mounted through the save, so a
 * failed write leaves every field exactly as the rider left it. That matters
 * more here than on the scanned path: a scanned rider who has to start again
 * re-answers six questions, a contact rider re-types their email address too,
 * and the answer to "please type all that in again" at an event is usually no.
 */

interface ContactFeedbackFormProps {
  readonly busy: boolean
  readonly onSubmit: (
    identity: Extract<CapturedParticipantIdentity, { captureMethod: 'contact' }>,
    answers: FlyingFleaFeedbackV1Answers,
  ) => void
}

export function ContactFeedbackForm({
  busy,
  onSubmit,
}: ContactFeedbackFormProps) {
  const [contact, setContact] = useState<ContactDraft>(EMPTY_CONTACT_DRAFT)
  const [contactErrors, setContactErrors] = useState<ContactFieldErrors>({})
  const [answers, setAnswers] =
    useState<FlyingFleaFeedbackDraft>(EMPTY_CAMPAIGN_DRAFT)
  const [answerErrors, setAnswerErrors] = useState<CampaignFeedbackErrors>({})
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) {
      return
    }

    /*
     * Both halves are validated before either is reported, so a rider who left
     * a rating blank and mistyped their email sees both at once. Validating the
     * contact details first and returning would show them one problem, then the
     * other after they fixed it.
     */
    const identity = validateContactCapture(contact)
    const questionnaire = validateCampaignFeedback(answers)

    setContactErrors(identity.ok ? {} : identity.errors)
    setAnswerErrors(questionnaire.ok ? {} : questionnaire.errors)

    if (!identity.ok || !questionnaire.ok) {
      return
    }

    onSubmit(identity.identity, questionnaire.answers)
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <BrandCard labelledBy="ff-contact-heading">
        <BrandSectionHeading
          id="ff-contact-heading"
          step="Step 01"
          title="Your details"
          subtitle="So we can recognise your feedback"
        />

        <div className="ff-grid2">
          <BrandField label="Name" required error={contactErrors.name}>
            {(field) => (
              <input
                {...field}
                ref={nameRef}
                type="text"
                autoComplete="name"
                value={contact.name}
                disabled={busy}
                onChange={(event) =>
                  setContact((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            )}
          </BrandField>

          <BrandField label="Email ID" required error={contactErrors.email}>
            {(field) => (
              <input
                {...field}
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                value={contact.email}
                disabled={busy}
                onChange={(event) =>
                  setContact((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            )}
          </BrandField>
        </div>

        {/* The same control Point A uses, so the same numbers are accepted
            and stored in the same canonical form. A phone number typed here
            and there has to normalise identically or reconciliation can never
            match the two. */}
        <div className="ff-clusters">
          <ClusteredNumericInput
            label="Phone Number"
            required
            length={10}
            value={contact.phone}
            error={contactErrors.phone}
            disabled={busy}
            autoComplete="tel-national"
            normalisePaste={normalisePastedPhone}
            onChange={(phone) => setContact((current) => ({ ...current, phone }))}
          />
        </div>
      </BrandCard>

      <BrandCard labelledBy="ff-contact-feedback-heading">
        <BrandSectionHeading
          id="ff-contact-feedback-heading"
          step="Step 02"
          title="Feedback"
        />

        <CampaignFeedbackFields
          draft={answers}
          errors={answerErrors}
          disabled={busy}
          onChange={(patch) =>
            setAnswers((current) => ({ ...current, ...patch }))
          }
        />
      </BrandCard>

      <BrandButton type="submit" block disabled={busy}>
        {busy ? 'Saving…' : 'Submit Feedback'}
      </BrandButton>
    </form>
  )
}
