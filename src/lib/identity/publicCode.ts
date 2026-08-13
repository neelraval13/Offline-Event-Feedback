import { publicParticipantCode, type PublicParticipantCode } from '../../types'

/*
 * The human-readable fallback identity printed under the QR sticker.
 *
 *   A1-00001-X
 *   ^^ ^^^^^ ^
 *   |  |     check character
 *   |  local registration sequence, zero-padded to at least 5 digits
 *   issuing station
 *
 * Properties this format is required to have:
 *
 * - readable and dictatable by staff under event conditions
 * - case-insensitive on entry, with one canonical stored form
 * - a check character that catches ordinary transcription slips
 * - validated deterministically and entirely offline (invariant 2)
 * - free of PII (invariant E) — it carries an issuer and a counter, nothing else
 *
 * The check character is emphatically NOT a signature. It detects typing
 * mistakes. It does not authenticate anything, and anyone can compute one.
 */

/** Character values 0..35. Value 36 exists in the arithmetic but is never printed. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const MODULUS = 37

/**
 * The check value that has no printable character. Sequences that produce it
 * are skipped at issue time rather than printed — see {@link isIssuableSequence}.
 */
const UNPRINTABLE_CHECK_VALUE = 36

/** Minimum width of the sequence segment; longer sequences are not truncated. */
export const SEQUENCE_PAD_WIDTH = 5

/** Sequences are 1-based; 0 is not a valid registration number. */
export const MIN_SEQUENCE = 1

/** Twelve digits — far beyond V1's ~10,000, and still comfortably readable. */
export const MAX_SEQUENCE = 999_999_999_999

const PREFIX_PATTERN = /^[0-9A-Z]{1,8}$/
const CODE_PATTERN = /^([0-9A-Z]{1,8})-([0-9]{1,12})-([0-9A-Z])$/

/**
 * ISO 7064 MOD 37-2 — the pure check-character system with prime modulus 37,
 * computed over the alphabet 0-9A-Z.
 *
 *   P = 0
 *   for each character with value a:
 *     P = ((P + a) mod 37) * 2 mod 37
 *   check = (38 - P) mod 37
 *
 * Why this and not something else:
 *
 * - Damm and Verhoeff are defined for decimal input; our payload contains the
 *   station letters, so they do not apply without mangling the format.
 * - The obvious alternative, ISO 7064 MOD 37,36 (hybrid), needs no skipping —
 *   but it misses a small class of adjacent transpositions where the two
 *   characters differ by exactly 1 in value. In a zero-padded numeric sequence
 *   that class is dominated by `0`<->`1` swaps, which is precisely the typo we
 *   most expect from manual entry, so the trade was not worth taking.
 * - A prime modulus buys total detection instead: every single-character
 *   substitution, every adjacent transposition and every jump transposition is
 *   caught. The price is that 1 in 37 payloads yields check value 36, which has
 *   no character in a 36-symbol alphabet. Those sequence numbers are skipped at
 *   issue time (~2.8% of the counter), which costs nothing — the sequence is a
 *   counter, not a census.
 *
 * These properties are pinned by exhaustive tests in `publicCode.test.ts`
 * rather than taken on trust.
 *
 * @param payload canonical prefix + padded sequence, e.g. `A100001`
 * @returns a character from the alphabet, or `null` for the unprintable value
 */
export function computeCheckCharacter(payload: string): string | null {
  let p = 0

  for (const character of payload) {
    const value = ALPHABET.indexOf(character)
    if (value < 0) {
      throw new Error(
        `Public code payload contains an unsupported character: ${character}`,
      )
    }
    p = (((p + value) % MODULUS) * 2) % MODULUS
  }

  const checkValue = (MODULUS + 1 - p) % MODULUS
  return checkValue === UNPRINTABLE_CHECK_VALUE
    ? null
    : (ALPHABET[checkValue] as string)
}

/** The string the check character is computed over: prefix + padded sequence. */
function checkPayload(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0')}`
}

function assertValidPrefix(prefix: string): string {
  const normalized = prefix.toUpperCase()
  if (!PREFIX_PATTERN.test(normalized)) {
    throw new Error(`Invalid public code prefix: ${prefix}`)
  }
  return normalized
}

function isSequenceInRange(sequence: number): boolean {
  return (
    Number.isInteger(sequence) &&
    sequence >= MIN_SEQUENCE &&
    sequence <= MAX_SEQUENCE
  )
}

/**
 * Whether a sequence number yields a printable code for this issuer.
 *
 * Roughly 1 in 37 does not. Callers allocating codes should use
 * {@link nextIssuableSequence} rather than testing this themselves.
 */
