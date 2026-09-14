import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BrandButton } from '../../../../components/brand/BrandButton'
import { BrandCard } from '../../../../components/brand/BrandCard'
import { BrandField } from '../../../../components/brand/BrandField'
import { BrandSectionHeading } from '../../../../components/brand/BrandSectionHeading'
import { EventLocationOptions } from '../../../../components/EventLocationOptions'
import { isEventLocation, type EventLocation } from '../../../../config/eventLocations'
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
import { ClusteredNumericInput } from './ClusteredNumericInput'
import { MotorcycleColourExperience } from './MotorcycleColourExperience'
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
 *   - Test Ride Date & Time is NOT asked. There is one day and the ride is
 *     happening now, so it is attached at submit from the venue clock (see
 *     `eventStamp.ts`) and shown as event metadata above the form instead. A
 *     read-only input holding an answer the operator cannot change is still a
 *     control they have to look at and tab past, several hundred times a day.
 *   - Location IS asked again, once. The event runs in two cities on the same
 *     day, so it can no longer be read off the build. It is answered once per
 *     device and then remembered, which costs the operator one tap a shift
 *     rather than one a rider, and it sits in its own card above the numbered
 *     steps so it does not read as a question about the person.
 *
 * Name is focused on arrival, tab order runs down the fields to the button, and
 * validation runs on submit, errors that appear while someone is still typing
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
  /**
   * The city this device is set to, used to seed a blank form.
   *
   * This is what makes "Next rider" keep the venue while clearing the person:
   * the reset builds its draft from this value rather than from nothing. Empty
   * on a device that has not been told where it is, which leaves the selector
   * unchosen and the form unsubmittable, deliberately.
   */
  readonly deviceLocation?: '' | EventLocation
  /**
   * Called when the operator changes the city, so the device can remember it.
   *
   * Omitted on the correction path, and that omission is the whole distinction
   * between the two uses of this control. Correcting one rider's record to say
   * Hyderabad is a statement about that record; it must not silently re-point
   * the desk and put Hyderabad on the next hundred riders registered in
   * Bengaluru.
   */
  readonly onDeviceLocationChange?: (location: EventLocation) => void
}

export function CampaignRegistrationForm({
  onSubmit,
  busy,
  resetKey,
  submitLabel = 'Register & Print',
  initialDraft,
  deviceLocation = '',
  onDeviceLocationChange,
}: CampaignRegistrationFormProps) {
  const [draft, setDraft] = useState<CampaignRegistrationDraft>(
    initialDraft ?? emptyCampaignDraft(deviceLocation),
  )
  const [errors, setErrors] = useState<CampaignFieldErrors>({})
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(initialDraft ?? emptyCampaignDraft(deviceLocation))
    setErrors({})
    nameRef.current?.focus()
    // Keyed on resetKey alone: re-running on every prop identity change would
    // fight the operator's typing.

  }, [resetKey])

  function patch(values: Partial<CampaignRegistrationDraft>) {
    setDraft((current) => ({ ...current, ...values }))
  }

  /*
   * A location change updates the draft, and on the registration path also the
   * device's memory. Both, in that order, so the field the operator is looking
   * at changes even if the write to storage fails on a locked-down browser.
   */
  function chooseLocation(raw: string) {
    const next = isEventLocation(raw) ? raw : ''
    patch({ location: next })
    if (next !== '') {
      onDeviceLocationChange?.(next)
    }
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
    <form onSubmit={handleSubmit} noValidate>
      {/*
        The city, first and on its own.

        Not folded into Personal Details, because it is not a question about
        the rider: it is where this desk is, and it stays put across hundreds of
        registrations. Sitting above Step 01 in its own card, it reads as a
        setting for the session rather than as the eleventh thing to type, while
        remaining a real required field that refuses a blank submit.

        It carries no step number for the same reason. The numbered steps are
        the sequence staff walk a rider through, and this is not part of it.
      */}
      <BrandCard labelledBy="ff-event-location">
        <BrandSectionHeading
          id="ff-event-location"
          title="Event Location"
          subtitle="Where this device is recording. Stays set until you change it."
        />
        <BrandField label="Location" required error={errors.location}>
          {(field) => (
            <select
              {...field}
              value={draft.location}
              disabled={busy}
              data-testid="event-location"
              onChange={(event) => chooseLocation(event.target.value)}
            >
              {/*
                The placeholder disappears once a city is chosen, so a mis-tap
                cannot put the form back into the unchosen state.
              */}
              <EventLocationOptions
                placeholder={draft.location === '' ? 'Select location' : false}
              />
            </select>
          )}
        </BrandField>
      </BrandCard>

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
        {/*
          The picture and the choice are one component: the image is a function
          of the value that will be persisted, not a second piece of state.
        */}
        <MotorcycleColourExperience
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

        </div>

        {/*
          The campaign's instrument-cluster treatment for the two numbers. They
          still accept typing and paste (see ClusteredNumericInput), so the
          look costs staff nothing at a busy desk.
        */}
        <div className="ff-clusters">
          <ClusteredNumericInput
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

          <ClusteredNumericInput
            label="Pincode"
            length={6}
            value={draft.pincode}
            error={errors.pincode}
            disabled={busy}
            autoComplete="postal-code"
            onChange={(pincode) => patch({ pincode })}
          />
        </div>
      </BrandCard>

      <BrandButton type="submit" block disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </BrandButton>
    </form>
  )
}
