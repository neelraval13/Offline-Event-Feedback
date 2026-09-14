import { isEventLocation, type EventLocation } from '../../../config/eventLocations'
import type {
  CampaignFieldCorrections,
  FlyingFleaColour,
  FlyingFleaGender,
} from '../../../types'
import {
  validateEmail,
  validateName,
  type RegistrationFormValues,
} from '../../registration/validation'
import { FLYING_FLEA_CAMPAIGN } from './config'

/*
 * The Flying Flea registration form's own rules.
 *
 * Deliberately separate from `features/registration/validation.ts`, which
 * remains the generic name/phone/email contract every campaign shares. This
 * module adds what *this* campaign asks for and nothing else, so the next
 * campaign replaces one file rather than unpicking rules from a shared one.
 *
 * The rules are read off the supplied form's own submit handler, not invented:
 * vehicle, name, email, location and phone are refused when blank; gender,
 * test-ride time, licence and pincode are not.
 *
 * Two places where this is deliberately laxer than the supplied page, both
 * because an event desk is not a website:
 *
 *   - the phone rule accepts any 10-digit Indian mobile the campaign's own
 *     regex accepts, but a rider whose number does not match is not turned away
 *     silently: the message says what is expected.
 *   - the licence number has no format check at all. Indian licence formats vary
 *     by state and by decade, and a regex that rejects a real licence at a desk
 *     with a queue is worse than storing an odd-looking one.
 */

/** Everything the campaign's Point A form holds while staff are typing. */
export interface CampaignRegistrationDraft extends RegistrationFormValues {
  readonly vehicle: string | null
  readonly interestedColour: FlyingFleaColour
  /**
   * The city, or the empty string for "not chosen yet".
   *
   * Typed as the union rather than as `string` so a component cannot put an
   * arbitrary venue into a draft. The empty case is a real state and has to be
   * representable: a fresh device has made no choice, and validation refuses to
   * submit until it has.
   */
  readonly location: '' | EventLocation
  readonly gender: '' | FlyingFleaGender
  readonly testRideAt: string
  readonly drivingLicence: string
  readonly pincode: string
}

export type CampaignFieldErrors = Partial<
  Record<keyof CampaignRegistrationDraft, string>
>

/**
 * What a validated campaign form yields.
 *
 * Optional fields come back as `null` when the operator left them blank, not
 * omitted. On a new registration that is the same thing: the store skips nulls.
 * On a correction it is the difference between "unchanged" and "cleared", and
 * omitting it would make a deletion silently do nothing.
 */
export type CampaignRegistrationResult =
  | {
      readonly ok: true
      readonly values: RegistrationFormValues & CampaignFieldCorrections
    }
  | { readonly ok: false; readonly errors: CampaignFieldErrors }

/** The supplied form's own rule: a 10-digit Indian mobile. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/

/**
 * Normalises a pasted phone number to the ten digits that are stored.
 *
 * Two prefixes are recognised, and only two, because they are the two ways a
 * real Indian mobile number is written down:
 *
 *   +91 98765 43210   twelve digits beginning 91  -> the country code is dropped
 *   098765 43210      eleven digits beginning 0   -> the trunk prefix is dropped
 *
 * Anything else over-long is NOT trimmed to fit. Taking the tail of an arbitrary
 * number, `123456789012345` becoming `6789012345`, would invent a plausible
 * ten-digit number that nobody typed, and it would pass validation. Those are
 * truncated from the front instead, exactly as typing into a full field behaves,
 * so what is left either is the number or is visibly rejected by the rule above.
 *
 * The result is the same canonical digit string the field has always stored.
 */
export function normalisePastedPhone(pasted: string): string {
  const digits = pasted.replace(/\D/g, '')

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2)
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1)
  }

  // Not a recognised prefix. Keep what fits, and let validation have the last
  // word rather than quietly manufacturing a number.
  return digits.slice(0, 10)
}
const PINCODE = /^\d{6}$/

export const MAX_LICENCE_LENGTH = 32

/**
 * A blank form, optionally carrying the venue this device is already set to.
 *
 * The colour control always holds a value, so the draft starts on the first
 * campaign colour rather than on nothing.
 *
 * `location` is the argument, and it defaults to "not chosen". That default is
 * the important part: there is deliberately no fallback to the first city in
 * the list. A device that has never been told where it is must show an unchosen
 * selector and refuse to submit, because a silent default would put a plausible
 * city on a record that nobody actually confirmed, and Bengaluru and Hyderabad
 * are indistinguishable after the fact in the data.
 *
 * Callers that HAVE a remembered venue pass it here, which is what makes "Next
 * rider" keep the city while clearing everything about the person.
 *
 * `testRideAt` starts empty and is not a control: the time is read from the
 * venue clock at submit rather than here, so that a form opened at 14:10 and
 * submitted at 14:13 records 14:13. See `eventStamp.ts`.
 */
