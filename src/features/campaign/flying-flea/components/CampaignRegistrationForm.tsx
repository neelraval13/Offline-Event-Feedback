import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppButton, FormField } from '../../../../components/design-system'
import { Input } from '../../../../components/ui/input'
import { StationStep } from '../../../registration/StationStep'
import { cn } from '../../../../lib/ui/cn'
import type {
  CampaignFieldCorrections,
  FlyingFleaColour,
  FlyingFleaGender,
} from '../../../../types'
import type { RegistrationFormValues } from '../../../registration/validation'
import { FLYING_FLEA_CAMPAIGN } from '../config'
import {
  emptyCampaignDraft,
  normalisePastedPhone,
  validateCampaignRegistration,
  type CampaignFieldErrors,
  type CampaignRegistrationDraft,
} from '../registrationForm'
import { MotorcycleColourExperience } from './MotorcycleColourExperience'
import { NumericField } from './NumericField'
import { VehicleSelector } from './VehicleSelector'

/*
 * Point A's form, in the V2 design.
 *
 * ## What this migration did and did not touch
 *
 * Presentation only. The draft shape, the validation call, the paste
 * normaliser, the reset-on-`resetKey` behaviour, the focus-Name-on-arrival
 * behaviour, submit-time validation and the exact values handed to `onSubmit`
 * are the code that was here before, unchanged. There is deliberately no second
 * set of rules: `validateCampaignRegistration` is still the only thing that
 * decides whether a registration is acceptable, and it still runs on submit
 * rather than per keystroke, because errors appearing while somebody is still
 * typing an email address are noise at a desk.
 *
 * ## What changed
 *
 * The three `BrandCard`s became three open bands (see `StationStep`). Wrapping
 * every group in a bordered, filled, 22px-cornered surface made one form read
 * as three separate things to deal with, and the borders were doing no work:
 * nothing sits beside a step that it needs to be told apart from.
 *
 * The field order changed, and this is the one substantive layout decision.
 * V1 ran Name, Email, Gender, Licence in a grid and then dropped Phone and
 * Pincode into a separate block underneath, because the dial pods needed their
 * own row. That put the two most important fields on the form, one of them
 * required, below two of the least important. They are now ordered by whether
 * the form will refuse without them:
 *
 *     Name *            Email ID *
 *     Phone Number *    Pincode
 *     Gender            Driving Licence No
 *
 * so an operator scanning for what is still empty meets the ones that will stop
 * them first, in reading order.
 *
 * Venue and Test Ride Date & Time are still not asked. There is one venue and
 * one day, and the ride is happening now; both are attached at submit from
 * configuration and the venue clock (see `eventStamp.ts`). A read-only input
 * holding an answer the operator cannot change is still a control they look at
 * and tab past, several hundred times a day. The quiet note beside the submit
 * button is what states them instead.
 *
 * ## Gender is a native select on purpose
 *
 * The V2 primitive layer has a Radix `Select`, and this does not use it. A
 * native `<select>` raises the operating system's own picker on a tablet, which
 * is faster to hit than a rendered listbox, needs no JavaScript to open, and
 * cannot be left half-open by a stray tap. It is styled to match the V2 field so
 * nothing about the form looks inconsistent.
 */

interface CampaignRegistrationFormProps {
  readonly onSubmit: (
    values: RegistrationFormValues & CampaignFieldCorrections,
  ) => void
  readonly busy: boolean
  /** Changing this clears the desk for the next rider. */
  readonly resetKey: number
  readonly submitLabel?: string
  readonly initialDraft?: CampaignRegistrationDraft
  /**
   * Hides the note about stamping.
   *
   * A correction does not re-stamp the venue or the ride time, so promising
   * that it will would be false. See `eventStamp.ts`.
   */
  readonly stamps?: boolean
}

