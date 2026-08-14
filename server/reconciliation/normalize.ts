/*
 * Contact normalisation for duplicate-candidate grouping.
 *
 * Deliberately minimal. Every "clever" normalisation rule is a guess about a
 * person, and a wrong guess here proposes that two different humans are one.
 * Reconciliation only ever *proposes*, but a proposal built on a guess wastes
 * a reviewer's time and, worse, teaches them to trust the list.
 *
 * So: strip formatting, and nothing else.
 */

/**
 * Digits only.
 *
 * A missing country code is **not** inferred. `+91 98765 43210` and
 * `9876543210` normalise differently, and that is correct — one of them may
 * belong to a different country entirely, and this engine has no way to know
 * which. Only formatting is removed.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, '')
}

/**
 * Trimmed and lower-cased.
 *
 * No provider-specific rules: Gmail dots are **not** removed and `+tags` are
 * **not** stripped. Those rules are true for some providers and false for
 * others, and applying them universally would merge people who merely use a
 * similar-looking address at a provider that treats them as distinct.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Whether a normalised value is usable as a grouping key. */
export function isUsableKey(value: string): boolean {
  return value.length > 0
}
