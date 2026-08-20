import {
  validateEmail,
  validateName,
} from '../registration/validation'
import { validatePhoneNumber } from '../campaign/flying-flea/registrationForm'
import type { CapturedParticipantIdentity } from '../../types'

/*
 * The third way into Point B: a rider with no sticker and no code.
 *
 * They give their name, phone number and email address, and those become the
 * identity of the response. Nothing is looked up, on the device or over the
 * network, and no registration is created: this rider may never have been
 * through Point A, and inventing a registration for them would put a
 * participant in the event who never registered.
 *
 * ## Why these validators and not new ones
 *
 * Every rule here is imported from the two modules Point A already uses:
 * `validateName` and `validateEmail` from the generic contract, and
 * `validatePhoneNumber` from the campaign's own rules, which is where the
 * ten-digit Indian mobile rule lives.
 *
 * Writing a second phone validator here would have been the easy thing and the
 * wrong one. Reconciliation matches a contact response to a registration on the
 * normalised phone and email pair; if the two desks accept different phone
 * formats then the same rider, typing the same number at both, produces two
 * values that normalise differently and never match. The match would fail for a
 * reason nobody could see from either screen.
 *
 * Wording differs from Point A's in one respect: it says "your", because at
 * Point B the rider is often holding the tablet themselves, where at Point A an
 * operator is typing on their behalf.
 */

export interface ContactDraft {
  readonly name: string
  readonly phone: string
  readonly email: string
}

export const EMPTY_CONTACT_DRAFT: ContactDraft = {
  name: '',
  phone: '',
  email: '',
}

export type ContactFieldErrors = Partial<Record<keyof ContactDraft, string>>

export type ContactCaptureResult =
  | {
      readonly ok: true
      /** Ready to persist: `captureMethod: 'contact'` and nothing else. */
      readonly identity: Extract<
        CapturedParticipantIdentity,
        { captureMethod: 'contact' }
      >
    }
  | { readonly ok: false; readonly errors: ContactFieldErrors }

/**
 * Validates the contact details and produces the identity to persist.
 *
 * All three are required. There is no partial contact identity: a response with
 * a name and no way to reach the person is one reconciliation can never match
 * and an organiser can never follow up, which makes it a response from nobody.
 *
 * Trimming happens here rather than on each keystroke, so what the rider typed
 * stays on screen while they are typing and only the cleaned value is stored.
 * The phone is reduced to its digits, the same canonical form Point A stores,
 * because the two have to be comparable for a match to be possible at all.
 */
export function validateContactCapture(
  draft: ContactDraft,
): ContactCaptureResult {
  const errors: ContactFieldErrors = {}

  const nameError = validateName(draft.name)
  const phoneError = validatePhoneNumber(draft.phone)
  const emailError = validateEmail(draft.email)

  if (nameError !== null) {
    errors.name = nameError.replace('the participant’s', 'your')
  }
  if (phoneError !== null) {
    errors.phone = phoneError.replace('the rider’s', 'your')
  }
  if (emailError !== null) {
    errors.email = emailError
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    identity: {
      captureMethod: 'contact',
      respondentName: draft.name.trim(),
      // Digits only, exactly as Point A canonicalises a phone number.
      respondentPhone: draft.phone.replace(/[\s-]/g, ''),
      respondentEmail: draft.email.trim(),
    },
  }
}
