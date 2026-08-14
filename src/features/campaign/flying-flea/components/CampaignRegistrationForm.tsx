import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BrandButton } from '../../../../components/brand/BrandButton'
import { BrandCard } from '../../../../components/brand/BrandCard'
import { BrandField } from '../../../../components/brand/BrandField'
import { BrandSectionHeading } from '../../../../components/brand/BrandSectionHeading'
import type {
  CampaignFieldCorrections,
  FlyingFleaColour,
  FlyingFleaGender,
} from '../../../../types'
import type { RegistrationFormValues } from '../../../registration/validation'
import { FLYING_FLEA_CAMPAIGN } from '../config'
import {
  emptyCampaignDraft,
  validateCampaignRegistration,
  type CampaignFieldErrors,
  type CampaignRegistrationDraft,
} from '../registrationForm'
import { ColourSelector } from './ColourSelector'
import { VehicleSelector } from './VehicleSelector'

/*
 * Point A, in the campaign's design.
 *
 * Staff operate this several hundred times a day with a rider standing in front
 * of them, so the supplied design is followed except where it would cost time:
 *
 *   - The vehicle plates and colour swatches are kept. They are the fastest way
 *     to answer those two questions and they read at arm's length.
 *   - The circular dial keypads for phone and pincode are NOT kept. They are the
 *     most striking part of the reference and the slowest thing in it: ten taps
 *     on a rendered keypad instead of a number typed on the tablet's own
 *     keyboard, with no paste and no autofill. The fields are `inputMode`
 *     numeric inputs, which raise the same keypad the dial imitates.
 *
 * Name is focused on arrival, tab order runs down the fields to the button, and
 * validation runs on submit — errors that appear while someone is still typing
 * an email address are noise at a desk.
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
}

export function CampaignRegistrationForm({
  onSubmit,
  busy,
  resetKey,
  submitLabel = 'Register & Print',
  initialDraft,
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

  const venueLocked = FLYING_FLEA_CAMPAIGN.lockedLocation !== null

  return (
    <form onSubmit={handleSubmit} noValidate>
      <BrandCard labelledBy="ff-step-vehicle">
        <BrandSectionHeading
          id="ff-step-vehicle"
          step="Step 01"
          title="Select Vehicle No"
          subtitle="Choose your test-ride vehicle"
        />
        <VehicleSelector
          value={draft.vehicle}
          onChange={(vehicle) => patch({ vehicle })}
          error={errors.vehicle}
          disabled={busy}
        />
      </BrandCard>

      <BrandCard labelledBy="ff-step-interest">
        <BrandSectionHeading
          id="ff-step-interest"
          step="Step 02"
          title="Interest"
          subtitle="Interested in Color?"
        />
        <ColourSelector
          value={draft.interestedColour}
          onChange={(interestedColour: FlyingFleaColour) =>
            patch({ interestedColour })
          }
          disabled={busy}
        />
      </BrandCard>

      <BrandCard labelledBy="ff-step-details">
        <BrandSectionHeading
          id="ff-step-details"
          step="Step 03"
          title="Personal Details"
        />

        <div className="ff-grid2">
          <BrandField label="Name" required error={errors.name}>
            {(field) => (
              <input
                {...field}
                ref={nameRef}
                type="text"
                autoComplete="off"
                value={draft.name}
                disabled={busy}
                onChange={(event) => patch({ name: event.target.value })}
              />
            )}
          </BrandField>

          <BrandField label="Email ID" required error={errors.email}>
            {(field) => (
              <input
                {...field}
                type="email"
                autoComplete="off"
                autoCapitalize="none"
                value={draft.email}
                disabled={busy}
                onChange={(event) => patch({ email: event.target.value })}
              />
            )}
          </BrandField>

          <BrandField label="Location" required error={errors.location}>
            {(field) =>
              venueLocked ? (
                <input {...field} type="text" value={draft.location} readOnly />
              ) : (
                <select
                  {...field}
                  value={draft.location}
                  disabled={busy}
                  onChange={(event) => patch({ location: event.target.value })}
                >
                  <option value="">Select location</option>
                  {FLYING_FLEA_CAMPAIGN.locations.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              )
            }
          </BrandField>

          <BrandField label="Gender">
            {(field) => (
              <select
                {...field}
                value={draft.gender}
                disabled={busy}
                onChange={(event) =>
                  patch({ gender: event.target.value as '' | FlyingFleaGender })
                }
              >
                <option value="">Select gender</option>
                {FLYING_FLEA_CAMPAIGN.genders.map((gender) => (
                  <option key={gender} value={gender}>
                    {gender}
                  </option>
                ))}
              </select>
            )}
          </BrandField>

          <BrandField label="Test Ride Date & Time" error={errors.testRideAt}>
            {(field) => (
              <input
                {...field}
                type="datetime-local"
                value={draft.testRideAt}
                disabled={busy}
                onChange={(event) => patch({ testRideAt: event.target.value })}
              />
            )}
          </BrandField>

          <BrandField label="Driving Licence No" error={errors.drivingLicence}>
            {(field) => (
              <input
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
          </BrandField>

          <BrandField
            label="Phone Number"
            required
            error={errors.phone}
            hint="10-digit mobile number"
          >
            {(field) => (
              <input
                {...field}
                type="tel"
                /* Raises the numeric keypad without costing staff a paste. */
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                value={draft.phone}
                disabled={busy}
                onChange={(event) => patch({ phone: event.target.value })}
              />
            )}
          </BrandField>

          <BrandField label="Pincode" error={errors.pincode}>
            {(field) => (
              <input
                {...field}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={draft.pincode}
                disabled={busy}
                onChange={(event) => patch({ pincode: event.target.value })}
              />
            )}
          </BrandField>
        </div>
      </BrandCard>

      <BrandButton type="submit" block disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </BrandButton>
    </form>
  )
}
