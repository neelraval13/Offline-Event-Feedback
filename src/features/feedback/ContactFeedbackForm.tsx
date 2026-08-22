import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FormField } from '../../components/design-system'
import { Input } from '../../components/ui/input'
import { CampaignFeedbackFields } from '../campaign/flying-flea/components/CampaignFeedbackFields'
import { FeedbackSubmitRow } from '../campaign/flying-flea/components/FeedbackSubmitRow'
import { NumericField } from '../campaign/flying-flea/components/NumericField'
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
 * this is a rider standing at a tablet having just got off a motorcycle, and a
 * second screen is a second chance to walk away.
 *
 * It is also not Point A. Nothing here asks for a vehicle, a colour, a licence
 * or a pincode, nothing prints a sticker, and no registration is created. Three
 * fields, then the same six questions everybody else answers, rendered by the
 * same `CampaignFeedbackFields` the sticker path uses.
 *
 * ## Everything is kept when a save fails
 *
 * The draft lives here, and this component stays mounted through the save, so a
 * failed write leaves every field exactly as the rider left it. That matters
 * more here than on the scanned path: a scanned rider who has to start again
 * re-answers six questions, a contact rider re-types their email address too,
 * and the answer to "please type all that in again" at an event is usually no.
 *
 * The terminal keeps `busy` inside `contact-entry` rather than moving to a
 * separate saving status precisely so this component is never unmounted around
 * a save. That is protected behaviour and the V2 migration does not touch it.
 *
 * ## What the migration changed
 *
 * Presentation. `validateContactCapture` and `validateCampaignFeedback` are
 * still the only rules and both still run before either reports, so a rider who
 * left a rating blank and mistyped their email sees both at once. What went is
 * the pair of `BrandCard`s and the circular dial: the phone is now the compact
 * numeric field Point A uses, which matters beyond consistency, because
 * reconciliation matches a contact response to a registration on the normalised
 * phone and email pair and the two desks have to canonicalise a number
 * identically for a match to be possible at all.
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
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <SectionHeading title="Rider details" />

        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <FormField label="Name" required error={contactErrors.name}>
            {(field) => (
              <Input
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
          </FormField>

          <FormField label="Email ID" required error={contactErrors.email}>
            {(field) => (
              <Input
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
          </FormField>

          {/*
            The same control Point A uses, so the same numbers are accepted and
            stored in the same canonical form. A phone number typed here and
            there has to normalise identically or reconciliation can never match
            the two.
          */}
          <NumericField
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
      </div>

      <div className="flex flex-col gap-1">
        <SectionHeading title="Feedback" />

        <CampaignFeedbackFields
          draft={answers}
          errors={answerErrors}
          disabled={busy}
          onChange={(patch) =>
            setAnswers((current) => ({ ...current, ...patch }))
          }
        />
      </div>

      <FeedbackSubmitRow busy={busy} />
    </form>
  )
}

/*
 * A section of the contact form. Deliberately unnumbered.
 *
 * Numbering these "01 Rider details" and "02 Feedback" would put an "01"
 * directly above the questionnaire's own "01", in the same lime, on the same
 * screen, meaning two different things. One numbering system per page: the
 * numerals belong to the six questions, because those are what a rider counts
 * down. The sections above them are labels.
 */
function SectionHeading({ title }: { readonly title: string }) {
  return (
    <h3 className="border-b border-line pb-2 font-ui text-label font-semibold uppercase tracking-[0.16em] text-ink">
      {title}
    </h3>
  )
}
