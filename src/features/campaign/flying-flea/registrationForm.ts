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
  readonly location: string
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
 * omitted. On a new registration that is the same thing — the store skips nulls.
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
const PINCODE = /^\d{6}$/

export const MAX_LICENCE_LENGTH = 32

/**
 * The colour control always holds a value, so the draft starts on the first
 * campaign colour rather than on nothing.
 */
export function emptyCampaignDraft(): CampaignRegistrationDraft {
  return {
    name: '',
    phone: '',
    email: '',
    vehicle: null,
    interestedColour: FLYING_FLEA_CAMPAIGN.colours[0] as FlyingFleaColour,
    location: FLYING_FLEA_CAMPAIGN.lockedLocation ?? '',
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
  if (draft.location.trim().length === 0) {
    errors.location = 'Select a location.'
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
      location: draft.location.trim(),
      gender: optional<FlyingFleaGender>(draft.gender),
      testRideAt: optional(draft.testRideAt),
      drivingLicence: optional(draft.drivingLicence),
      pincode: optional(draft.pincode),
    },
  }
}
