/*
 * Point A form validation.
 *
 * Deliberately modest. Staff are standing at a desk with a queue in front of
 * them, and the cost of wrongly rejecting a real participant's details is much
 * higher than the cost of storing a slightly odd phone number: a rejected
 * participant either waits while someone argues with the form, or gets entered
 * with fake details. So these rules catch blank fields and obvious typos, and
 * nothing more.
 *
 * No network validation of any kind — no OTP, no email verification, no
 * carrier lookup. The device is offline.
 *
 * International phone normalisation is explicitly out of scope. Counting digits
 * is enough to catch a half-typed number without pretending to know which
 * country a participant is from.
 */

export const MAX_NAME_LENGTH = 120
export const MAX_EMAIL_LENGTH = 254
export const MAX_PHONE_INPUT_LENGTH = 32

/** ITU E.164 allows up to 15 digits; 7 is the shortest plausible local number. */
export const MIN_PHONE_DIGITS = 7
export const MAX_PHONE_DIGITS = 15

/** Formatting characters people habitually type into a phone field. */
const PHONE_FORMATTING = /[\s\-().]/g

/**
 * Pragmatic e-mail shape check: something, an @, a dotted domain. Deliberately
 * not RFC 5322 — that grammar accepts addresses no participant will ever have
 * and rejecting on it would be worse than useless offline.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export interface RegistrationFormValues {
  readonly name: string
  readonly phone: string
  readonly email: string
}

/** Field-keyed messages. An absent key means that field is valid. */
export type RegistrationFieldErrors = Partial<
  Record<keyof RegistrationFormValues, string>
>

export type RegistrationValidationResult =
  | { readonly ok: true; readonly values: RegistrationFormValues }
  | { readonly ok: false; readonly errors: RegistrationFieldErrors }

export function validateName(raw: string): string | null {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return 'Enter the participant’s name.'
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Name must be ${MAX_NAME_LENGTH} characters or fewer.`
  }
  return null
}

/** Digits only, with the formatting people type stripped out. */
export function phoneDigits(raw: string): string {
  return raw.replace(PHONE_FORMATTING, '').replace(/^\+/, '')
}

export function validatePhone(raw: string): string | null {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return 'Enter a phone number.'
  }
  if (trimmed.length > MAX_PHONE_INPUT_LENGTH) {
    return 'Phone number is too long.'
  }

  const digits = phoneDigits(trimmed)

  // Anything left over after removing formatting and digits is a typo —
  // a letter, a slash, a stray symbol.
  if (!/^\d*$/.test(digits)) {
    return 'Phone number can only contain digits, spaces, + - ( ) and dots.'
  }
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return `Phone number must have between ${MIN_PHONE_DIGITS} and ${MAX_PHONE_DIGITS} digits.`
  }
  return null
}

export function validateEmail(raw: string): string | null {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return 'Enter an email address.'
  }
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.`
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return 'Enter a valid email address.'
  }
  return null
}

/**
 * Validates the whole form and returns the trimmed values to persist.
 *
 * Trimming happens here rather than at the input, so what staff typed stays on
 * screen while they are typing and only the cleaned value reaches storage.
 */
export function validateRegistrationForm(
  values: RegistrationFormValues,
): RegistrationValidationResult {
  const errors: RegistrationFieldErrors = {}

  const nameError = validateName(values.name)
  const phoneError = validatePhone(values.phone)
  const emailError = validateEmail(values.email)

  if (nameError !== null) {
    errors.name = nameError
  }
  if (phoneError !== null) {
    errors.phone = phoneError
  }
  if (emailError !== null) {
    errors.email = emailError
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    values: {
      name: values.name.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
    },
  }
}