export function CampaignRegistrationForm({
  onSubmit,
  busy,
  resetKey,
  submitLabel = 'Register & Print',
  initialDraft,
  stamps = true,
}: CampaignRegistrationFormProps) {
  const [draft, setDraft] = useState<CampaignRegistrationDraft>(
    initialDraft ?? emptyCampaignDraft(),
  )
  const [errors, setErrors] = useState<CampaignFieldErrors>({})
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(initialDraft ?? emptyCampaignDraft())
    setErrors({})
    nameRef.current?.focus()
    // Keyed on resetKey alone: re-running on every prop identity change would
    // fight the operator's typing.

  }, [resetKey])

  function patch(values: Partial<CampaignRegistrationDraft>) {
    setDraft((current) => ({ ...current, ...values }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) {
      return
    }

    const result = validateCampaignRegistration(draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    onSubmit(result.values)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <StationStep step="01" title="Vehicle" note="Read the plate on the bike">
        <VehicleSelector
          value={draft.vehicle}
          onChange={(vehicle) => patch({ vehicle })}
          error={errors.vehicle}
          disabled={busy}
        />
      </StationStep>

      <StationStep step="02" title="Preferred colour">
        {/*
          The picture and the choice are one component: the image is a function
          of the value that will be persisted, not a second piece of state.

          The heading says "Preferred colour" and the field it writes is still
          `interestedColour`. Copy and storage are different contracts, and
          renaming a persisted field to improve a heading would ripple through
          the wire schema, the exports and every backup already taken.
        */}
        <MotorcycleColourExperience
          value={draft.interestedColour}
          onChange={(interestedColour: FlyingFleaColour) =>
            patch({ interestedColour })
          }
          disabled={busy}
        />
      </StationStep>

      <StationStep step="03" title="Rider details">
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <FormField label="Name" required error={errors.name}>
            {(field) => (
              <Input
                {...field}
                ref={nameRef}
                type="text"
                autoComplete="off"
                value={draft.name}
                disabled={busy}
                onChange={(event) => patch({ name: event.target.value })}
              />
            )}
          </FormField>

          <FormField label="Email ID" required error={errors.email}>
            {(field) => (
              <Input
                {...field}
                type="email"
                autoComplete="off"
                autoCapitalize="none"
                value={draft.email}
                disabled={busy}
                onChange={(event) => patch({ email: event.target.value })}
              />
            )}
          </FormField>

          <NumericField
            label="Phone Number"
            required
            length={10}
            value={draft.phone}
            error={errors.phone}
            disabled={busy}
            autoComplete="tel-national"
            normalisePaste={normalisePastedPhone}
            onChange={(phone) => patch({ phone })}
          />

          <NumericField
            label="Pincode"
            length={6}
            value={draft.pincode}
            error={errors.pincode}
            disabled={busy}
            autoComplete="postal-code"
            onChange={(pincode) => patch({ pincode })}
          />

          <FormField label="Gender">
            {(field) => (
              <select
                {...field}
                value={draft.gender}
                disabled={busy}
                onChange={(event) =>
                  patch({ gender: event.target.value as '' | FlyingFleaGender })
                }
                className={cn(
                  'flex min-h-touch w-full appearance-none rounded-control',
                  'border border-line bg-field px-3.5 py-2',
                  'font-ui text-base text-ink',
                  'transition-[border-color] duration-150 hover:border-line-strong',
                  'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <option value="">Select gender</option>
                {FLYING_FLEA_CAMPAIGN.genders.map((gender) => (
                  <option key={gender} value={gender}>
                    {gender}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label="Driving Licence No" error={errors.drivingLicence}>
            {(field) => (
              <Input
                {...field}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                value={draft.drivingLicence}
                disabled={busy}
                onChange={(event) =>
                  patch({ drivingLicence: event.target.value })
                }
              />
            )}
          </FormField>
        </div>
      </StationStep>

      {/*
        One action, on its own rule, at the end of the reading order.

        Not a sticky bar: on a tablet the software keyboard is open for most of
        this form, and a bar pinned to the bottom of the viewport sits either
        under the keyboard or on top of the field being typed into. A button at
        the end of the form is where the operator's eye already is when they
        finish the last field, and Enter from any field submits anyway.
      */}
      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        {stamps && (
          <p className="font-body text-small text-faint">
            Venue and test-ride time are stamped automatically when this is
            saved.
          </p>
        )}
        <AppButton
          type="submit"
          size="lg"
          busy={busy}
          busyLabel="Saving…"
          className="sm:ml-auto sm:min-w-56"
        >
          {submitLabel}
        </AppButton>
      </div>
    </form>
  )
}