export function isIssuableSequence(prefix: string, sequence: number): boolean {
  if (!isSequenceInRange(sequence)) {
    return false
  }
  return computeCheckCharacter(checkPayload(assertValidPrefix(prefix), sequence)) !== null
}

/**
 * The first issuable sequence at or after `candidate`.
 *
 * Deterministic and pure, so the storage-backed allocator stays a plain
 * counter and the skipping rule lives here with the format it belongs to.
 */
export function nextIssuableSequence(prefix: string, candidate: number): number {
  const normalizedPrefix = assertValidPrefix(prefix)
  let sequence = Math.max(candidate, MIN_SEQUENCE)

  while (sequence <= MAX_SEQUENCE) {
    if (computeCheckCharacter(checkPayload(normalizedPrefix, sequence)) !== null) {
      return sequence
    }
    sequence += 1
  }

  throw new Error(`Public code sequence space exhausted for prefix ${prefix}`)
}

/**
 * Builds the canonical code for an issuer and a sequence number.
 *
 * Throws on invalid input: a bad prefix, an out-of-range sequence, or a
 * sequence that is not issuable is a programming error rather than a
 * user-entry error. Allocate through {@link nextIssuableSequence} first.
 */
export function formatPublicCode(
  prefix: string,
  sequence: number,
): PublicParticipantCode {
  const normalizedPrefix = assertValidPrefix(prefix)

  if (!isSequenceInRange(sequence)) {
    throw new Error(`Public code sequence out of range: ${sequence}`)
  }

  const checkCharacter = computeCheckCharacter(
    checkPayload(normalizedPrefix, sequence),
  )
  if (checkCharacter === null) {
    throw new Error(
      `Sequence ${sequence} is not issuable for prefix ${normalizedPrefix}`,
    )
  }

  const padded = String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0')
  return publicParticipantCode(
    `${normalizedPrefix}-${padded}-${checkCharacter}`,
  )
}

/**
 * Reduces anything staff might type to a comparable form: upper-cased, with
 * any run of separators (spaces, dashes, dots, slashes) collapsed to a single
 * dash and stripped from the ends.
 *
 * Deliberately does NOT fold visually similar characters (O/0, I/1): the check
 * character is drawn from the full 0-9A-Z alphabet, so folding would corrupt
 * legitimate codes. Disambiguating them is a sticker typography concern.
 */
export function normalizePublicCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type PublicCodeRejection =
  | 'malformed'
  | 'sequence-out-of-range'
  | 'unexpected-prefix'
  | 'invalid-check-character'

export type PublicCodeParseResult =
  | {
      readonly ok: true
      /** The canonical form, regardless of how it was typed. */
      readonly code: PublicParticipantCode
      readonly prefix: string
      readonly sequence: number
      readonly checkCharacter: string
    }
  | { readonly ok: false; readonly reason: PublicCodeRejection }

export interface ParsePublicCodeOptions {
  /** When given, the code must have been issued by this station. */
  readonly expectedPrefix?: string
}

/**
 * Parses and validates a code as typed by staff.
 *
 * Tolerates casing, separator style and short-form sequences (`A1-1-X` is
 * accepted as `A1-00001-X`, because the check character is computed over the
 * canonical padded payload rather than over the typed characters).
 */
export function parsePublicCode(
  raw: string,
  options: ParsePublicCodeOptions = {},
): PublicCodeParseResult {
  const match = CODE_PATTERN.exec(normalizePublicCode(raw))
  if (!match) {
    return { ok: false, reason: 'malformed' }
  }

  const [, prefix = '', digits = '', checkCharacter = ''] = match
  const sequence = Number.parseInt(digits, 10)

  if (!isSequenceInRange(sequence)) {
    return { ok: false, reason: 'sequence-out-of-range' }
  }

  if (
    options.expectedPrefix !== undefined &&
    prefix !== options.expectedPrefix.toUpperCase()
  ) {
    return { ok: false, reason: 'unexpected-prefix' }
  }

  if (computeCheckCharacter(checkPayload(prefix, sequence)) !== checkCharacter) {
    return { ok: false, reason: 'invalid-check-character' }
  }

  return {
    ok: true,
    code: publicParticipantCode(
      `${prefix}-${String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0')}-${checkCharacter}`,
    ),
    prefix,
    sequence,
    checkCharacter,
  }
}

/** Convenience predicate over {@link parsePublicCode}. */
export function isValidPublicCode(
  raw: string,
  options: ParsePublicCodeOptions = {},
): boolean {
  return parsePublicCode(raw, options).ok
}