export function emptyCampaignDraft(
  location: '' | EventLocation = '',
): CampaignRegistrationDraft {
  return {
    name: '',
    phone: '',
    email: '',
    vehicle: null,
    interestedColour: FLYING_FLEA_CAMPAIGN.colours[0] as FlyingFleaColour,
    location,
    gender: '',
    testRideAt: '',
    drivingLicence: '',
    pincode: '',
  }
}

export function validatePhoneNumber(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '')

  if (digits.length === 0) {
    return 'Enter the rider’s phone number.'
  }
  if (!INDIAN_MOBILE.test(digits)) {
    return 'Enter a valid 10-digit mobile number.'
  }
  return null
}

export function validatePincode(raw: string): string | null {
  const trimmed = raw.trim()

  // Optional on the supplied form, so blank is fine; a partial one is not.
  if (trimmed.length === 0) {
    return null
  }
  if (!PINCODE.test(trimmed)) {
    return 'Pincode must be 6 digits.'
  }
  return null
}

/**
 * Checks a `testRideAt` the form is carrying.
 *
 * No longer typed by anyone: a new registration gets it from the venue clock at
 * submit, and a correction carries back whatever the record already held. The
 * check stays because both of those still arrive through this function, and the
 * stored shape is a contract the wire schema and the backup validator enforce
 * independently.
 */
export function validateTestRideAt(raw: string): string | null {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return null
  }
  // The value a `datetime-local` control produces. Stored as a wall-clock slot.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return 'Enter a date and time.'
  }
  return null
}

/**
 * Validates the whole campaign form and returns exactly what to persist.
 *
 * Optional fields that were left blank come back absent rather than as empty
 * strings, so a rider who declined to give a pincode and one who typed spaces
 * are not stored as different data.
 */
export function validateCampaignRegistration(
  draft: CampaignRegistrationDraft,
): CampaignRegistrationResult {
  const errors: CampaignFieldErrors = {}

  const nameError = validateName(draft.name)
  const emailError = validateEmail(draft.email)
  const phoneError = validatePhoneNumber(draft.phone)
  const pincodeError = validatePincode(draft.pincode)
  const testRideError = validateTestRideAt(draft.testRideAt)

  if (nameError !== null) {
    errors.name = nameError
  }
  if (emailError !== null) {
    errors.email = emailError
  }
  if (phoneError !== null) {
    errors.phone = phoneError
  }
  if (pincodeError !== null) {
    errors.pincode = pincodeError
  }
  if (testRideError !== null) {
    errors.testRideAt = testRideError
  }
  if (draft.vehicle === null) {
    errors.vehicle = 'Select the test-ride vehicle.'
  }
  /*
   * The venue, refused when unchosen and refused when unrecognised.
   *
   * Two separate failures on purpose. An empty value is the ordinary case of an
   * operator who has not picked a city yet and reads as an instruction. A value
   * that is not one of this event's cities can only come from a stale
   * preference or a tampered draft, and it must not reach a record: a
   * registration stamped with a venue this event never ran in is invisible in
   * every location breakdown afterwards.
   */
  if (draft.location.length === 0) {
    errors.location = 'Select the event location.'
  } else if (!isEventLocation(draft.location)) {
    errors.location = 'Select a location from the list.'
  }
  if (draft.drivingLicence.trim().length > MAX_LICENCE_LENGTH) {
    errors.drivingLicence = `Driving licence must be ${MAX_LICENCE_LENGTH} characters or fewer.`
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  /** Blank means "no value": null, so a correction can express a deletion. */
  const optional = <T extends string>(value: string): T | null => {
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : (trimmed as T)
  }

  return {
    ok: true,
    values: {
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.replace(/[\s-]/g, ''),
      // `vehicle` is non-null here: the check above returned otherwise.
      vehicle: draft.vehicle as string,
      interestedColour: draft.interestedColour,
      // Narrowed by the check above: this is one of the event's own cities.
      location: draft.location,
      gender: optional<FlyingFleaGender>(draft.gender),
      testRideAt: optional(draft.testRideAt),
      drivingLicence: optional(draft.drivingLicence),
      pincode: optional(draft.pincode),
    },
  }
}
